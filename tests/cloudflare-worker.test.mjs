import test from "node:test";
import assert from "node:assert/strict";
import worker, { buildReconciliation, fetchAllBrokerOrders, fetchAllJournalRows } from "../cloudflare/worker.js";

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
          if (sql.startsWith("INSERT INTO scan_cursors")) {
            assert.match(sql, /WHERE excluded\.last_bar_time > scan_cursors\.last_bar_time/);
            state.cursors.set(statement.values[0], statement.values[1]);
          }
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

test("broker order history follows before_order_id cursors and reports complete pages", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (requests.length === 1) {
      return Response.json(Array.from({ length: 500 }, (_, index) => ({ id: `order-${index}` })));
    }
    return Response.json([{ id: "older-order" }]);
  };
  try {
    const result = await fetchAllBrokerOrders({
      APCA_API_KEY_ID: "paper-key",
      APCA_API_SECRET_KEY: "paper-secret",
    });
    assert.equal(result.complete, true);
    assert.equal(result.orders.length, 501);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get("limit"), "500");
    assert.equal(requests[0].searchParams.get("before_order_id"), null);
    assert.equal(requests[1].searchParams.get("before_order_id"), "order-499");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("broker order history is marked incomplete when the page bound is reached", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(Array.from({ length: 500 }, (_, index) => ({ id: `order-${index}` })));
  try {
    const result = await fetchAllBrokerOrders({
      APCA_API_KEY_ID: "paper-key",
      APCA_API_SECRET_KEY: "paper-secret",
    }, 1);
    assert.equal(result.complete, false);
    assert.equal(result.orders.length, 500);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("journal pagination uses an immutable keyset cursor and marks capped history incomplete", async () => {
  const queries = [];
  const DB = {
    prepare(sql) {
      const query = { sql, values: [] };
      queries.push(query);
      return {
        bind(...values) {
          query.values = values;
          return this;
        },
        async all() {
          if (queries.length === 1 || queries.length === 2) {
            const offset = queries.length === 1 ? 0 : 200;
            const length = queries.length === 1 ? 200 : 5;
            return {
              results: Array.from({ length }, (_, index) => ({
                client_order_id: `order-${String(offset + length - index - 1).padStart(3, "0")}`,
                created_at: "2026-11-22T10:00:00.000Z",
              })),
            };
          }
          return { results: [] };
        },
      };
    },
  };
  const complete = await fetchAllJournalRows({ DB });
  assert.equal(complete.complete, true);
  assert.equal(complete.rows.length, 205);
  assert.match(queries[0].sql, /ORDER BY created_at DESC, client_order_id DESC LIMIT 200/);
  assert.ok(queries[1].sql.includes("created_at < ? OR (created_at = ? AND client_order_id < ?)"));
  assert.deepEqual(queries[1].values, ["2026-11-22T10:00:00.000Z", "2026-11-22T10:00:00.000Z", "order-000"]);

  queries.length = 0;
  const capped = await fetchAllJournalRows({ DB }, 1);
  assert.equal(capped.complete, false);
  assert.equal(capped.rows.length, 200);
});
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
  assert.equal(body.access_configured, false);
  assert.equal("APCA_API_SECRET_KEY" in body, false);
});

test("health endpoint reports Cloudflare Access readiness without exposing configuration values", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/api/health"), {
    DB,
    ACCESS_TEAM_DOMAIN: "example-team",
    ACCESS_AUD: "example-audience",
  });
  const body = await result.json();
  assert.equal(result.status, 200);
  assert.equal(body.access_configured, true);
  assert.equal(body.ACCESS_TEAM_DOMAIN, undefined);
  assert.equal(body.ACCESS_AUD, undefined);
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

