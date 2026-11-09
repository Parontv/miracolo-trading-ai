"use strict";

const links = [...document.querySelectorAll("[data-view]")];
const views = [...document.querySelectorAll(".view")];
const title = document.querySelector("#page-title");
let refreshTimer = null;

function navigate(link) {
  const name = link.dataset.view;
  links.forEach((item) => item.classList.toggle("active", item === link));
  views.forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  title.textContent = link.textContent.trim();
  history.replaceState(null, "", `#${name}`);
}
links.forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault();
  navigate(link);
}));
const initial = links.find((link) => link.dataset.view === location.hash.slice(1));
if (initial) navigate(initial);

async function apiGet(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function money(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 2 })
    : "--";
}
function number(value, digits = 8) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("it-IT", { maximumFractionDigits: digits }) : "--";
}
function message(container, text) {
  container.replaceChildren();
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = text;
  container.append(p);
}
function row(container, title, detail, value, valueClass = "") {
  const item = document.createElement("div");
  item.className = "activity-row";
  const info = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const sub = document.createElement("small");
  sub.textContent = detail;
  info.append(heading, sub);
  const result = document.createElement("strong");
  result.className = valueClass;
  result.textContent = value;
  item.append(info, result);
  container.append(item);
}

async function refreshBotStatus() {
  try {
    const [statusData, signalData] = await Promise.all([
      apiGet("/api/bot/status"),
      apiGet("/api/bot/signals"),
    ]);
    const bot = statusData.bot || {};
    const state = document.querySelector("#bot-state");
    const last = document.querySelector("#bot-last-cycle");
    if (state) state.textContent = ({
      MONITORING: "Monitoraggio attivo",
      WAITING_CREDENTIALS: "In attesa credenziali Alpaca",
      DEGRADED: "Problema nella scansione",
      NOT_STARTED: "Worker non avviato",
      UNAVAILABLE: "Journal non disponibile",
      STALE: "Worker senza heartbeat",
    })[bot.status] || bot.status || "Stato non disponibile";
    if (last) last.textContent = bot.last_cycle ? new Date(bot.last_cycle).toLocaleString("it-IT") : "--";
    const box = document.querySelector("#signal-list");
    if (box) {
      box.replaceChildren();
      const signals = Array.isArray(signalData.signals) ? signalData.signals : [];
      if (!signals.length) message(box, "Nessun segnale EMA registrato. Il bot continua a monitorare.");
      signals.forEach((signal) => row(
        box, `${signal.symbol} · ${signal.side}`,
        `Barra ${new Date(signal.bar_time).toLocaleString("it-IT")} · EMA 9 ${number(signal.fast_ema, 4)} / EMA 21 ${number(signal.slow_ema, 4)}`,
        money(signal.price)
      ));
      const count = document.querySelector("#signals-state");
      if (count) count.textContent = `${bot.signals_recorded || 0} registrati`;
    }
  } catch (_error) {
    const state = document.querySelector("#bot-state");
    if (state) state.textContent = "Stato non disponibile";
  }
}

async function refreshStatus() {
  const status = document.querySelector("#connection-status");
  const notice = document.querySelector("#connection-notice");
  const alpaca = document.querySelector("#alpaca-status");
  const runtime = document.querySelector("#runtime-state");
  const detail = document.querySelector("#alpaca-detail");
  const dot = document.querySelector("#connection-dot");
  const sidebarDot = document.querySelector("#sidebar-dot");
  try {
    const health = await apiGet("/api/health");
    await refreshBotStatus();
    if (health.ok !== true || health.mode !== "PAPER" || health.live_enabled !== false || health.broker !== "alpaca") {
      throw new Error("Stato di sicurezza del runtime non valido");
    }
    status.textContent = "Runtime attivo · Alpaca PAPER";
    dot.classList.remove("offline");
    sidebarDot.classList.remove("offline");
    runtime.textContent = "Attivo";
    alpaca.textContent = health.alpaca_configured ? "Broker configurato" : "Credenziali mancanti";
    alpaca.className = health.alpaca_configured ? "pill online" : "pill muted";
    notice.hidden = true;
    if (!health.alpaca_configured) {
      document.querySelector("#account-state").textContent = "Credenziali mancanti";
      detail.textContent = "Configura le chiavi Alpaca PAPER nei Worker Secrets di Cloudflare, mai nel browser.";
      clearAccount();
      return;
    }
    await loadBrokerData();
    detail.textContent = "Dati letti direttamente dal conto Alpaca PAPER. Le chiavi e il token privato restano sul server.";
  } catch (error) {
    status.textContent = "Backend o broker non raggiungibile";
    dot.classList.add("offline");
    sidebarDot.classList.add("offline");
    runtime.textContent = "Non disponibile";
    alpaca.textContent = "Connessione non verificata";
    alpaca.className = "pill muted";
    notice.hidden = false;
    notice.querySelector("strong").textContent = "Connessione non disponibile";
    notice.querySelector("span").textContent = error.message;
    detail.textContent = "Controlla il runtime, le credenziali Alpaca PAPER e la protezione Cloudflare Access.";
  }
}

