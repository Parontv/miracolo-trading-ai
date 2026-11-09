import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildReconciliation } from "../cloudflare/worker.js";

function mockDb() {
  const state = { status: null, writes: 0, signals: [], cursors: new Map() };
  return {
    state,
    prepare(sql) {
      const statement = {
        bind(...values) {
          statement.values = values;
          return statement;
        },
        async run() {
          state.writes += 1;
          if (sql.startsWith("INSERT INTO worker_status")) {
            state.status = {
              status: statement.values[0],
              message: statement.values[1],
              last_heartbeat: statement.values[2],
              last_cycle: statement.values[3],
            };
          }
          if (sql.startsWith("INSERT OR IGNORE INTO signals")) state.signals.push(statement.values);
          if (sql.startsWith("INSERT INTO scan_cursors")) state.cursors.set(statement.values[0], statement.values[1]);
          return { meta: { changes: sql.startsWith("INSERT OR IGNORE INTO signals") ? 1 : 0 } };
        },
        async first() {
          if (sql.includes("COUNT(*)")) return { total: state.signals.length };
          if (sql.includes("SELECT last_bar_time")) {
            const last_bar_time = state.cursors.get(statement.values[0]);
            return last_bar_time ? { last_bar_time } : null;
          }
          return state.status;
        },
        async all() { return { results: [] }; },
      };
      return statement;
    },
  };
}

test("health endpoint reports PAPER-only mode without leaking credentials", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/api/health"), { DB });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.mode, "PAPER");
  assert.equal(body.live_enabled, false);
  assert.equal(body.execution_enabled, false);
  assert.equal(body.alpaca_configured, false);
  assert.equal("APCA_API_SECRET_KEY" in body, false);
});

test("private Alpaca endpoints fail closed without Cloudflare Access", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/api/alpaca/status"), { DB });
  const body = await result.json();
  assert.equal(result.status, 401);
  assert.equal(body.error, "cloudflare_access_required");
});

test("unknown API routes return 404", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/api/not-real"), { DB });
  assert.equal(result.status, 404);
});

test("scheduled scanner records waiting-for-credentials state without Alpaca secrets", async () => {
  const DB = mockDb();
  let scheduledPromise;
  await worker.scheduled({}, { DB }, { waitUntil(promise) { scheduledPromise = promise; } });
  await scheduledPromise;
  assert.equal(DB.state.status.status, "WAITING_CREDENTIALS");
  assert.equal(DB.state.writes, 1);
});

test("scheduled scanner requests each crypto symbol separately and records a heartbeat", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const requested = [];
  const now = Date.now();
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    const symbol = parsed.searchParams.get("symbols");
    requested.push(symbol);
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(now - (40 - index) * 60_000).toISOString(),
      c: "100",
    }));
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    assert.deepEqual(requested.sort(), ["BTC/USD", "ETH/USD", "QNT/USD"]);
    assert.equal(DB.state.status.status, "MONITORING");
    assert.equal(DB.state.signals.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner only creates EMA crossover signals from fully closed bars", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(minute - (40 - index) * 60_000).toISOString(),
      c: index === 39 ? "120" : "100",
    }));
    if (symbol === "BTC/USD") {
      bars[39].t = new Date(minute).toISOString();
    }
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    const signalledSymbols = DB.state.signals.map(values => values[1]).sort();
    assert.deepEqual(signalledSymbols, ["ETH/USD", "QNT/USD"]);
    assert.ok(DB.state.signals.every(values => values[2] === "BUY"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner degrades instead of trusting stale market data", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(now - (20 + 40 - index) * 60_000).toISOString(),
      c: "100",
    }));
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    assert.equal(DB.state.status.status, "DEGRADED");
    assert.match(DB.state.status.message, /dati non aggiornati/);
    assert.equal(DB.state.signals.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner catches a crossover on a bar missed between scheduled runs", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const symbols = ["BTC/USD", "ETH/USD", "QNT/USD"];
  for (const symbol of symbols) {
    DB.state.cursors.set(symbol, new Date(minute - 3 * 60_000).toISOString());
  }
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(minute - (40 - index) * 60_000).toISOString(),
      c: index >= 38 ? "120" : "100",
    }));
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    assert.deepEqual(DB.state.signals.map(values => values[1]).sort(), symbols);
    assert.ok(DB.state.signals.every(values => values[2] === "BUY"));
    assert.equal(DB.state.status.status, "MONITORING");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner recovers from a cursor older than retained bar history", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const symbols = ["BTC/USD", "ETH/USD", "QNT/USD"];
  for (const symbol of symbols) {
    DB.state.cursors.set(symbol, new Date(minute - 200 * 60_000).toISOString());
  }
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(minute - (40 - index) * 60_000).toISOString(),
      c: index >= 38 ? "120" : "100",
    }));
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    assert.deepEqual(DB.state.signals.map(values => values[1]).sort(), symbols);
    assert.equal(DB.state.status.status, "DEGRADED");
    assert.match(DB.state.status.message, /interruzione nello storico/);
    assert.ok(symbols.every(symbol => DB.state.cursors.get(symbol) === new Date(minute - 60_000).toISOString()));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reconciliation reports matching protected journal and broker state as in sync", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-1",
      symbol: "BTC/USD",
      state: "PROTECTED",
      entry_order_id: "entry-1",
      filled_qty: 0.01,
      stop_order_id: "stop-1",
      stop_status: "accepted",
    }],
    [
      { id: "entry-1", symbol: "BTC/USD", side: "buy", status: "filled" },
      { id: "stop-1", symbol: "BTC/USD", side: "sell", status: "accepted" },
    ],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.equal(result.status, "IN_SYNC");
  assert.equal(result.issues.length, 0);
});

test("reconciliation flags filled positions without an active protective stop", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-2",
      symbol: "ETH/USD",
      state: "ENTRY_FILLED",
      entry_order_id: "entry-2",
      filled_qty: 0.5,
    }],
    [{ id: "entry-2", symbol: "ETH/USD", side: "buy", status: "filled" }],
    [{ symbol: "ETH/USD", qty: "0.5" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "FILLED_POSITION_WITHOUT_ACTIVE_STOP"));
});

test("reconciliation detects untracked active orders and positions without flagging old closed orders", () => {
  const result = buildReconciliation(
    [],
    [
      { id: "old-1", symbol: "BTC/USD", side: "buy", status: "filled" },
      { id: "open-1", symbol: "QNT/USD", side: "buy", status: "new" },
    ],
    [{ symbol: "ETH/USD", qty: "1" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "UNTRACKED_BROKER_ORDER"));
  assert.ok(result.issues.some(issue => issue.type === "UNTRACKED_BROKER_POSITION"));
  assert.equal(result.untracked_orders.length, 1);
});

test("reconciliation detects a filled journal row without a broker position", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-3",
      symbol: "QNT/USD",
      state: "PROTECTED",
      entry_order_id: "entry-3",
      filled_qty: 2,
      stop_order_id: "stop-3",
      stop_status: "accepted",
    }],
    [
      { id: "entry-3", symbol: "QNT/USD", side: "buy", status: "filled" },
      { id: "stop-3", symbol: "QNT/USD", side: "sell", status: "accepted" },
    ],
    [],
  );
  assert.ok(result.issues.some(issue => issue.type === "BROKER_POSITION_MISSING_FOR_FILLED_JOURNAL"));
});