test("scanner ignores malformed boolean and array market prices", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(minute - (40 - index) * 60_000).toISOString(),
      c: "100",
    }));
    bars.unshift(
      { t: new Date(minute - 100 * 60_000).toISOString(), c: true },
      { t: new Date(minute - 99 * 60_000).toISOString(), c: [100] },
    );
    return Response.json({ bars: { [symbol]: bars } });
  };
  try {
    let scheduledPromise;
    await worker.scheduled({}, { DB, APCA_API_KEY_ID: "paper-key", APCA_API_SECRET_KEY: "paper-secret" }, {
      waitUntil(promise) { scheduledPromise = promise; },
    });
    await scheduledPromise;
    assert.equal(DB.state.status.status, "MONITORING");
    assert.equal(DB.state.signals.length, 0);
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

test("scanner does not report a history gap when cursor is inside the retained EMA warmup window", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const symbols = ["BTC/USD", "ETH/USD", "QNT/USD"];
  for (const symbol of symbols) {
    DB.state.cursors.set(symbol, new Date(minute - 34 * 60_000).toISOString());
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
    assert.equal(DB.state.status.status, "MONITORING");
    assert.doesNotMatch(DB.state.status.message, /interruzione nello storico/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner marks a cursor ahead of market data as degraded", async () => {
  const DB = mockDb();
  const originalFetch = globalThis.fetch;
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const symbols = ["BTC/USD", "ETH/USD", "QNT/USD"];
  for (const symbol of symbols) {
    DB.state.cursors.set(symbol, new Date(minute + 60_000).toISOString());
  }
  globalThis.fetch = async url => {
    const symbol = new URL(url).searchParams.get("symbols");
    const bars = Array.from({ length: 40 }, (_, index) => ({
      t: new Date(minute - (40 - index) * 60_000).toISOString(),
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
    assert.match(DB.state.status.message, /cursori successivi ai dati/);
    assert.equal(DB.state.signals.length, 0);
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

test("reconciliation fails closed when broker or journal history is truncated", () => {
  const brokerIncomplete = buildReconciliation([], [], [], { orders: false, journal: true });
  assert.equal(brokerIncomplete.status, "REVIEW_REQUIRED");
  assert.ok(brokerIncomplete.issues.some(issue => issue.type === "BROKER_ORDER_HISTORY_INCOMPLETE"));

  const journalIncomplete = buildReconciliation([], [], [], { orders: true, journal: false });
  assert.equal(journalIncomplete.status, "REVIEW_REQUIRED");
  assert.ok(journalIncomplete.issues.some(issue => issue.type === "JOURNAL_HISTORY_INCOMPLETE"));
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
      { id: "entry-1", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-1", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.equal(result.status, "IN_SYNC");
  assert.equal(result.issues.length, 0);
});

test("reconciliation accounts for broker-confirmed partial exits", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-exit",
      symbol: "BTC/USD",
      state: "EXIT_SUBMITTED",
      entry_order_id: "entry-exit",
      filled_qty: "0.01",
      stop_order_id: "stop-exit",
      exit_order_id: "exit-1",
    }],
    [
      { id: "entry-exit", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-exit", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.005", filled_qty: "0" },
      { id: "exit-1", symbol: "BTC/USD", side: "sell", status: "filled", qty: "0.005", filled_qty: "0.005" },
    ],
    [{ symbol: "BTC/USD", qty: "0.005" }],
  );
  assert.equal(result.status, "IN_SYNC");
  assert.equal(result.issues.length, 0);
});

test("reconciliation rejects a mismatch between journal entry fills and broker entry fills", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-entry-fill",
      symbol: "ETH/USD",
      state: "PROTECTED",
      entry_order_id: "entry-fill",
      filled_qty: "0.01",
      stop_order_id: "stop-fill",
    }],
    [
      { id: "entry-fill", symbol: "ETH/USD", side: "buy", status: "partially_filled", filled_qty: "0.005" },
      { id: "stop-fill", symbol: "ETH/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "ETH/USD", qty: "0.01" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ENTRY_FILL_QUANTITY_MISMATCH"));
});

test("reconciliation rejects a broker position quantity that differs from the journal", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-qty",
      symbol: "BTC/USD",
      state: "PROTECTED",
      entry_order_id: "entry-qty",
      filled_qty: "0.01",
      stop_order_id: "stop-qty",
    }],
    [
      { id: "entry-qty", symbol: "BTC/USD", side: "buy", status: "filled" },
      { id: "stop-qty", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.005" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "JOURNAL_POSITION_QUANTITY_MISMATCH"));
});

test("reconciliation rejects a protective stop that does not cover the broker position", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-stop",
      symbol: "ETH/USD",
      state: "PROTECTED",
      entry_order_id: "entry-stop",
      filled_qty: "0.01",
      stop_order_id: "stop-short",
    }],
    [
      { id: "entry-stop", symbol: "ETH/USD", side: "buy", status: "filled" },
      { id: "stop-short", symbol: "ETH/USD", side: "sell", status: "accepted", qty: "0.005", filled_qty: "0" },
    ],
    [{ symbol: "ETH/USD", qty: "0.01" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "PROTECTIVE_STOP_UNDERCOVERS_POSITION"));
});

