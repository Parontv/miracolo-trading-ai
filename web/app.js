const links = [...document.querySelectorAll("[data-view]")];
const views = [...document.querySelectorAll(".view")];
const title = document.querySelector("#page-title");

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
const initialLink = links.find((link) => link.dataset.view === location.hash.slice(1));
if (initialLink) navigate(initialLink);

async function apiGet(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body.reason || body.detail || `HTTP ${response.status}`;
    throw new Error(String(reason));
  }
  return body;
}

async function refreshConnection() {
  const status = document.querySelector("#connection-status");
  const notice = document.querySelector("#connection-notice");
  const engine = document.querySelector("#engine-status");
  try {
    const health = await apiGet("/api/health");
    if (!health.ok || health.mode !== "PAPER" || health.live_enabled !== false) throw new Error("Invalid safety state");
    status.textContent = "Backend Miracolo raggiungibile · PAPER";
    status.classList.add("online");
    document.querySelector("#connection-dot")?.classList.remove("offline");
    engine.textContent = "Backend disponibile · Condor in verifica";
    engine.classList.remove("muted");
  } catch {
    status.textContent = "Backend non raggiungibile";
    status.classList.remove("online");
    document.querySelector("#connection-dot")?.classList.add("offline");
    notice.hidden = false;
    engine.textContent = "In attesa del backend";
    engine.classList.add("muted");
  }
}

function showMessage(container, message) {
  container.replaceChildren();
  const p = document.createElement("p");
  p.className = "muted";
  p.textContent = message;
  container.append(p);
}

async function loadPortfolio(serverName) {
  const content = document.querySelector("#portfolio-content");
  const state = document.querySelector("#portfolio-state");
  document.querySelector("#portfolio-server-label").textContent = serverName;
  state.textContent = "Caricamento";
  try {
    const data = await apiGet(`/api/condor/servers/${encodeURIComponent(serverName)}/portfolio`);
    content.replaceChildren();
    const total = document.createElement("div");
    total.className = "portfolio-total";
    total.textContent = `Totale stimato: $${Number(data.total_usd || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    content.append(total);
    for (const connector of data.connectors || []) {
      const section = document.createElement("section");
      section.className = "connector-block";
      const heading = document.createElement("h4");
      heading.textContent = `${connector.connector} · $${Number(connector.total_usd || 0).toFixed(2)}`;
      section.append(heading);
      const list = document.createElement("div");
      list.className = "balance-list";
      for (const balance of connector.balances || []) {
        const row = document.createElement("div");
        row.className = "balance-row";
        const asset = document.createElement("span");
        asset.textContent = `${balance.token} · ${Number(balance.total || 0).toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
        const value = document.createElement("strong");
        value.textContent = `$${Number(balance.usd_value || 0).toFixed(2)}`;
        row.append(asset, value);
        list.append(row);
      }
      if (!list.childElementCount) showMessage(list, "Nessun saldo valorizzato disponibile.");
      section.append(list);
      content.append(section);
    }
    if (!data.connectors?.length) showMessage(content, "Condor non ha restituito saldi per questo server.");
    state.textContent = "Dati letti";
    state.classList.remove("muted");
  } catch (error) {
    showMessage(content, `Portafoglio non disponibile: ${error.message}`);
    state.textContent = "Non disponibile";
  }
}

async function loadServers() {
  const container = document.querySelector("#condor-servers");
  showMessage(container, "Lettura server Condor…");
  try {
    const servers = await apiGet("/api/condor/servers");
    container.replaceChildren();
    if (!Array.isArray(servers) || !servers.length) {
      showMessage(container, "Nessun server Condor autorizzato.");
      return;
    }
    for (const server of servers) {
      const row = document.createElement("div");
      row.className = "server-row";
      const details = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = server.name;
      const meta = document.createElement("small");
      meta.textContent = `${server.host || "Host non indicato"} · ${server.online ? "Online" : "Offline"}`;
      details.append(name, meta);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "select-server";
      action.textContent = "Portafoglio";
      action.addEventListener("click", () => loadPortfolio(server.name));
      row.append(details, action);
      container.append(row);
    }
    const online = servers.filter((server) => server.online).length;
    document.querySelector("#engine-status").textContent = `${online}/${servers.length} server online`;
    document.querySelector("#engine-status").classList.toggle("muted", online === 0);
    const notice = document.querySelector("#connection-notice");
    notice.hidden = online > 0;
    if (online === 0) {
      notice.querySelector("strong").textContent = "Nessun server Hummingbot online";
      notice.querySelector("span").textContent = "Condor risponde, ma nessun server configurato risulta online. Controlla runtime e connessione Hummingbot API.";
    }
  } catch (error) {
    document.querySelector("#engine-status").textContent = "Condor non autenticato o non raggiungibile";
    document.querySelector("#engine-status").classList.add("muted");
    const notice = document.querySelector("#connection-notice");
    notice.hidden = false;
    notice.querySelector("strong").textContent = "Connessione Condor non disponibile";
    notice.querySelector("span").textContent = error.message === "missing_api_token"
      ? "Autenticazione Condor non configurata. Inserire nel backend un JWT di sessione Condor; mai nel browser."
      : `Condor non raggiungibile: ${error.message}`;
    showMessage(container, error.message === "missing_api_token"
      ? "Autenticazione Condor non configurata. Inserire nel backend un JWT di sessione Condor; mai nel browser."
      : `Condor non raggiungibile: ${error.message}`);
  }
}

