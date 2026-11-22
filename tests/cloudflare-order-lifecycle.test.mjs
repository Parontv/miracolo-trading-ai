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
  assert.equal(validateOrderTransition("ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", { filledQty: 0.01, entryStatus: "canceled" }).allowed, true);
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
  assert.equal(validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", { ...facts, stopQty: 0.01 }).reason, "stop_quantity_must_match_filled_quantity");
  assert.equal(validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", { ...facts, stopLimitPrice: 96 }).reason, "invalid_sell_stop_limit_relation");
});

test("protection is confirmed only when the broker reports an active stop", () => {
  const facts = { filledQty: 1, stopQty: 1, stopOrderId: "stop-1", stopStatus: "accepted" };
  assert.equal(validateOrderTransition("PROTECTION_SUBMITTED", "PROTECTED", facts).allowed, true);
  assert.equal(validateOrderTransition("PROTECTION_SUBMITTED", "PROTECTED", { ...facts, stopQty: 1.1 }).reason, "active_protection_quantity_mismatch");
  assert.equal(validateOrderTransition("PROTECTION_SUBMITTED", "PROTECTED", { ...facts, stopStatus: "rejected" }).reason, "broker_stop_not_active");
});

test("closed state requires a known zero remaining position", () => {
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED").reason, "remaining_quantity_unknown");
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED", { remainingQty: 0.001 }).reason, "position_still_open");
  assert.equal(validateOrderTransition("EXIT_SUBMITTED", "CLOSED", { remainingQty: 0, stopCancellationConfirmed: true }).allowed, true);
});

test("exit and emergency transitions require broker order identifiers", () => {
  assert.equal(validateOrderTransition("PROTECTED", "EXIT_SUBMITTED").reason, "exit_order_id_required");
  assert.equal(validateOrderTransition("EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED", { filledQty: 0.01 }).reason, "emergency_order_id_required");
  assert.equal(validateOrderTransition("EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED", { filledQty: 0.01, emergencyOrderId: "emergency-1", stopCancellationConfirmed: true }).allowed, true);
});

test("normal and emergency exits require confirmed protective-stop cancellation", () => {
  const active = { exitOrderId: "exit-1", stopOrderId: "stop-1", stopStatus: "accepted" };
  assert.equal(
    validateOrderTransition("PROTECTED", "EXIT_SUBMITTED", active).reason,
    "protective_stop_must_be_cancelled_before_exit",
  );
  assert.equal(
    validateOrderTransition("PROTECTED", "EXIT_SUBMITTED", { ...active, stopStatus: undefined }).reason,
    "protective_stop_status_unknown",
  );
  assert.equal(
    validateOrderTransition("PROTECTED", "EXIT_SUBMITTED", { ...active, stopStatus: "canceled", stopCancellationConfirmed: true }).allowed,
    true,
  );
  assert.equal(
    validateOrderTransition("EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED", {
      filledQty: 0.01, emergencyOrderId: "emergency-1", stopOrderId: "stop-1", stopStatus: "accepted", stopCancellationConfirmed: false,
    }).reason,
    "protective_stop_must_be_cancelled_before_exit",
  );
  assert.equal(
    validateOrderTransition("EXIT_SUBMITTED", "CLOSED", {
      remainingQty: 0, stopOrderId: "stop-1", stopStatus: "accepted", stopCancellationConfirmed: true,
    }).reason,
    "protective_stop_terminal_state_not_confirmed",
  );
});

test("entry orders must be terminal before finalizing fills or starting emergency exits", () => {
  assert.equal(
    validateOrderTransition("ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", {
      filledQty: 0.01, entryStatus: "partially_filled",
    }).reason,
    "entry_order_must_be_terminal_before_protection",
  );
  assert.equal(
    validateOrderTransition("ENTRY_PARTIALLY_FILLED", "EMERGENCY_EXIT_REQUIRED", {
      filledQty: 0.01, entryStatus: "partially_filled",
    }).reason,
    "entry_order_must_be_terminal_before_emergency_exit",
  );
  assert.equal(
    validateOrderTransition("ENTRY_SUBMITTED", "CANCELLED", {
      filledQty: 0, entryStatus: "accepted",
    }).reason,
    "entry_terminal_status_not_confirmed",
  );
  assert.equal(
    validateOrderTransition("ENTRY_SUBMITTED", "ENTRY_FILLED", {
      filledQty: 0.01, entryStatus: "partially_filled",
    }).reason,
    "entry_order_must_be_terminal_before_protection",
  );
  assert.equal(
    validateOrderTransition("ENTRY_SUBMITTED", "EMERGENCY_EXIT_REQUIRED", {
      filledQty: 0.01, entryStatus: "accepted",
    }).reason,
    "entry_order_must_be_terminal_before_emergency_exit",
  );
});

test("lifecycle rejects boolean quantities and non-string broker order ids", () => {
  assert.equal(
    validateOrderTransition("RISK_RESERVED", "ENTRY_SUBMITTED", { entryOrderId: 123 }).reason,
    "entry_order_id_required",
  );
  assert.equal(
    validateOrderTransition("ENTRY_SUBMITTED", "ENTRY_FILLED", {
      filledQty: true, entryStatus: "filled",
    }).reason,
    "filled_quantity_required",
  );
  assert.equal(
    validateOrderTransition("ENTRY_FILLED", "PROTECTION_SUBMITTED", {
      filledQty: 0.01, stopOrderId: 123, stopPrice: 95, stopLimitPrice: 94, stopQty: 0.01,
    }).reason,
    "protective_stop_details_required",
  );
  assert.equal(
    validateOrderTransition("PROTECTED", "EXIT_SUBMITTED", {
      exitOrderId: 123, stopOrderId: "stop-1", stopStatus: "canceled", stopCancellationConfirmed: true,
    }).reason,
    "exit_order_id_required",
  );
  assert.equal(
    validateOrderTransition("EXIT_SUBMITTED", "CLOSED", { remainingQty: false, stopCancellationConfirmed: true }).reason,
    "remaining_quantity_unknown",
  );
});

test("illegal transitions are rejected", () => {
  assert.equal(validateOrderTransition("NEW", "PROTECTED").reason, "transition_not_allowed");
  assert.equal(validateOrderTransition("CLOSED", "ENTRY_SUBMITTED").reason, "transition_not_allowed");
});

test("submitted entry cannot be cancelled or failed until zero fills are confirmed", () => {
  assert.equal(validateOrderTransition("ENTRY_SUBMITTED", "CANCELLED").reason, "entry_fill_must_be_confirmed_zero");
  assert.equal(validateOrderTransition("ENTRY_SUBMITTED", "FAILED", { filledQty: 0.001 }).reason, "entry_fill_must_be_confirmed_zero");
  assert.equal(validateOrderTransition("ENTRY_SUBMITTED", "CANCELLED", { filledQty: 0, entryStatus: "canceled" }).allowed, true);
  assert.equal(validateOrderTransition("ENTRY_SUBMITTED", "FAILED", { filledQty: "0", entryStatus: "rejected" }).allowed, true);
});