test("reconciliation subtracts filled protective-stop quantity from remaining exposure", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-partial-stop",
      symbol: "QNT/USD",
      state: "PROTECTED",
      entry_order_id: "entry-partial-stop",
      filled_qty: "10",
      stop_order_id: "stop-partial",
    }],
    [
      { id: "entry-partial-stop", symbol: "QNT/USD", side: "buy", status: "filled", filled_qty: "10" },
      { id: "stop-partial", symbol: "QNT/USD", side: "sell", status: "partially_filled", qty: "10", filled_qty: "5" },
    ],
    [{ symbol: "QNT/USD", qty: "5" }],
  );
  assert.equal(result.status, "IN_SYNC");
  assert.equal(result.issues.length, 0);
});

test("reconciliation catches broker fills missing from a zero-filled journal row", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-missed-fill",
      symbol: "ETH/USD",
      state: "ENTRY_SUBMITTED",
      entry_order_id: "entry-missed-fill",
      filled_qty: "0",
    }],
    [{ id: "entry-missed-fill", symbol: "ETH/USD", side: "buy", status: "partially_filled", filled_qty: "0.005" }],
    [{ symbol: "ETH/USD", qty: "0.005" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ENTRY_FILL_QUANTITY_MISMATCH"));
  assert.ok(result.issues.some(issue => issue.type === "UNTRACKED_BROKER_POSITION"));
});

test("reconciliation requires an entry order id once the lifecycle has submitted an entry", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-no-entry-id",
      symbol: "BTC/USD",
      state: "ENTRY_SUBMITTED",
      filled_qty: "0",
    }],
    [],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ENTRY_ORDER_ID_MISSING"));
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

test("reconciliation detects combined exit and stop fills exceeding entry exposure", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-overexit",
      symbol: "BTC/USD",
      state: "EXIT_SUBMITTED",
      entry_order_id: "entry-overexit",
      filled_qty: "0.01",
      stop_order_id: "stop-overexit",
      exit_order_id: "exit-overexit",
    }],
    [
      { id: "entry-overexit", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-overexit", symbol: "BTC/USD", side: "sell", status: "partially_filled", qty: "0.01", filled_qty: "0.006" },
      { id: "exit-overexit", symbol: "BTC/USD", side: "sell", status: "partially_filled", qty: "0.01", filled_qty: "0.006" },
    ],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "EXIT_FILLS_EXCEED_ENTRY_FILL"));
});

test("reconciliation rejects a protective stop larger than the remaining broker position", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-oversized-stop",
      symbol: "BTC/USD",
      state: "PROTECTED",
      entry_order_id: "entry-oversized",
      filled_qty: "0.01",
      stop_order_id: "stop-oversized",
      exit_order_id: "exit-partial",
    }],
    [
      { id: "entry-oversized", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-oversized", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
      { id: "exit-partial", symbol: "BTC/USD", side: "sell", status: "partially_filled", qty: "0.01", filled_qty: "0.005" },
    ],
    [{ symbol: "BTC/USD", qty: "0.005" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "PROTECTIVE_STOP_EXCEEDS_POSITION"));
});