document.querySelector("#refresh-servers")?.addEventListener("click", loadServers);
refreshConnection();
loadServers();


async function loadMarketTickers() {
  const server = document.querySelector("#market-server").value;
  const connector = document.querySelector("#market-connector").value;
  const table = document.querySelector("#market-tickers");
  const state = document.querySelector("#market-state");
  if (!server || !connector) {
    showMessage(table, "Seleziona un server e un exchange.");
    return;
  }
  state.textContent = "Caricamento";
  try {
    const data = await apiGet(
      \`/api/condor/servers/\${encodeURIComponent(server)}/market/tickers?connector=\${encodeURIComponent(connector)}\`
    );
    table.replaceChildren();
    const rows = Array.isArray(data.tickers) ? data.tickers : [];
    if (!rows.length) {
      showMessage(table, "Nessun ticker disponibile per questo exchange.");
    } else {
      const head = document.createElement("div");
      head.className = "ticker-row ticker-head";
      ["Coppia", "Prezzo", "Variazione", "Volume USD"].forEach((label) => {
        const cell = document.createElement("span");
        cell.textContent = label;
        head.append(cell);
      });
      table.append(head);
      for (const ticker of rows) {
        const row = document.createElement("div");
        row.className = "ticker-row";
        const pair = document.createElement("strong");
        pair.textContent = ticker.trading_pair || "--";
        const price = document.createElement("span");
        price.textContent = Number(ticker.price || 0).toLocaleString("en-US", { maximumFractionDigits: 10 });
        const change = document.createElement("span");
        change.textContent = ticker.change_pct == null
          ? "--"
          : \`\${Number(ticker.change_pct).toFixed(2)}% · \${Math.max(1, Math.round((ticker.change_window_s || 86400) / 3600))}h\`;
        if (ticker.change_pct != null) change.className = Number(ticker.change_pct) >= 0 ? "positive" : "negative";
        const volume = document.createElement("span");
        volume.textContent = ticker.usd_volume == null
          ? "--"
          : \`$\${Number(ticker.usd_volume).toLocaleString("en-US", { maximumFractionDigits: 0 })}\`;
        row.append(pair, price, change, volume);
        table.append(row);
      }
    }
    document.querySelector("#market-updated").textContent = data.updated_at
      ? \`Ultimo aggiornamento: \${new Date(data.updated_at * 1000).toLocaleString("it-IT")}\`
      : "Timestamp non fornito dall'exchange";
    state.textContent = \`\${rows.length} coppie\`;
    state.classList.remove("muted");
  } catch (error) {
    showMessage(table, \`Ticker non disponibili: \${error.message}\`);
    state.textContent = "Errore";
  }
}

async function loadMarketVenues() {
  const server = document.querySelector("#market-server").value;
  const select = document.querySelector("#market-connector");
  select.replaceChildren();
  select.disabled = true;
  if (!server) return;
  try {
    const data = await apiGet(\`/api/condor/servers/\${encodeURIComponent(server)}/market/venues\`);
    const venues = (data.venues || []).filter((venue) => venue.hummingbot_market_data);
    for (const venue of venues) {
      const option = document.createElement("option");
      option.value = venue.name;
      option.textContent = venue.credentialed === false ? \`\${venue.name} · solo dati\` : venue.name;
      select.append(option);
    }
    select.disabled = venues.length === 0;
    if (!venues.length) {
      showMessage(document.querySelector("#market-tickers"), "Nessun venue con feed ticker disponibile.");
      return;
    }
    await loadMarketTickers();
  } catch (error) {
    showMessage(document.querySelector("#market-tickers"), \`Venue non disponibili: \${error.message}\`);
  }
}

async function loadMarketServers() {
  const select = document.querySelector("#market-server");
  try {
    const servers = await apiGet("/api/condor/servers");
    select.replaceChildren();
    for (const server of servers) {
      const option = document.createElement("option");
      option.value = server.name;
      option.textContent = \`\${server.name} · \${server.online ? "online" : "offline"}\`;
      select.append(option);
    }
    if (!servers.length) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Nessun server disponibile";
      select.append(option);
      return;
    }
    const preferred = servers.find((server) => server.is_default) || servers.find((server) => server.online) || servers[0];
    select.value = preferred.name;
    await loadMarketVenues();
  } catch (error) {
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Condor non collegato";
    select.append(option);
    showMessage(document.querySelector("#market-tickers"), \`Server non disponibili: \${error.message}\`);
  }
}

document.querySelector("#market-server")?.addEventListener("change", loadMarketVenues);
document.querySelector("#market-connector")?.addEventListener("change", loadMarketTickers);
document.querySelector("#refresh-markets")?.addEventListener("click", loadMarketTickers);
loadMarketServers();
