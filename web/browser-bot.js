(() => {
  "use strict";
  const KEY = "miracolo.browser.paper.v1";
  const WATCH = [
    { s: "BTCUSDT", label: "BTC/USDT" },
    { s: "ETHUSDT", label: "ETH/USDT" },
    { s: "QNTUSDT", label: "QNT/USDT" }
  ];
  const streams = WATCH.map(x => x.s.toLowerCase() + "@kline_1m/" + x.s.toLowerCase() + "@ticker").join("/");
  const wsUrl = "wss://data-stream.binance.vision/stream?streams=" + streams;
  const START_CASH = 1000, ORDER_SIZE = 100, FEE = 0.001, SLIPPAGE = 0.0005;
  const STOP = 0.015, TARGET = 0.03, MAX_OPEN = 3;
  const $ = id => document.getElementById(id);
  const prices = {}, history = {}, changes = {};
  let socket = null, retry = null, leaving = false, connecting = false, connectionGeneration = 0;

  function initial() {
    return { enabled: false, cash: START_CASH, positions: {}, trades: [], events: [] };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!saved) return initial();
      return { ...initial(), ...saved,
        positions: saved.positions || {},
        trades: Array.isArray(saved.trades) ? saved.trades.slice(0, 100) : [],
        events: Array.isArray(saved.events) ? saved.events.slice(0, 50) : [] };
    } catch { return initial(); }
  }
  const state = load();
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { status("Memoria locale non disponibile", "error"); }
  }
  function status(message, kind) {
    const el = $("browser-bot-status");
    if (!el) return;
    el.textContent = message;
    el.className = "pill " + (kind === "online" ? "online" : kind === "error" ? "error" : "muted");
  }
  function money(n) {
    return Number(n || 0).toLocaleString("it-IT", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
  }
  function priceText(n) {
    return Number(n).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: Number(n) < 1 ? 6 : 2 });
  }
  function timeText(n) {
    return new Date(n).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  }
  function addEvent(message) {
    state.events.unshift({ at: Date.now(), message });
    state.events = state.events.slice(0, 30);
    persist();
    renderEvents();
  }
  function ema(values, period) {
    if (values.length < period) return null;
    const alpha = 2 / (period + 1);
    let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) result = (values[i] - result) * alpha + result;
    return result;
  }
  function rsi(values, period) {
    if (values.length <= period) return null;
    let up = 0, down = 0;
    for (let i = values.length - period; i < values.length; i++) {
      const diff = values[i] - values[i - 1];
      if (diff > 0) up += diff; else down -= diff;
    }
    return down === 0 ? 100 : 100 - 100 / (1 + up / down);
  }
  function openCount() { return Object.keys(state.positions).length; }
  function equity() {
    return state.cash + Object.entries(state.positions).reduce((sum, pair) => {
      const p = pair[1], mark = prices[pair[0]] || p.last || p.entry;
      return sum + p.qty * mark;
    }, 0);
  }
  function floating() {
    return Object.entries(state.positions).reduce((sum, pair) => {
      const p = pair[1], mark = prices[pair[0]] || p.last || p.entry;
      return sum + (mark - p.entry) * p.qty - p.fee;
    }, 0);
  }
  function buy(symbol, marketPrice) {
    if (state.positions[symbol] || openCount() >= MAX_OPEN || state.cash < ORDER_SIZE * (1 + FEE)) return;
    const entry = marketPrice * (1 + SLIPPAGE);
    const qty = ORDER_SIZE / entry, fee = ORDER_SIZE * FEE;
    state.cash -= ORDER_SIZE + fee;
    state.positions[symbol] = {
      qty, entry, notional: ORDER_SIZE, fee,
      stop: entry * (1 - STOP), target: entry * (1 + TARGET),
      opened: Date.now(), last: marketPrice
    };
    persist();
    addEvent("PAPER BUY " + symbol.replace("USDT", "/USDT") + " @ " + priceText(entry));
    renderAll();
  }
  function sell(symbol, marketPrice, reason) {
    const p = state.positions[symbol];
    if (!p) return;
    const exit = marketPrice * (1 - SLIPPAGE);
    const proceeds = p.qty * exit, fee = proceeds * FEE;
    const pnl = proceeds - fee - p.notional - p.fee;
    state.cash += proceeds - fee;
    state.trades.unshift({ symbol, entry: p.entry, exit, pnl, reason, closed: Date.now() });
    state.trades = state.trades.slice(0, 100);
    delete state.positions[symbol];
    persist();
    addEvent("PAPER SELL " + symbol.replace("USDT", "/USDT") + " · " + money(pnl) + " · " + reason);
    renderAll();
  }
  function checkRisk(symbol, price) {
    const p = state.positions[symbol];
    if (!p) return;
    p.last = price;
    if (price <= p.stop) sell(symbol, price, "Stop loss 1,5%");
    else if (price >= p.target) sell(symbol, price, "Take profit 3%");
    else { persist(); renderMetrics(); renderPositions(); }
  }
  function evaluate(symbol) {
    const closes = (history[symbol] || []).map(c => c.close);
    const prev = closes.slice(0, -1);
    const fast = ema(closes, 9), slow = ema(closes, 21);
    const oldFast = ema(prev, 9), oldSlow = ema(prev, 21), momentum = rsi(closes, 14);
    if ([fast, slow, oldFast, oldSlow, momentum].some(v => v === null)) return;
    if (state.positions[symbol]) {
      if (oldFast >= oldSlow && fast < slow) sell(symbol, closes[closes.length - 1], "Incrocio EMA ribassista");
    } else if (oldFast <= oldSlow && fast > slow && momentum > 50) {
      buy(symbol, closes[closes.length - 1]);
    }
    const el = $("signal-" + symbol);
    if (el) {
      const label = fast > slow && momentum > 50 ? "Bias rialzista" : fast < slow ? "Bias ribassista" : "Neutrale";
      el.textContent = label + " · RSI " + momentum.toFixed(1);
      el.className = "signal " + (label === "Bias rialzista" ? "positive" : label === "Bias ribassista" ? "negative" : "");
    }
  }
  function renderMarkets() {
    const box = $("browser-market-list");
    if (!box) return;
    box.replaceChildren();
    WATCH.forEach(item => {
      const row = document.createElement("div");
      row.className = "browser-market-row";
      const name = document.createElement("strong"); name.textContent = item.label;
      const px = document.createElement("span"); px.textContent = prices[item.s] ? priceText(prices[item.s]) : "--";
      const ch = document.createElement("span");
      ch.textContent = changes[item.s] === undefined ? "In attesa" : changes[item.s].toFixed(2) + "%";
      ch.className = changes[item.s] === undefined ? "muted" : changes[item.s] >= 0 ? "positive" : "negative";
      const signal = document.createElement("small");
      signal.id = "signal-" + item.s;
      signal.className = "signal";
      signal.textContent = "Indicatori in caricamento";
      row.append(name, px, ch, signal); box.append(row);
    });
  }
  function renderMetrics() {
    if ($("browser-cash")) $("browser-cash").textContent = money(state.cash);
    if ($("browser-equity")) $("browser-equity").textContent = money(equity());
    if ($("browser-pnl")) {
      const n = floating();
      $("browser-pnl").textContent = (n >= 0 ? "+" : "") + money(n);
      $("browser-pnl").className = n >= 0 ? "positive" : "negative";
    }
    if ($("browser-open-count")) $("browser-open-count").textContent = String(openCount());
    if ($("metric-portfolio")) $("metric-portfolio").textContent = money(equity());
    if ($("metric-portfolio-note")) $("metric-portfolio-note").textContent = "Capitale virtuale iniziale " + money(START_CASH);
    if ($("metric-positions")) $("metric-positions").textContent = String(openCount());
    if ($("metric-positions-note")) $("metric-positions-note").textContent = "Posizioni simulate";
    if ($("metric-pnl")) {
      const value = floating();
      $("metric-pnl").textContent = (value >= 0 ? "+" : "") + money(value);
      $("metric-pnl").className = value >= 0 ? "positive" : "negative";
    }
    if ($("metric-pnl-note")) $("metric-pnl-note").textContent = "P&L PAPER non realizzato";
    if ($("metric-bots")) $("metric-bots").textContent = state.enabled ? "1" : "0";
    if ($("metric-bots-note")) $("metric-bots-note").textContent = state.enabled ? "Bot browser avviato" : "Bot fermo";
  }
  function renderPositions() {
    const box = $("browser-position-list"); if (!box) return;
    box.replaceChildren();
    const rows = Object.entries(state.positions);
    if (!rows.length) {
      const p = document.createElement("p"); p.className = "muted";
      p.textContent = "Nessuna posizione PAPER aperta."; box.append(p); return;
    }
    rows.forEach(([symbol, pos]) => {
      const mark = prices[symbol] || pos.last || pos.entry;
      const pnl = (mark - pos.entry) * pos.qty - pos.fee;
      const row = document.createElement("div"); row.className = "browser-position-row";
      const info = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = symbol.replace("USDT", "/USDT");
      const detail = document.createElement("small");
      detail.textContent = "Ingresso " + priceText(pos.entry) + " · SL " + priceText(pos.stop) + " · TP " + priceText(pos.target);
      info.append(name, detail);
      const value = document.createElement("strong"); value.className = pnl >= 0 ? "positive" : "negative"; value.textContent = money(pnl);
      row.append(info, value); box.append(row);
    });
  }
  function renderTrades() {
    const box = $("browser-trade-list"); if (!box) return;
    box.replaceChildren();
    if (!state.trades.length) {
      const p = document.createElement("p"); p.className = "muted";
      p.textContent = "Nessuna operazione simulata: il registro si aggiorna quando scattano i segnali.";
      box.append(p); return;
    }
    state.trades.slice(0, 12).forEach(t => {
      const row = document.createElement("div"); row.className = "browser-position-row";
      const info = document.createElement("div");
      const name = document.createElement("strong"); name.textContent = t.symbol.replace("USDT", "/USDT");
      const detail = document.createElement("small"); detail.textContent = t.reason + " · " + timeText(t.closed);
      info.append(name, detail);
      const pnl = document.createElement("strong"); pnl.className = t.pnl >= 0 ? "positive" : "negative"; pnl.textContent = money(t.pnl);
      row.append(info, pnl); box.append(row);
    });
  }
  function renderEvents() {
    const box = $("browser-event-list"); if (!box) return;
    box.replaceChildren();
    if (!state.events.length) {
      const p = document.createElement("p"); p.className = "muted"; p.textContent = "Nessun evento registrato."; box.append(p); return;
    }
    state.events.slice(0, 15).forEach(e => {
      const row = document.createElement("div"); row.className = "browser-event-row";
      const tm = document.createElement("small"); tm.textContent = timeText(e.at);
      const msg = document.createElement("span"); msg.textContent = e.message;
      row.append(tm, msg); box.append(row);
    });
  }
  function renderAll() { renderMarkets(); renderMetrics(); renderPositions(); renderTrades(); renderEvents(); }

  async function seed() {
    const endpoints = [
      "https://data-api.binance.vision/api/v3/klines",
      "https://api.binance.com/api/v3/klines"
    ];
    await Promise.all(WATCH.map(async item => {
      let lastError;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint + "?symbol=" + item.s + "&interval=1m&limit=100", { cache: "no-store" });
          if (!response.ok) throw new Error("HTTP " + response.status);
          const rows = await response.json();
          if (!Array.isArray(rows) || rows.length < 30) throw new Error("Storico insufficiente");
          const candles = rows.map(row => ({ time: Number(row[0]), close: Number(row[4]) }));
          if (candles.some(candle => !Number.isFinite(candle.time) || !Number.isFinite(candle.close) || candle.close <= 0)) {
            throw new Error("Dati candela non validi");
          }
          history[item.s] = candles;
          prices[item.s] = candles[candles.length - 1].close;
          lastError = null; break;
        } catch (error) { lastError = error; }
      }
      if (lastError) throw new Error(item.s + ": " + lastError.message);
    }));
    renderAll();
  }
  function onMessage(raw) {
    let packet; try { packet = JSON.parse(raw); } catch { return; }
    const d = packet.data || packet, symbol = d.s;
    if (!symbol || !WATCH.some(x => x.s === symbol)) return;
    if (d.e === "24hrTicker") {
      prices[symbol] = Number(d.c); changes[symbol] = Number(d.P);
      checkRisk(symbol, prices[symbol]); renderMarkets(); return;
    }
    if (d.e === "kline" && d.k) {
      const k = d.k, list = history[symbol] || (history[symbol] = []);
      const candle = { time: Number(k.t), close: Number(k.c) };
      if (list.length && list[list.length - 1].time === candle.time) list[list.length - 1] = candle;
      else list.push(candle);
      if (list.length > 240) list.splice(0, list.length - 240);
      prices[symbol] = candle.close; checkRisk(symbol, candle.close);
      if (k.x) evaluate(symbol);
      renderMarkets(); renderMetrics();
    }
  }
  function disconnect(retryConnection) {
    connectionGeneration += 1;
    connecting = false;
    if (retry) clearTimeout(retry);
    retry = null;
    if (socket) {
      const old = socket; socket = null;
      old.onopen = null; old.onmessage = null; old.onclose = null; old.onerror = null; old.close();
    }
    if (retryConnection && state.enabled && !document.hidden && !leaving) retry = setTimeout(connect, 5000);
  }
  async function connect() {
    if (!state.enabled || document.hidden || leaving || socket || connecting) return;
    connecting = true;
    const generation = ++connectionGeneration;
    status("Caricamento storico prezzi…");
    try { await seed(); }
    catch (error) {
      if (generation !== connectionGeneration || !state.enabled) return;
      connecting = false;
      status("Feed dati non disponibile: " + error.message, "error");
      addEvent("Feed dati non disponibile: " + error.message);
      disconnect(true); return;
    }
    if (generation !== connectionGeneration || !state.enabled || document.hidden || leaving) { if (generation === connectionGeneration) connecting = false; return; }
    try {
      const current = new WebSocket(wsUrl);
      socket = current;
      current.onopen = () => {
        if (generation !== connectionGeneration || socket !== current || !state.enabled) { current.close(); return; }
        connecting = false;
        status("Bot attivo · PAPER", "online");
        addEvent("Feed Binance collegato. Monitoraggio avviato.");
      };
      current.onmessage = event => { if (generation === connectionGeneration && socket === current && state.enabled) onMessage(event.data); };
      current.onerror = () => { if (generation === connectionGeneration && socket === current && state.enabled) status("Connessione dati instabile", "error"); };
      current.onclose = () => {
        if (generation !== connectionGeneration || socket !== current) return;
        socket = null;
        connecting = false;
        if (state.enabled && !document.hidden && !leaving) { status("Feed interrotto · riconnessione…"); disconnect(true); }
      };
    } catch (error) {
      if (generation !== connectionGeneration || !state.enabled) return;
      socket = null; connecting = false;
      status("WebSocket non disponibile: " + error.message, "error"); disconnect(true);
    }
  }
  function start() {
    leaving = false; state.enabled = true; persist();
    $("browser-start")?.setAttribute("disabled", "disabled");
    $("browser-stop")?.removeAttribute("disabled");
    status("Avvio bot browser…"); addEvent("Bot browser avviato in modalità PAPER. Nessun ordine reale."); connect();
  }
  function stop() {
    state.enabled = false; persist(); disconnect(false);
    $("browser-start")?.removeAttribute("disabled");
    $("browser-stop")?.setAttribute("disabled", "disabled");
    status("Bot fermato"); addEvent("Bot fermato dall'utente.");
  }
  $("browser-start")?.addEventListener("click", start);
  $("browser-stop")?.addEventListener("click", stop);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { disconnect(false); if (state.enabled) status("In pausa · pagina non visibile"); }
    else if (state.enabled) connect();
  });
  window.addEventListener("pagehide", () => { leaving = true; disconnect(false); });
  window.addEventListener("pageshow", () => { leaving = false; if (state.enabled && !document.hidden) connect(); });
  renderAll();
  if (state.enabled) {
    $("browser-start")?.setAttribute("disabled", "disabled");
    $("browser-stop")?.removeAttribute("disabled");
    connect();
  } else {
    $("browser-stop")?.setAttribute("disabled", "disabled");
    status("Pronto · avvio manuale");
  }
})();