test("reconciliation checks protective stop coverage per position, not only per symbol", () => {
  const result = buildReconciliation(
    [
      {
        client_order_id: "client-stop-over",
        symbol: "BTC/USD",
        state: "PROTECTED",
        entry_order_id: "entry-stop-over",
        filled_qty: "0.01",
        stop_order_id: "stop-over",
      },
      {
        client_order_id: "client-stop-under",
        symbol: "BTC/USD",
        state: "PROTECTED",
        entry_order_id: "entry-stop-under",
        filled_qty: "0.01",
        stop_order_id: "stop-under",
      },
    ],
    [
      { id: "entry-stop-over", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "entry-stop-under", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-over", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.015", filled_qty: "0" },
      { id: "stop-under", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.005", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.02" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.issues.filter(issue => issue.type === "PROTECTIVE_STOP_QUANTITY_MISMATCH").length, 2);
});

test("reconciliation requires and tracks submitted emergency exit order ids", () => {
  const missing = buildReconciliation(
    [{
      client_order_id: "client-emergency-missing",
      symbol: "BTC/USD",
      state: "EMERGENCY_EXIT_SUBMITTED",
      entry_order_id: "entry-emergency-missing",
      filled_qty: "0.01",
    }],
    [{ id: "entry-emergency-missing", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" }],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.equal(missing.status, "REVIEW_REQUIRED");
  assert.ok(missing.issues.some(issue => issue.type === "EMERGENCY_EXIT_ORDER_ID_MISSING"));

  const reconciled = buildReconciliation(
    [{
      client_order_id: "client-emergency-filled",
      symbol: "ETH/USD",
      state: "EMERGENCY_EXIT_SUBMITTED",
      entry_order_id: "entry-emergency-filled",
      filled_qty: "0.01",
      stop_order_id: "stop-emergency-filled",
      emergency_exit_order_id: "emergency-filled",
    }],
    [
      { id: "entry-emergency-filled", symbol: "ETH/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-emergency-filled", symbol: "ETH/USD", side: "sell", status: "canceled", qty: "0.01", filled_qty: "0" },
      { id: "emergency-filled", symbol: "ETH/USD", side: "sell", status: "filled", qty: "0.01", filled_qty: "0.01" },
    ],
    [],
  );
  assert.equal(reconciled.status, "IN_SYNC");
  assert.equal(reconciled.untracked_orders.length, 0);
});

test("reconciliation adds normal and emergency exit fills before computing remaining exposure", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-double-exit",
      symbol: "BTC/USD",
      state: "EMERGENCY_EXIT_SUBMITTED",
      entry_order_id: "entry-double-exit",
      filled_qty: "0.01",
      exit_order_id: "normal-exit",
      emergency_exit_order_id: "emergency-exit",
    }],
    [
      { id: "entry-double-exit", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "normal-exit", symbol: "BTC/USD", side: "sell", status: "filled", qty: "0.01", filled_qty: "0.006" },
      { id: "emergency-exit", symbol: "BTC/USD", side: "sell", status: "filled", qty: "0.01", filled_qty: "0.006" },
    ],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "EXIT_FILLS_EXCEED_ENTRY_FILL"));
});

