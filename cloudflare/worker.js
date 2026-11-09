const SYMBOLS = ["BTC/USD", "ETH/USD", "QNT/USD"];
const PAPER_BASE = "https://paper-api.alpaca.markets";
const DATA_BASE = "https://data.alpaca.markets";

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function configured(env) {
  return Boolean(env.APCA_API_KEY_ID && env.APCA_API_SECRET_KEY);
}

async function alpacaFetch(env, base, path) {
  if (!configured(env)) throw new Error("alpaca_credentials_missing");
  const result = await fetch(base + path, {
    headers: {
      "APCA-API-KEY-ID": env.APCA_API_KEY_ID,
      "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok) throw new Error(`alpaca_http_${result.status}`);
  return result.json();
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), c => c.charCodeAt(0));
}

async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;
  try {
    const [head, body, signature] = token.split(".");
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(head)));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(body)));
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
    if (header.alg !== "RS256" || claims.iss !== issuer || !claims.exp || claims.exp <= Date.now() / 1000) return false;
    if (claims.nbf && claims.nbf > Date.now() / 1000) return false;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(env.ACCESS_AUD)) return false;
    const certsResponse = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!certsResponse.ok) return false;
    const certs = await certsResponse.json();
    const jwk = certs.keys.find(key => key.kid === header.kid);
    if (!jwk) return false;
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      decodeBase64Url(signature),
      new TextEncoder().encode(`${head}.${body}`),
    );
  } catch {
    return false;
  }
}

function ema(values, period) {
  if (values.length < period) return [];
  const result = [];
  const multiplier = 2 / (period + 1);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = current;
  for (let i = period; i < values.length; i += 1) {
    current = (values[i] - current) * multiplier + current;
    result[i] = current;
  }
  return result;
}

async function updateStatus(env, status, message, lastCycle = null) {
  await env.DB.prepare(
    "INSERT INTO worker_status (id, status, message, last_heartbeat, last_cycle) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status=excluded.status, message=excluded.message, last_heartbeat=excluded.last_heartbeat, last_cycle=COALESCE(excluded.last_cycle, worker_status.last_cycle)",
  ).bind(status, message, new Date().toISOString(), lastCycle).run();
}