function clearAccount() {
  ["#metric-equity", "#metric-cash", "#metric-positions", "#metric-orders"].forEach((id) => {
    document.querySelector(id).textContent = "--";
  });
  message(document.querySelector("#position-list"), "Conto Alpaca non collegato.");
  message(document.querySelector("#asset-list"), "Conto Alpaca non collegato.");
  message(document.querySelector("#order-list"), "Conto Alpaca non collegato.");
}

async function loadBrokerData() {
  const [accountData, positionsData, ordersData, assetsData] = await Promise.all([
    apiGet("/api/alpaca/status"),
    apiGet("/api/alpaca/positions"),
    apiGet("/api/alpaca/orders"),
    apiGet("/api/alpaca/assets"),
  ]);
  const account = accountData.account || {};
  const positions = Array.isArray(positionsData.positions) ? positionsData.positions : [];
  const orders = Array.isArray(ordersData.orders) ? ordersData.orders : [];
  const assets = Array.isArray(assetsData.assets) ? assetsData.assets : [];

  document.querySelector("#metric-equity").textContent = money(account.equity);
  document.querySelector("#metric-cash").textContent = money(account.cash);
  document.querySelector("#metric-positions").textContent = String(positions.length);
  document.querySelector("#metric-orders").textContent = String(orders.length);
  document.querySelector("#account-state").textContent = account.status || "Non disponibile";

  const positionBox = document.querySelector("#position-list");
  positionBox.replaceChildren();
  if (!positions.length) message(positionBox, "Nessuna posizione aperta sul conto Alpaca.");
  positions.forEach((position) => {
    const pnl = Number(position.unrealized_pl || 0);
    row(positionBox, position.symbol || "Asset", `Quantità ${number(position.qty)} · Prezzo medio ${money(position.avg_entry_price)} · Prezzo attuale ${money(position.current_price)}`, money(pnl), pnl >= 0 ? "positive" : "negative");
  });
  document.querySelector("#positions-state").textContent = `${positions.length} posizioni`;

  const orderBox = document.querySelector("#order-list");
  orderBox.replaceChildren();
  if (!orders.length) message(orderBox, "Nessun ordine aperto sul conto Alpaca.");
  orders.forEach((order) => {
    const size = order.notional ? `Notional ${money(order.notional)}` : `Quantità ${number(order.qty)}`;
    row(orderBox, `${order.symbol || "Asset"} · ${String(order.side || "").toUpperCase()}`, `${order.type || "Ordine"} · ${size} · ${order.submitted_at ? new Date(order.submitted_at).toLocaleString("it-IT") : "Data non disponibile"}`, order.status || "Stato non disponibile");
  });
  document.querySelector("#orders-state").textContent = `${orders.length} ordini`;

  const assetBox = document.querySelector("#asset-list");
  assetBox.replaceChildren();
  if (!assets.length) message(assetBox, "Nessuno degli asset autorizzati risulta disponibile su Alpaca.");
  assets.forEach((asset) => {
    row(assetBox, asset.symbol || "Asset", `Stato: ${asset.status || "non disponibile"}`, asset.tradable ? "Negozia" : "Non negoziabile", asset.tradable ? "positive" : "");
  });
  document.querySelector("#assets-state").textContent = `${assets.length} asset`;
}

document.querySelector("#refresh-status")?.addEventListener("click", refreshStatus);
refreshStatus();
refreshBotStatus();
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { refreshStatus(); refreshBotStatus(); }
});
setInterval(() => {
  if (!document.hidden) refreshStatus();
}, 30000);