test("reconciliation flags active exit orders that overlap an active protective stop", () => {
  const normal = buildReconciliation(
    [{
      client_order_id: "client-overlap-normal",
      symbol: "BTC/USD",
      state: "EXIT_SUBMITTED",
      entry_order_id: "entry-overlap-normal",
      filled_qty: "0.01",
      stop_order_id: "stop-overlap-normal",
      exit_order_id: "exit-overlap-normal",
    }],
    [
      { id: "entry-overlap-normal", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-overlap-normal", symbol: "BTC/USD", side: "sell", status: "pending_cancel", qty: "0.01", filled_qty: "0" },
      { id: "exit-overlap-normal", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.equal(normal.status, "REVIEW_REQUIRED");
  assert.ok(normal.issues.some(issue => issue.type === "ACTIVE_EXIT_AND_PROTECTIVE_STOP_OVERLAP"));

  const emergency = buildReconciliation(
    [{
      client_order_id: "client-overlap-emergency",
      symbol: "ETH/USD",
      state: "EMERGENCY_EXIT_SUBMITTED",
      entry_order_id: "entry-overlap-emergency",
      filled_qty: "0.01",
      stop_order_id: "stop-overlap-emergency",
      emergency_exit_order_id: "exit-overlap-emergency",
    }],
    [
      { id: "entry-overlap-emergency", symbol: "ETH/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-overlap-emergency", symbol: "ETH/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
      { id: "exit-overlap-emergency", symbol: "ETH/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "ETH/USD", qty: "0.01" }],
  );
  assert.equal(emergency.status, "REVIEW_REQUIRED");
  assert.ok(emergency.issues.some(issue => issue.type === "ACTIVE_EXIT_AND_PROTECTIVE_STOP_OVERLAP"));
});

test("reconciliation verifies broker order symbols and sides against journal references", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-order-identity",
      symbol: "BTC/USD",
      state: "PROTECTED",
      entry_order_id: "entry-wrong-identity",
      filled_qty: "0.01",
      stop_order_id: "stop-wrong-identity",
      exit_order_id: "exit-wrong-identity",
    }],
    [
      { id: "entry-wrong-identity", symbol: "ETH/USD", side: "sell", status: "filled", filled_qty: "0.01" },
      { id: "stop-wrong-identity", symbol: "ETH/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
      { id: "exit-wrong-identity", symbol: "ETH/USD", side: "sell", status: "filled", qty: "0.01", filled_qty: "0.01" },
    ],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ENTRY_ORDER_IDENTITY_MISMATCH"));
  assert.ok(result.issues.some(issue => issue.type === "PROTECTIVE_STOP_IDENTITY_MISMATCH"));
  assert.ok(result.issues.some(issue => issue.type === "EXIT_ORDER_IDENTITY_MISMATCH"));
});

test("reconciliation rejects active normal and emergency exits that exceed remaining exposure", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-active-exit-over",
      symbol: "BTC/USD",
      state: "EMERGENCY_EXIT_SUBMITTED",
      entry_order_id: "entry-active-exit-over",
      filled_qty: "0.01",
      exit_order_id: "normal-exit-active",
      emergency_exit_order_id: "emergency-exit-active",
    }],
    [
      { id: "entry-active-exit-over", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "normal-exit-active", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
      { id: "emergency-exit-active", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ACTIVE_EXIT_ORDERS_EXCEED_REMAINING_POSITION"));
});

test("reconciliation requires broker order ids for submitted exit and protection states", () => {
  const exitMissing = buildReconciliation(
    [{
      client_order_id: "client-exit-id-missing",
      symbol: "BTC/USD",
      state: "EXIT_SUBMITTED",
      entry_order_id: "entry-exit-id-missing",
      filled_qty: "0.01",
      stop_order_id: "stop-exit-id-missing",
    }],
    [
      { id: "entry-exit-id-missing", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: "0.01" },
      { id: "stop-exit-id-missing", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.01", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.01" }],
  );
  assert.ok(exitMissing.issues.some(issue => issue.type === "EXIT_ORDER_ID_MISSING"));

  const stopMissing = buildReconciliation(
    [{
      client_order_id: "client-stop-id-missing",
      symbol: "ETH/USD",
      state: "PROTECTED",
      entry_order_id: "entry-stop-id-missing",
      filled_qty: "0.01",
    }],
    [{ id: "entry-stop-id-missing", symbol: "ETH/USD", side: "buy", status: "filled", filled_qty: "0.01" }],
    [{ symbol: "ETH/USD", qty: "0.01" }],
  );
  assert.ok(stopMissing.issues.some(issue => issue.type === "PROTECTIVE_STOP_ORDER_ID_MISSING"));
});

test("reconciliation flags an active entry order while its partial position is open", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-active-entry",
      symbol: "BTC/USD",
      state: "ENTRY_PARTIALLY_FILLED",
      entry_order_id: "entry-active-partial",
      filled_qty: "0.005",
      stop_order_id: "stop-active-partial",
    }],
    [
      { id: "entry-active-partial", symbol: "BTC/USD", side: "buy", status: "partially_filled", qty: "0.01", filled_qty: "0.005" },
      { id: "stop-active-partial", symbol: "BTC/USD", side: "sell", status: "accepted", qty: "0.005", filled_qty: "0" },
    ],
    [{ symbol: "BTC/USD", qty: "0.005" }],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "ACTIVE_ENTRY_ORDER_WITH_OPEN_POSITION"));
});

