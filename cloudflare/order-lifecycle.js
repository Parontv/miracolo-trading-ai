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

function positive(value) {
  return value !== null && value !== undefined && value !== "" &&
    Number.isFinite(Number(value)) && Number(value) > 0;
}

export function validateOrderTransition(current, next, facts = {}) {
  if (!current || !next || !Object.hasOwn(TRANSITIONS, current)) {
    return { allowed: false, reason: "unknown_current_state" };
  }
  if (!TRANSITIONS[current].includes(next)) {
    return { allowed: false, reason: "transition_not_allowed" };
  }
  const filledQty = Number(facts.filledQty || 0);
  const stopQty = Number(facts.stopQty || 0);

  if (["ENTRY_PARTIALLY_FILLED", "ENTRY_FILLED", "PROTECTION_SUBMITTED", "PROTECTED"].includes(next) &&
      (!positive(facts.filledQty))) {
    return { allowed: false, reason: "filled_quantity_required" };
  }
  if (next === "ENTRY_SUBMITTED" && !facts.entryOrderId) {
    return { allowed: false, reason: "entry_order_id_required" };
  }
  if (next === "EXIT_SUBMITTED" && !facts.exitOrderId) {
    return { allowed: false, reason: "exit_order_id_required" };
  }
  if (next === "PROTECTION_SUBMITTED") {
    if (!facts.stopOrderId || !positive(facts.stopPrice) || !positive(facts.stopLimitPrice)) {
      return { allowed: false, reason: "protective_stop_details_required" };
    }
    if (Number(facts.stopLimitPrice) > Number(facts.stopPrice)) {
      return { allowed: false, reason: "invalid_sell_stop_limit_relation" };
    }
    if (!positive(facts.stopQty) || stopQty < filledQty) {
      return { allowed: false, reason: "stop_quantity_must_cover_filled_quantity" };
    }
  }
  if (next === "PROTECTED") {
    if (!facts.stopOrderId || !positive(facts.stopQty) || stopQty < filledQty) {
      return { allowed: false, reason: "active_protection_not_confirmed" };
    }
    if (!["accepted", "new", "partially_filled", "pending_new"].includes(String(facts.stopStatus || "").toLowerCase())) {
      return { allowed: false, reason: "broker_stop_not_active" };
    }
  }
  if (next === "CLOSED") {
    if (facts.remainingQty === null || facts.remainingQty === undefined || facts.remainingQty === "" ||
        !Number.isFinite(Number(facts.remainingQty)) || Number(facts.remainingQty) < 0) {
      return { allowed: false, reason: "remaining_quantity_unknown" };
    }
    if (Number(facts.remainingQty) > 0) return { allowed: false, reason: "position_still_open" };
  }
  if (next === "EMERGENCY_EXIT_SUBMITTED" && !facts.emergencyOrderId) {
    return { allowed: false, reason: "emergency_order_id_required" };
  }
  return { allowed: true, reason: "transition_approved" };
}

export function allowedOrderTransitions(state) {
  return TRANSITIONS[state] ? [...TRANSITIONS[state]] : [];
}
