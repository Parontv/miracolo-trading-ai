import test from "node:test";
import assert from "node:assert/strict";
import { allowedOrderTransitions, validateOrderTransition } from "../cloudflare/order-lifecycle.js";

test("entry cannot be marked submitted without a broker order id", () => {
  assert.equal(validateOrderTransition("RISK_RESERVED", "ENTRY_SUBMITTED").reason, "entry_order_id_required");
  assert.equal(validateOrderTransition("RISK_RESERVED", "ENTRY_SUBMITTED", { entryOrderId: "alpaca-1" }).allowed, true);
});

test("partial fill cannot be closed or abandoned as a cancelled terminal order", () => {
  assert.equal(allowedOrderTransitions("ENTRY_PARTIALLY_FILLED").includes("CANCELLED"), false);
  assert.equal(allowedOrderTransitions("ENTRY_PARTIALLY_FILLED").includes("FAILED"), false);
  assert.equal(validateOrderTransition("ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", { filledQty: 0.01 }).allowed, true);
});

test("protective stop must cover the filled quantity and use a valid sell stop-limit relation", () => {
  const facts = {
    filledQty: 0.02,
    stopQty: 0.02,
    stopOrderId: "stop-1",
    stopPrice: 95,
    stopLimitPrice: 94,
  };
  assert.equal(validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", facts).allowed, true);
  assert.equal(validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", { ...facts, stopQty: 0.01 }).reason, "stop_quantity_must_cover_filled_quantity");
  assert.equal(validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", { ...facts, stopLimitPrice: 96 }).reason, "invalid_sell_stop_limit_relation");
});

test("protection is confirmed only when the broker reports an active stop", () => {
  const facts = { filledQty: 1, stopQty: 1, stopOrderId: "stop-1", stopStatus: "accepted" };
  assert.equal(validateOrderTransition("PROTECTION_SUBMITTED", "PROTECTED", facts).allowed, true);
  assert.equal(validateOrderTransition("PROTECTION_SUBMITTED", "PROTECTED", { ...facts, stopStatus: "rejected" }).reason, "broker_stop_not_active");
});

test("closed state requires a known zero remaining position", () => {
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED").reason, "remaining_quantity_unknown");
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED", { remainingQty: 0.001 }).reason, "position_still_open");
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED", { remainingQty: 0 }).allowed, true);
});

test("exit and emergency transitions require broker order identifiers", () => {
  assert.equal(validateOrderTransition("PROTECTED", "EXIT_SUBMITTED").reason, "exit_order_id_required");
  assert.equal(validateOrderTransition("EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED").reason, "emergency_order_id_required");
  assert.equal(validateOrderTransition("EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED", { emergencyOrderId: "emergency-1" }).allowed, true);
});

test("illegal transitions are rejected", () => {
  assert.equal(validateOrderTransition("NEW", "PROTECTED").reason, "transition_not_allowed");
  assert.equal(validateOrderTransition("CLOSED", "ENTRY_SUBMITTED").reason, "transition_not_allowed");
});