test("reconciliation rejects filled lifecycle states with zero journal fill", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-zero-filled-state",
      symbol: "ETH/USD",
      state: "ENTRY_FILLED",
      entry_order_id: "entry-zero-filled-state",
      filled_qty: "0",
    }],
    [{ id: "entry-zero-filled-state", symbol: "ETH/USD", side: "buy", status: "canceled", qty: "0.01", filled_qty: "0" }],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "LIFECYCLE_STATE_WITHOUT_ENTRY_FILL"));
});

test("reconciliation rejects boolean journal and broker quantities", () => {
  const result = buildReconciliation(
    [{
      client_order_id: "client-boolean-fill",
      symbol: "BTC/USD",
      state: "ENTRY_FILLED",
      entry_order_id: "entry-boolean-fill",
      filled_qty: true,
    }],
    [{ id: "entry-boolean-fill", symbol: "BTC/USD", side: "buy", status: "filled", filled_qty: true }],
    [],
  );
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.ok(result.issues.some(issue => issue.type === "JOURNAL_FILLED_QUANTITY_INVALID"));
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


test("Condor route redirects only to a configured HTTPS dashboard", async () => {
  const DB = mockDb();
  const ok = await worker.fetch(new Request("https://example.workers.dev/condor"), {
    DB,
    CONDOR_WEB_URL: "https://condor.example.com/web",
  });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "https://condor.example.com/web");
});

test("root route redirects to the original Condor dashboard when configured", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/"), {
    DB,
    CONDOR_WEB_URL: "https://condor.example.com/web",
  });
  assert.equal(result.status, 302);
  assert.equal(result.headers.get("location"), "https://condor.example.com/web");
});

test("root route keeps the diagnostic static app when Condor is not configured", async () => {
  const DB = mockDb();
  const assets = { async fetch() { return new Response("diagnostic fallback", { status: 200 }); } };
  const result = await worker.fetch(new Request("https://example.workers.dev/"), { DB, ASSETS: assets });
  assert.equal(result.status, 200);
  assert.equal(await result.text(), "diagnostic fallback");
});

test("Condor route blocks redirect loops", async () => {
  const DB = mockDb();
  const result = await worker.fetch(new Request("https://example.workers.dev/condor"), {
    DB,
    CONDOR_WEB_URL: "https://example.workers.dev/",
  });
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error, "condor_redirect_loop_blocked");
});

test("Condor route fails closed when the dashboard URL is missing or unsafe", async () => {
  const DB = mockDb();
  const missing = await worker.fetch(new Request("https://example.workers.dev/condor"), { DB });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).error, "condor_runtime_not_configured");
  const unsafe = await worker.fetch(new Request("https://example.workers.dev/condor"), {
    DB,
    CONDOR_WEB_URL: "http://condor.internal:8088",
  });
  assert.equal(unsafe.status, 503);
  assert.equal((await unsafe.json()).error, "condor_url_must_be_https");
});
