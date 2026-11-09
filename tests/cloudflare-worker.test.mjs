import test from "node:test";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";

function mockDb() {
  const state = { status: null, writes: 0 };
  return {
    state,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              state.writes += 1;
              if (sql.startsWith("INSERT INTO worker_status")) {
                state.status = {
                  status: values[0],
                  message: values[1],
                  last_heartbeat: values[2],
                  last_cycle: values[3],
                };
              }
              return { meta: { changes: 1 } };
            },
            async first() {
              if (sql.includes("COUNT(*)")) return { total: 0 };
              return state.status;
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
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
