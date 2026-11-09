export const DEFAULT_RISK_POLICY = Object.freeze({
  broker: "alpaca-paper",
  liveEnabled: false,
  allowedSymbols: Object.freeze(["BTC/USD", "ETH/USD", "QNT/USD"]),
  maxOrderNotionalUsd: 100,
  maxDailyLossUsd: 15,
  maxOpenPositions: 3,
  maxOrdersPerMinute: 2,
  requireStopLoss: true,
  allowAiGeneratedOrders: false,
});

function finitePositive(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0;
}

export function evaluateRisk(intent, snapshot, policy = DEFAULT_RISK_POLICY) {
  if (!intent || !snapshot) return { allowed: false, reason: "missing_intent_or_snapshot" };
  if (policy.broker !== "alpaca-paper" || snapshot.broker !== "alpaca-paper") {
    return { allowed: false, reason: "paper_only" };
  }
  if (policy.liveEnabled !== false || snapshot.liveEnabled !== false) {
    return { allowed: false, reason: "live_disabled" };
  }

  const side = String(intent.side || "").toUpperCase();
  if (side !== "BUY" && side !== "SELL") return { allowed: false, reason: "invalid_side" };
  if (!policy.allowedSymbols.includes(intent.symbol)) return { allowed: false, reason: "symbol_not_allowed" };
  if (!finitePositive(intent.notionalUsd)) return { allowed: false, reason: "invalid_notional" };
  if (Number(intent.notionalUsd) > policy.maxOrderNotionalUsd) {
    return { allowed: false, reason: "order_notional_limit" };
  }
  if (snapshot.killSwitch === true && !(side === "SELL" && intent.reduceOnly === true)) {
    return { allowed: false, reason: "kill_switch" };
  }
  if (intent.aiGenerated === true && policy.allowAiGeneratedOrders !== true) {
    return { allowed: false, reason: "ai_order_not_allowed" };
  }

  const ordersLastMinute = Number(snapshot.ordersLastMinute);
  if (!Number.isInteger(ordersLastMinute) || ordersLastMinute < 0) {
    return { allowed: false, reason: "order_rate_unknown" };
  }
  if (ordersLastMinute >= policy.maxOrdersPerMinute) {
    return { allowed: false, reason: "order_rate_limit" };
  }

  if (side === "BUY") {
    const dailyPnlUsd = Number(snapshot.dailyPnlUsd);
    if (!Number.isFinite(dailyPnlUsd)) return { allowed: false, reason: "daily_pnl_unknown" };
    if (dailyPnlUsd <= -policy.maxDailyLossUsd) return { allowed: false, reason: "daily_loss_limit" };

    const openPositions = Number(snapshot.openPositions);
    const pendingBuyReservations = Number(snapshot.pendingBuyReservations || 0);
    if (!Number.isInteger(openPositions) || openPositions < 0 ||
        !Number.isInteger(pendingBuyReservations) || pendingBuyReservations < 0) {
      return { allowed: false, reason: "position_count_unknown" };
    }
    if (openPositions + pendingBuyReservations >= policy.maxOpenPositions) {
      return { allowed: false, reason: "position_limit" };
    }

    if (policy.requireStopLoss) {
      if (!finitePositive(intent.stopLossPrice) || !finitePositive(intent.referencePrice)) {
        return { allowed: false, reason: "stop_loss_required" };
      }
      if (Number(intent.stopLossPrice) >= Number(intent.referencePrice)) {
        return { allowed: false, reason: "invalid_stop_loss" };
      }
    }
  } else {
    if (intent.reduceOnly !== true) return { allowed: false, reason: "sell_must_reduce_position" };
    if (!finitePositive(intent.quantity) || !finitePositive(snapshot.heldQuantity)) {
      return { allowed: false, reason: "held_quantity_unknown" };
    }
    if (Number(intent.quantity) > Number(snapshot.heldQuantity)) {
      return { allowed: false, reason: "sell_exceeds_position" };
    }
  }

  return { allowed: true, reason: "approved" };
}
