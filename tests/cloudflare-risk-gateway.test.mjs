import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRisk } from "../cloudflare/risk-gateway.js";

const baseSnapshot = {
  broker: "alpaca-paper",
  liveEnabled: false,
  killSwitch: false,
  dailyPnlUsd: 0,
  openPositions: 1,
  pendingBuyReservations: 0,
  ordersLastMinute: 0,
};

const buyIntent = {
  symbol: "BTC/USD",
  side: "BUY",
  notionalUsd: 50,
  referencePrice: 100,
  stopLossPrice: 95,
  aiGenerated: false,
};

test("approves a bounded PAPER buy with a valid stop-loss reference", () => {
  assert.deepEqual(evaluateRisk(buyIntent, baseSnapshot), { allowed: true, reason: "approved" });
});

test("blocks buys when the daily loss limit has been reached", () => {
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, dailyPnlUsd: -15 }).reason, "daily_loss_limit");
});

test("counts pending reservations against the open position limit", () => {
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, openPositions: 2, pendingBuyReservations: 1 }).reason, "position_limit");
});

test("blocks an order above the notional limit and invalid numeric values", () => {
  assert.equal(evaluateRisk({ ...buyIntent, notionalUsd: 100.01 }, baseSnapshot).reason, "order_notional_limit");
  assert.equal(evaluateRisk({ ...buyIntent, notionalUsd: Number.NaN }, baseSnapshot).reason, "invalid_notional");
});

test("requires a protective stop-loss below the reference price", () => {
  assert.equal(evaluateRisk({ ...buyIntent, stopLossPrice: null }, baseSnapshot).reason, "stop_loss_required");
  assert.equal(evaluateRisk({ ...buyIntent, stopLossPrice: 101 }, baseSnapshot).reason, "invalid_stop_loss");
});

test("fails closed when risk snapshot fields are missing", () => {
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, dailyPnlUsd: null }).reason, "daily_pnl_unknown");
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, ordersLastMinute: null }).reason, "order_rate_unknown");
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, killSwitch: undefined }).reason, "kill_switch_state_unknown");
});

test("blocks AI-generated orders and symbols outside the allowlist", () => {
  assert.equal(evaluateRisk({ ...buyIntent, aiGenerated: true }, baseSnapshot).reason, "ai_order_not_allowed");
  assert.equal(evaluateRisk({ ...buyIntent, symbol: "SOL/USD" }, baseSnapshot).reason, "symbol_not_allowed");
});

test("kill switch still permits a bounded reduce-only sell", () => {
  const sell = { symbol: "BTC/USD", side: "SELL", notionalUsd: 50, quantity: 0.01, reduceOnly: true };
  const snapshot = { ...baseSnapshot, killSwitch: true, heldQuantity: 0.02 };
  assert.equal(evaluateRisk(sell, snapshot).allowed, true);
  assert.equal(evaluateRisk({ ...sell, quantity: 0.03 }, snapshot).reason, "sell_exceeds_position");
});

test("enforces the per-minute order rate limit without a daily trade-count cap", () => {
  assert.equal(evaluateRisk(buyIntent, { ...baseSnapshot, ordersLastMinute: 2 }).reason, "order_rate_limit");
  for (let i = 0; i < 20; i += 1) {
    assert.equal(evaluateRisk({ ...buyIntent, notionalUsd: 1 }, baseSnapshot).allowed, true);
  }
});
