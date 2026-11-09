import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

function mockDb() {
  const state = { status: null, writes: 0, signals: 0 };
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
          if (sql.startsWith("INSERT OR IGNORE INTO signals")) state.signals += 1;
          return { meta: { changes: 0 } };
        },
        async first() {
          if (sql.includes("COUNT(*)")) return { total: state.signals };
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
    assert.equal(DB.state.signals, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
