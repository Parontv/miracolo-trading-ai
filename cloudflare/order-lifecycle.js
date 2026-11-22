const TRANSITIONS = Object.freeze({
  NEW: ["RISK_RESERVED", "REJECTED"],
  RISK_RESERVED: ["ENTRY_SUBMITTED", "REJECTED", "FAILED"],
  ENTRY_SUBMITTED: ["ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "CANCELLED", "FAILED", "EMERGENCY_EXIT_REQUIRED"],
  ENTRY_PARTIALLY_FILLED: ["ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "EMERGENCY_EXIT_REQUIRED"],
  ENTRY_FILLED: ["PROTECTION_SUBMITTED", "EMERGENCY_EXIT_REQUIRED"],
  PROTECTION_SUBMITTED: ["PROTECTED", "EMERGENCY_EXIT_REQUIRED"],
  PROTECTED: ["EXIT_SUBMITTED", "EMERGENCY_EXIT_REQUIRED"],
  EXIT_SUBMITTED: ["CLOSED", "PROTECTED", "EMERGENCY_EXIT_REQUIRED"],
  EMERGENCY_EXIT_REQUIRED: ["EMERGENCY_EXIT_SUBMITTED"],
  EMERGENCY_EXIT_SUBMITTED: ["CLOSED", "EMERGENCY_EXIT_REQUIRED"],
  CLOSED: [],
  REJECTED: [],
  CANCELLED: [],
  FAILED: [],
});

function finiteNumber(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0;
}

function hasOrderId(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateOrderTransition(current, next, facts = {}) {
  if (!current || !next || !Object.hasOwn(TRANSITIONS, current)) {
    return { allowed: false, reason: "unknown_current_state" };
  }
  if (!TRANSITIONS[current].includes(next)) {
    return { allowed: false, reason: "transition_not_allowed" };
  }
  const filledQty = finiteNumber(facts.filledQty) ?? 0;
  const stopQty = finiteNumber(facts.stopQty) ?? 0;
  const stopStatus = String(facts.stopStatus || "").toLowerCase();
  const activeStopStates = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel"]);
  const cancelledStopStates = new Set(["canceled", "cancelled", "rejected", "expired"]);
  const terminalStopStates = new Set([...cancelledStopStates, "filled"]);
  const activeEntryStates = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "pending_replace", "pending_cancel"]);
  const terminalEntryStates = new Set(["filled", "canceled", "cancelled", "rejected", "expired"]);
  const entryStatus = String(facts.entryStatus || "").toLowerCase();

  if (["ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "PROTECTION_SUBMITTED", "PROTECTED",
       "EMERGENCY_EXIT_REQUIRED", "EMERGENCY_EXIT_SUBMITTED"].includes(next) &&
      (!positive(facts.filledQty))) {
    return { allowed: false, reason: "filled_quantity_required" };
  }
  if (next === "ENTRY_SUBMITTED" && !hasOrderId(facts.entryOrderId)) {
    return { allowed: false, reason: "entry_order_id_required" };
  }
  if (current === "ENTRY_SUBMITTED" && ["CANCELLED", "FAILED"].includes(next)) {
    if (finiteNumber(facts.filledQty) !== 0) {
      return { allowed: false, reason: "entry_fill_must_be_confirmed_zero" };
    }
    if (!terminalEntryStates.has(entryStatus) || activeEntryStates.has(entryStatus)) {
      return { allowed: false, reason: "entry_terminal_status_not_confirmed" };
    }
    if (next === "CANCELLED" && !["canceled", "cancelled"].includes(entryStatus)) {
      return { allowed: false, reason: "broker_cancellation_not_confirmed" };
    }
  }
  if (next === "ENTRY_FILLED") {
    if (!entryStatus || activeEntryStates.has(entryStatus)) {
      return { allowed: false, reason: "entry_order_must_be_terminal_before_protection" };
    }
    if (!terminalEntryStates.has(entryStatus)) {
      return { allowed: false, reason: "entry_terminal_status_not_confirmed" };
    }
  }
  if (next === "EMERGENCY_EXIT_REQUIRED" &&
      ["ENTRY_SUBMITTED", "ENTRY_PARTIALLY_FILLED"].includes(current)) {
    if (!entryStatus || activeEntryStates.has(entryStatus) || !terminalEntryStates.has(entryStatus)) {
      return { allowed: false, reason: "entry_order_must_be_terminal_before_emergency_exit" };
    }
  }
  if (next === "EXIT_SUBMITTED" && !hasOrderId(facts.exitOrderId)) {
    return { allowed: false, reason: "exit_order_id_required" };
  }
  if (next === "EXIT_SUBMITTED" && current === "PROTECTED" && !hasOrderId(facts.stopOrderId)) {
    return { allowed: false, reason: "protective_stop_id_required_before_exit" };
  }
  if (next === "EXIT_SUBMITTED" && current === "PROTECTED") {
    if (!facts.stopStatus) return { allowed: false, reason: "protective_stop_status_unknown" };
    if (activeStopStates.has(stopStatus)) {
      return { allowed: false, reason: "protective_stop_must_be_cancelled_before_exit" };
    }
    if (!cancelledStopStates.has(stopStatus) || facts.stopCancellationConfirmed !== true) {
      return { allowed: false, reason: "protective_stop_cancellation_not_confirmed" };
    }
  }
  if (next === "PROTECTION_SUBMITTED") {
    if (!hasOrderId(facts.stopOrderId) || !positive(facts.stopPrice) || !positive(facts.stopLimitPrice)) {
      return { allowed: false, reason: "protective_stop_details_required" };
    }
    if (Number(facts.stopLimitPrice) > Number(facts.stopPrice)) {
      return { allowed: false, reason: "invalid_sell_stop_limit_relation" };
    }
    if (!positive(facts.stopQty) || Math.abs(stopQty - filledQty) > 1e-8) {
      return { allowed: false, reason: "stop_quantity_must_match_filled_quantity" };
    }
  }
  if (next === "PROTECTED") {
    if (!hasOrderId(facts.stopOrderId) || !positive(facts.stopQty) || Math.abs(stopQty - filledQty) > 1e-8) {
      return { allowed: false, reason: "active_protection_quantity_mismatch" };
    }
    if (!["accepted", "new", "partially_filled", "pending_new"].includes(String(facts.stopStatus || "").toLowerCase())) {
      return { allowed: false, reason: "broker_stop_not_active" };
    }
  }
  if (next === "CLOSED") {
    const remainingQty = finiteNumber(facts.remainingQty);
    if (remainingQty === null || remainingQty < 0) {
      return { allowed: false, reason: "remaining_quantity_unknown" };
    }
    if (remainingQty > 0) return { allowed: false, reason: "position_still_open" };
    if (["EXIT_SUBMITTED", "EMERGENCY_EXIT_SUBMITTED"].includes(current) &&
        facts.stopCancellationConfirmed !== true) {
      return { allowed: false, reason: "protective_stop_cancellation_not_confirmed" };
    }
    if (hasOrderId(facts.stopOrderId) && (!facts.stopStatus || !terminalStopStates.has(stopStatus))) {
      return { allowed: false, reason: "protective_stop_terminal_state_not_confirmed" };
    }
  }
  if (next === "EMERGENCY_EXIT_SUBMITTED") {
    if (!hasOrderId(facts.emergencyOrderId)) {
      return { allowed: false, reason: "emergency_order_id_required" };
    }
    if (hasOrderId(facts.stopOrderId)) {
      if (!facts.stopStatus) return { allowed: false, reason: "protective_stop_status_unknown" };
      if (activeStopStates.has(stopStatus)) {
        return { allowed: false, reason: "protective_stop_must_be_cancelled_before_exit" };
      }
      if (!cancelledStopStates.has(stopStatus)) {
        return { allowed: false, reason: "protective_stop_cancellation_not_confirmed" };
      }
    }
    if (facts.stopCancellationConfirmed !== true) {
      return { allowed: false, reason: "protective_stop_cancellation_not_confirmed" };
    }
  }
  return { allowed: true, reason: "transition_approved" };
}

export function allowedOrderTransitions(state) {
  return TRANSITIONS[state] ? [...TRANSITIONS[state]] : [];
}