async function scanMarkets(env) {
  if (!configured(env)) {
    await updateStatus(env, "WAITING_CREDENTIALS", "Credenziali Alpaca PAPER mancanti");
    return;
  }
  try {
    const scans = await Promise.all(SYMBOLS.map(async symbol => {
      const query = new URLSearchParams({ symbols: symbol, timeframe: "1Min", limit: "100" });
      const result = await alpacaFetch(env, DATA_BASE, `/v1beta3/crypto/us/bars?${query.toString()}`);
      const now = Date.now();
      const bars = (result.bars?.[symbol] || [])
        .filter(bar => Number.isFinite(Number(bar.c)) && Number(bar.c) > 0 && Number.isFinite(Date.parse(bar.t)))
        .filter(bar => Date.parse(bar.t) + 60_000 <= now)
        .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
      if (bars.length < 30) return { symbol, inserted: 0, skipped: "history_insufficient" };
      if (now - Date.parse(bars[bars.length - 1].t) > 180_000) {
        return { symbol, inserted: 0, skipped: "stale_market_data" };
      }

      const cursor = await env.DB.prepare(
        "SELECT last_bar_time FROM scan_cursors WHERE symbol = ?",
      ).bind(symbol).first();
      let startIndex = bars.length - 1;
      let historyGap = false;
      if (cursor?.last_bar_time) {
        startIndex = bars.findIndex(bar => Date.parse(bar.t) > Date.parse(cursor.last_bar_time));
        if (startIndex === -1) return { symbol, inserted: 0 };
        if (startIndex < 21) {
          startIndex = 21;
          historyGap = true;
        }
      }

      const closes = bars.map(bar => Number(bar.c));
      const fast = ema(closes, 9);
      const slow = ema(closes, 21);
      let inserted = 0;
      for (let i = startIndex; i < bars.length; i += 1) {
        const previous = i - 1;
        const side = fast[previous] <= slow[previous] && fast[i] > slow[i] ? "BUY"
          : fast[previous] >= slow[previous] && fast[i] < slow[i] ? "SELL" : null;
        if (!side) continue;
        const barTime = bars[i].t;
        const signalKey = `${symbol}:${side}:${barTime}`;
        const write = await env.DB.prepare(
          "INSERT OR IGNORE INTO signals (signal_key, symbol, side, bar_time, price, fast_ema, slow_ema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).bind(signalKey, symbol, side, barTime, closes[i], fast[i], slow[i], new Date().toISOString()).run();
        inserted += write.meta?.changes || 0;
      }

      await env.DB.prepare(
        "INSERT INTO scan_cursors (symbol, last_bar_time, updated_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET last_bar_time=excluded.last_bar_time, updated_at=excluded.updated_at",
      ).bind(symbol, bars[bars.length - 1].t, new Date().toISOString()).run();
      return { symbol, inserted, skipped: historyGap ? "history_gap" : null };
    }));

    const inserted = scans.reduce((sum, scan) => sum + scan.inserted, 0);
    const insufficient = scans.filter(scan => scan.skipped === "history_insufficient").map(scan => scan.symbol);
    const stale = scans.filter(scan => scan.skipped === "stale_market_data").map(scan => scan.symbol);
    const gaps = scans.filter(scan => scan.skipped === "history_gap").map(scan => scan.symbol);
    const issues = [
      insufficient.length ? `storico insufficiente: ${insufficient.join(", ")}` : null,
      stale.length ? `dati non aggiornati: ${stale.join(", ")}` : null,
      gaps.length ? `interruzione nello storico: ${gaps.join(", ")}` : null,
    ].filter(Boolean);
    const message = issues.length
      ? `Scansione parziale, ${issues.join("; ")}. Nuovi segnali: ${inserted}`
      : `Scansione completata. Nuovi segnali: ${inserted}`;
    await updateStatus(env, issues.length ? "DEGRADED" : "MONITORING", message, new Date().toISOString());
  } catch (error) {
    await updateStatus(env, "DEGRADED", String(error.message || error).slice(0, 180));
    throw error;
  }
}

function freshBotStatus(row) {
  if (!row) return { status: "NOT_STARTED", message: "Worker non ancora avviato", last_heartbeat: null, last_cycle: null };
  const age = row.last_heartbeat ? Date.now() - Date.parse(row.last_heartbeat) : Infinity;
  return age > 180000 ? { ...row, status: "STALE", message: "Heartbeat del worker scaduto" } : row;
}

async function routeApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method !== "GET") return response({ ok: false, error: "method_not_allowed" }, 405);

  if (path === "/api/health") {
    const status = await env.DB.prepare("SELECT status, message, last_heartbeat, last_cycle FROM worker_status WHERE id=1").first();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM signals").first();
    const bot = freshBotStatus(status);
    return response({
      ok: true, service: "miracolo", mode: "PAPER", live_enabled: false, broker: "alpaca",
      alpaca_configured: configured(env), bot: { ...bot, signals_recorded: count?.total || 0 },
      execution_enabled: false,
    });
  }

  if (path === "/api/bot/status") {
    const bot = await env.DB.prepare("SELECT status, message, last_heartbeat, last_cycle FROM worker_status WHERE id=1").first();
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM signals").first();
    return response({ ok: true, bot: { ...freshBotStatus(bot), signals_recorded: count?.total || 0 }, execution_enabled: false });
  }

  if (path === "/api/bot/signals") {
    const rows = await env.DB.prepare("SELECT symbol, side, bar_time, price, fast_ema, slow_ema FROM signals ORDER BY id DESC LIMIT 20").all();
    return response({ ok: true, signals: rows.results || [] });
  }

  if (path.startsWith("/api/alpaca/")) {
    if (!await verifyAccess(request, env)) return response({ ok: false, error: "cloudflare_access_required" }, 401);
    if (!configured(env)) return response({ ok: false, error: "alpaca_credentials_missing" }, 503);
    try {
      if (path === "/api/alpaca/status") {
        const account = await alpacaFetch(env, PAPER_BASE, "/v2/account");
        return response({ ok: true, mode: "PAPER", live_enabled: false, account });
      }
      if (path === "/api/alpaca/positions") {
        const positions = await alpacaFetch(env, PAPER_BASE, "/v2/positions");
        return response({ ok: true, mode: "PAPER", positions: positions.filter(p => SYMBOLS.includes(p.symbol.replace("-", "/"))) });
      }
      if (path === "/api/alpaca/orders") {
        const orders = await alpacaFetch(env, PAPER_BASE, "/v2/orders?status=open&limit=100");
        return response({ ok: true, mode: "PAPER", orders: orders.filter(o => SYMBOLS.includes(o.symbol.replace("-", "/"))) });
      }
      if (path === "/api/alpaca/assets") {
        const assets = await alpacaFetch(env, PAPER_BASE, "/v2/assets?status=active&asset_class=crypto");
        return response({ ok: true, mode: "PAPER", assets: assets.filter(a => SYMBOLS.includes(a.symbol.replace("-", "/"))) });
      }
    } catch (error) {
      return response({ ok: false, error: String(error.message || error), mode: "PAPER" }, 502);
    }
  }
  return response({ ok: false, error: "not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await routeApi(request, env); }
      catch (error) { return response({ ok: false, error: "service_unavailable" }, 503); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(scanMarkets(env));
  },
};
