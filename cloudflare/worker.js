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
    const certsResponse = await fetch(`${issuer}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(5000),
    });
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
        .filter(bar => bar && (typeof bar.c === "number" || typeof bar.c === "string") &&
          !(typeof bar.c === "string" && bar.c.trim() === "") &&
          typeof bar.t === "string" && Number.isFinite(Number(bar.c)) &&
          Number(bar.c) > 0 && Number.isFinite(Date.parse(bar.t)))
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
        const cursorTime = Date.parse(cursor.last_bar_time);
        const firstBarTime = Date.parse(bars[0].t);
        const lastBarTime = Date.parse(bars[bars.length - 1].t);
        if (!Number.isFinite(cursorTime)) {
          return { symbol, inserted: 0, skipped: "invalid_scan_cursor" };
        }
        if (cursorTime > lastBarTime) {
          return { symbol, inserted: 0, skipped: "cursor_ahead_of_market_data" };
        }
        historyGap = cursorTime < firstBarTime;
        const firstNewIndex = bars.findIndex(bar => Date.parse(bar.t) > cursorTime);
        if (firstNewIndex === -1) return { symbol, inserted: 0 };
        startIndex = Math.max(21, firstNewIndex);
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
        "INSERT INTO scan_cursors (symbol, last_bar_time, updated_at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET last_bar_time=excluded.last_bar_time, updated_at=excluded.updated_at WHERE excluded.last_bar_time > scan_cursors.last_bar_time",
      ).bind(symbol, bars[bars.length - 1].t, new Date().toISOString()).run();
      return { symbol, inserted, skipped: historyGap ? "history_gap" : null };
    }));

    const inserted = scans.reduce((sum, scan) => sum + scan.inserted, 0);
    const insufficient = scans.filter(scan => scan.skipped === "history_insufficient").map(scan => scan.symbol);
    const stale = scans.filter(scan => scan.skipped === "stale_market_data").map(scan => scan.symbol);
    const gaps = scans.filter(scan => scan.skipped === "history_gap").map(scan => scan.symbol);
    const invalidCursors = scans.filter(scan => scan.skipped === "invalid_scan_cursor").map(scan => scan.symbol);
    const futureCursors = scans.filter(scan => scan.skipped === "cursor_ahead_of_market_data").map(scan => scan.symbol);
    const issues = [
      insufficient.length ? `storico insufficiente: ${insufficient.join(", ")}` : null,
      stale.length ? `dati non aggiornati: ${stale.join(", ")}` : null,
      gaps.length ? `interruzione nello storico: ${gaps.join(", ")}` : null,
      invalidCursors.length ? `cursori non validi: ${invalidCursors.join(", ")}` : null,
      futureCursors.length ? `cursori successivi ai dati: ${futureCursors.join(", ")}` : null,
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

const ACTIVE_ORDER_STATES = new Set([
  "RISK_RESERVED",
  "ENTRY_SUBMITTED",
  "ENTRY_PARTIALLY_FILLED",
  "ENTRY_FILLED",
  "PROTECTION_SUBMITTED",
  "PROTECTED",
  "EXIT_SUBMITTED",
  "EMERGENCY_EXIT_REQUIRED",
  "EMERGENCY_EXIT_SUBMITTED",
]);

function normalizeSymbol(symbol) {
  return String(symbol || "").replace("-", "/").toUpperCase();
}

export async function fetchAllBrokerOrders(env, maxPages = 20) {
  const orders = [];
  let beforeOrderId = null;
  for (let page = 0; page < maxPages; page += 1) {
    const query = new URLSearchParams({ status: "all", limit: "500", direction: "desc" });
    if (beforeOrderId) query.set("before_order_id", beforeOrderId);
    const batch = await alpacaFetch(env, PAPER_BASE, `/v2/orders?${query.toString()}`);
    if (!Array.isArray(batch)) throw new Error("alpaca_orders_response_invalid");
    orders.push(...batch);
    if (batch.length < 500) return { orders, complete: true };
    beforeOrderId = batch[batch.length - 1]?.id || null;
    if (!beforeOrderId) throw new Error("alpaca_orders_pagination_cursor_missing");
  }
  return { orders, complete: false };
}

export async function fetchAllJournalRows(env, maxPages = 20) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < maxPages; page += 1) {
    const statement = cursor
      ? env.DB.prepare(
          "SELECT client_order_id, signal_key, symbol, side, state, entry_order_id, entry_status, filled_qty, avg_fill_price, stop_order_id, stop_status, stop_qty, stop_price, stop_limit_price, exit_order_id, emergency_exit_order_id, last_error, created_at FROM order_journal WHERE created_at < ? OR (created_at = ? AND client_order_id < ?) ORDER BY created_at DESC, client_order_id DESC LIMIT 200",
        ).bind(cursor.created_at, cursor.created_at, cursor.client_order_id)
      : env.DB.prepare(
          "SELECT client_order_id, signal_key, symbol, side, state, entry_order_id, entry_status, filled_qty, avg_fill_price, stop_order_id, stop_status, stop_qty, stop_price, stop_limit_price, exit_order_id, emergency_exit_order_id, last_error, created_at FROM order_journal ORDER BY created_at DESC, client_order_id DESC LIMIT 200",
        );
    const result = await statement.all();
    const batch = Array.isArray(result.results) ? result.results : [];
    rows.push(...batch);
    if (batch.length < 200) return { rows, complete: true };
    const last = batch[batch.length - 1];
    if (!last.created_at || !last.client_order_id) {
      throw new Error("journal_pagination_cursor_missing");
    }
    cursor = { created_at: last.created_at, client_order_id: last.client_order_id };
  }
  return { rows, complete: false };
}

export function buildReconciliation(journalRows, brokerOrders, brokerPositions, completeness = {}) {
  const orders = Array.isArray(brokerOrders) ? brokerOrders : [];
  const positions = Array.isArray(brokerPositions) ? brokerPositions : [];
  const journal = (Array.isArray(journalRows) ? journalRows : [])
    .filter(row => ACTIVE_ORDER_STATES.has(row.state));
  const issues = [];
  if (completeness.orders === false) issues.push({ type: "BROKER_ORDER_HISTORY_INCOMPLETE" });
  if (completeness.journal === false) issues.push({ type: "JOURNAL_HISTORY_INCOMPLETE" });
  const quantity = value => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const epsilon = 1e-8;
  const activeStopStates = new Set([
    "new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel",
  ]);
  const expectedPositionBySymbol = new Map();
  const protectedRemainingBySymbol = new Map();
  const brokerQtyBySymbol = new Map();

  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol);
    const qty = quantity(position.qty);
    if (qty === null || qty <= 0) {
      issues.push({ type: "BROKER_POSITION_QUANTITY_INVALID", symbol });
      continue;
    }
    brokerQtyBySymbol.set(symbol, (brokerQtyBySymbol.get(symbol) || 0) + qty);
  }

  for (const entry of journal) {
    const symbol = normalizeSymbol(entry.symbol);
    const entryOrder = entry.entry_order_id
      ? orders.find(order => order.id === entry.entry_order_id)
      : null;
    const stopOrder = entry.stop_order_id
      ? orders.find(order => order.id === entry.stop_order_id)
      : null;
    const exitOrder = entry.exit_order_id
      ? orders.find(order => order.id === entry.exit_order_id)
      : null;
    const emergencyExitOrder = entry.emergency_exit_order_id
      ? orders.find(order => order.id === entry.emergency_exit_order_id)
      : null;
    if (entry.entry_order_id && !entryOrder) {
      issues.push({ type: "ENTRY_ORDER_NOT_FOUND", symbol: entry.symbol, client_order_id: entry.client_order_id });
    }
    if (entryOrder && (
      normalizeSymbol(entryOrder.symbol) !== symbol ||
      String(entryOrder.side || "").toLowerCase() !== "buy"
    )) {
      issues.push({ type: "ENTRY_ORDER_IDENTITY_MISMATCH", symbol, client_order_id: entry.client_order_id });
    }
    if (entry.emergency_exit_order_id && !emergencyExitOrder) {
      issues.push({ type: "EMERGENCY_EXIT_ORDER_NOT_FOUND", symbol, client_order_id: entry.client_order_id });
    }
    const orderExpectedStates = new Set([
      "ENTRY_SUBMITTED", "ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "PROTECTION_SUBMITTED",
      "PROTECTED", "EXIT_SUBMITTED", "EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED",
    ]);
    if (!entry.entry_order_id && orderExpectedStates.has(entry.state)) {
      issues.push({ type: "ENTRY_ORDER_ID_MISSING", symbol, client_order_id: entry.client_order_id });
    }
    if (["PROTECTION_SUBMITTED", "PROTECTED"].includes(entry.state) && !entry.stop_order_id) {
      issues.push({ type: "PROTECTIVE_STOP_ORDER_ID_MISSING", symbol, client_order_id: entry.client_order_id });
    }
    if (entry.state === "EXIT_SUBMITTED" && !entry.exit_order_id) {
      issues.push({ type: "EXIT_ORDER_ID_MISSING", symbol, client_order_id: entry.client_order_id });
    }
    if (entry.state === "EMERGENCY_EXIT_SUBMITTED" && !entry.emergency_exit_order_id) {
      issues.push({ type: "EMERGENCY_EXIT_ORDER_ID_MISSING", symbol, client_order_id: entry.client_order_id });
    }

    const filled = quantity(entry.filled_qty);
    if (filled === null) {
      issues.push({ type: "JOURNAL_FILLED_QUANTITY_INVALID", symbol, client_order_id: entry.client_order_id });
      continue;
    }
    const fillRequiredStates = new Set([
      "ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "PROTECTION_SUBMITTED", "PROTECTED",
      "EXIT_SUBMITTED", "EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED",
    ]);
    if (fillRequiredStates.has(entry.state) && filled <= 0) {
      issues.push({ type: "LIFECYCLE_STATE_WITHOUT_ENTRY_FILL", symbol, client_order_id: entry.client_order_id });
    }
    if (entryOrder) {
      const activeEntryStates = new Set([
        "new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel",
      ]);
      if (filled > 0 && activeEntryStates.has(String(entryOrder.status || "").toLowerCase())) {
        issues.push({
          type: "ACTIVE_ENTRY_ORDER_WITH_OPEN_POSITION",
          symbol,
          client_order_id: entry.client_order_id,
        });
      }
      const brokerEntryFilled = quantity(entryOrder.filled_qty);
      if (brokerEntryFilled === null || Math.abs(brokerEntryFilled - filled) > epsilon) {
        issues.push({
          type: "ENTRY_FILL_QUANTITY_MISMATCH",
          symbol,
          client_order_id: entry.client_order_id,
          journal_filled_qty: filled,
          broker_entry_filled_qty: brokerEntryFilled,
        });
      }
    }
    if (filled <= 0) continue;

    if (!entry.entry_order_id || !entryOrder) {
      issues.push({ type: "FILLED_ENTRY_ORDER_NOT_RECONCILED", symbol, client_order_id: entry.client_order_id });
    }

    let exited = 0;
    if (entry.exit_order_id) {
      if (!exitOrder) {
        issues.push({ type: "EXIT_ORDER_NOT_FOUND", symbol, client_order_id: entry.client_order_id });
      } else {
        const brokerExitFilled = quantity(exitOrder.filled_qty);
        if (normalizeSymbol(exitOrder.symbol) !== symbol ||
            String(exitOrder.side || "").toLowerCase() !== "sell") {
          issues.push({ type: "EXIT_ORDER_IDENTITY_MISMATCH", symbol, client_order_id: entry.client_order_id });
        } else if (brokerExitFilled === null || brokerExitFilled > filled) {
          issues.push({ type: "EXIT_FILL_QUANTITY_INVALID", symbol, client_order_id: entry.client_order_id });
        } else {
          exited += brokerExitFilled;
        }
      }
    }
    if (entry.emergency_exit_order_id) {
      if (!emergencyExitOrder) {
        // Missing emergency order is already reported above.
      } else {
        const emergencyFilled = quantity(emergencyExitOrder.filled_qty);
        if (normalizeSymbol(emergencyExitOrder.symbol) !== symbol ||
            String(emergencyExitOrder.side || "").toLowerCase() !== "sell") {
          issues.push({ type: "EMERGENCY_EXIT_ORDER_IDENTITY_MISMATCH", symbol, client_order_id: entry.client_order_id });
        } else if (emergencyFilled === null || emergencyFilled > filled) {
          issues.push({ type: "EMERGENCY_EXIT_FILL_QUANTITY_INVALID", symbol, client_order_id: entry.client_order_id });
        } else {
          exited += emergencyFilled;
        }
      }
    }

    let stopped = 0;
    let stopRemaining = 0;
    let stopIsActive = false;
    if (stopOrder) {
      const stopQty = quantity(stopOrder.qty);
      const stopFilledQty = quantity(stopOrder.filled_qty ?? 0);
      const stopState = String(stopOrder.status || "").toLowerCase();
      if (normalizeSymbol(stopOrder.symbol) !== symbol ||
          String(stopOrder.side || "").toLowerCase() !== "sell") {
        issues.push({ type: "PROTECTIVE_STOP_IDENTITY_MISMATCH", symbol, client_order_id: entry.client_order_id });
      } else if (
          stopQty === null || stopFilledQty === null || stopFilledQty > stopQty ||
          stopFilledQty > filled) {
        issues.push({ type: "PROTECTIVE_STOP_QUANTITY_INVALID", symbol, client_order_id: entry.client_order_id });
      } else {
        stopped = stopFilledQty;
        stopRemaining = Math.max(0, stopQty - stopFilledQty);
        stopIsActive = activeStopStates.has(stopState);
        if (stopIsActive && stopRemaining > 0) {
          protectedRemainingBySymbol.set(symbol, (protectedRemainingBySymbol.get(symbol) || 0) + stopRemaining);
        }
      }
    }

    const activeSellStates = new Set([
      "new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel",
    ]);
    const activeExitOrders = [exitOrder, emergencyExitOrder].filter(order =>
      order && String(order.side || "").toLowerCase() === "sell" &&
      activeSellStates.has(String(order.status || "").toLowerCase())
    );

    if (exited + stopped > filled + epsilon) {
      issues.push({
        type: "EXIT_FILLS_EXCEED_ENTRY_FILL",
        symbol,
        client_order_id: entry.client_order_id,
        entry_filled_qty: filled,
        exit_filled_qty: exited,
        stop_filled_qty: stopped,
      });
    }
    const expectedRemaining = Math.max(0, filled - exited - stopped);
    let activeExitRemaining = 0;
    for (const order of activeExitOrders) {
      const orderQty = quantity(order.qty);
      const orderFilledQty = quantity(order.filled_qty ?? 0);
      if (orderQty === null || orderFilledQty === null || orderFilledQty > orderQty) {
        issues.push({ type: "ACTIVE_EXIT_ORDER_QUANTITY_INVALID", symbol, client_order_id: entry.client_order_id });
      } else {
        activeExitRemaining += Math.max(0, orderQty - orderFilledQty);
      }
    }
    if (activeExitRemaining > expectedRemaining + epsilon) {
      issues.push({
        type: "ACTIVE_EXIT_ORDERS_EXCEED_REMAINING_POSITION",
        symbol,
        client_order_id: entry.client_order_id,
        active_exit_remaining_qty: activeExitRemaining,
        expected_remaining_qty: expectedRemaining,
      });
    }
    if (activeExitRemaining > epsilon && stopIsActive) {
      issues.push({
        type: "ACTIVE_EXIT_AND_PROTECTIVE_STOP_OVERLAP",
        symbol,
        client_order_id: entry.client_order_id,
      });
    }
    expectedPositionBySymbol.set(symbol, (expectedPositionBySymbol.get(symbol) || 0) + expectedRemaining);

    // Aggregate coverage alone can hide one oversized stop offset by another
    // undersized stop on the same symbol. Reconcile protection per journal row.
    if (stopOrder && stopIsActive && Math.abs(stopRemaining - expectedRemaining) > epsilon) {
      issues.push({
        type: "PROTECTIVE_STOP_QUANTITY_MISMATCH",
        symbol,
        client_order_id: entry.client_order_id,
        expected_remaining_qty: expectedRemaining,
        stop_remaining_qty: stopRemaining,
      });
    }

    if (expectedRemaining > epsilon) {
      if (!positions.some(position => normalizeSymbol(position.symbol) === symbol)) {
        issues.push({ type: "BROKER_POSITION_MISSING_FOR_FILLED_JOURNAL", symbol, client_order_id: entry.client_order_id });
      }
      if (!entry.stop_order_id || !stopOrder || !stopIsActive || stopRemaining <= 0) {
        issues.push({ type: "FILLED_POSITION_WITHOUT_ACTIVE_STOP", symbol, client_order_id: entry.client_order_id });
      }
    }
  }

  for (const [symbol, expectedQty] of expectedPositionBySymbol) {
    const brokerQty = brokerQtyBySymbol.get(symbol) || 0;
    if (Math.abs(expectedQty - brokerQty) > epsilon) {
      issues.push({
        type: "JOURNAL_POSITION_QUANTITY_MISMATCH",
        symbol,
        journal_expected_qty: expectedQty,
        broker_position_qty: brokerQty,
      });
    }
    const stopRemainingQty = protectedRemainingBySymbol.get(symbol) || 0;
    if (brokerQty > epsilon && stopRemainingQty + epsilon < brokerQty) {
      issues.push({
        type: "PROTECTIVE_STOP_UNDERCOVERS_POSITION",
        symbol,
        stop_remaining_qty: stopRemainingQty,
        broker_position_qty: brokerQty,
      });
    } else if (stopRemainingQty > brokerQty + epsilon) {
      issues.push({
        type: "PROTECTIVE_STOP_EXCEEDS_POSITION",
        symbol,
        stop_remaining_qty: stopRemainingQty,
        broker_position_qty: brokerQty,
      });
    }
  }

  for (const position of positions) {
    const symbol = normalizeSymbol(position.symbol);
    const trackedQty = expectedPositionBySymbol.get(symbol) || 0;
    if (trackedQty <= epsilon) issues.push({ type: "UNTRACKED_BROKER_POSITION", symbol });
  }

  const trackedOrderIds = new Set(journal.flatMap(entry => [
    entry.entry_order_id, entry.stop_order_id, entry.exit_order_id, entry.emergency_exit_order_id,
  ]).filter(Boolean));
  const untrackedOrders = orders
    .filter(order => {
      const status = String(order.status || "").toLowerCase();
      const active = ["new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel"].includes(status);
      return active && SYMBOLS.includes(normalizeSymbol(order.symbol)) && !trackedOrderIds.has(order.id);
    })
    .map(order => ({ id: order.id, symbol: normalizeSymbol(order.symbol), side: order.side, status: order.status }));
  for (const order of untrackedOrders) {
    issues.push({ type: "UNTRACKED_BROKER_ORDER", symbol: order.symbol, broker_order_id: order.id });
  }

  return {
    status: issues.length ? "REVIEW_REQUIRED" : "IN_SYNC",
    checked_at: new Date().toISOString(),
    journal_active: journal.length,
    broker_orders_checked: orders.length,
    broker_positions_checked: positions.length,
    issues,
    untracked_orders: untrackedOrders,
  };
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
      alpaca_configured: configured(env), access_configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
      bot: { ...bot, signals_recorded: count?.total || 0 },
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
      if (path === "/api/alpaca/reconciliation") {
        const [orderHistory, positions, journalHistory] = await Promise.all([
          fetchAllBrokerOrders(env),
          alpacaFetch(env, PAPER_BASE, "/v2/positions"),
          fetchAllJournalRows(env),
        ]);
        return response({
          ok: true,
          mode: "PAPER",
          execution_enabled: false,
          reconciliation: buildReconciliation(
            journalHistory.rows,
            orderHistory.orders,
            positions.filter(position => SYMBOLS.includes(normalizeSymbol(position.symbol))),
            { orders: orderHistory.complete, journal: journalHistory.complete },
          ),
        });
      }
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

function redirectToCondor(request, env) {
  const destination = String(env.CONDOR_WEB_URL || "").trim();
  try {
    const target = new URL(destination);
    const source = new URL(request.url);
    if (target.protocol !== "https:" || target.username || target.password) {
      return response({ ok: false, error: "condor_url_must_be_https" }, 503);
    }
    if (target.origin === source.origin) {
      return response({ ok: false, error: "condor_redirect_loop_blocked" }, 503);
    }
    return Response.redirect(target.href, 302);
  } catch {
    return response({ ok: false, error: "condor_runtime_not_configured" }, 503);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // Condor is the primary application when its authenticated HTTPS runtime
    // is configured. Keep the Miracolo static page as a diagnostic fallback.
    if (url.pathname === "/condor" || (url.pathname === "/" && env.CONDOR_WEB_URL)) {
      return redirectToCondor(request, env);
    }
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
