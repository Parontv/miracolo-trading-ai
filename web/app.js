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
