"use strict";

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
const initial = links.find((link) => link.dataset.view === location.hash.slice(1));
if (initial) navigate(initial);

async function refreshStatus() {
  const status = document.querySelector("#connection-status");
  const notice = document.querySelector("#connection-notice");
  const alpaca = document.querySelector("#alpaca-status");
  const heading = document.querySelector("#alpaca-heading");
  const detail = document.querySelector("#alpaca-detail");
  const runtime = document.querySelector("#runtime-state");
  const runtimeNote = document.querySelector("#runtime-note");
  const dot = document.querySelector("#connection-dot");
  const sidebarDot = document.querySelector("#sidebar-dot");
  try {
    const response = await fetch("/api/health", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || data.ok !== true || data.mode !== "PAPER" || data.live_enabled !== false) {
      throw new Error("Runtime non disponibile o stato di sicurezza non valido");
    }
    status.textContent = "Runtime Miracolo attivo · PAPER";
    dot.classList.remove("offline");
    sidebarDot.classList.remove("offline");
    runtime.textContent = "Attivo";
    runtimeNote.textContent = "API raggiungibile";
    alpaca.textContent = data.alpaca_configured ? "Credenziali presenti" : "Credenziali mancanti";
    alpaca.className = data.alpaca_configured ? "pill online" : "pill muted";
    heading.textContent = data.alpaca_configured ? "Credenziali Alpaca configurate" : "Credenziali Alpaca non configurate";
    detail.textContent = data.alpaca_configured
      ? "Il server ha le credenziali PAPER. La sessione privata e i controlli di rischio non sono ancora abilitati."
      : "Il runtime risponde, ma sul server non risultano configurate le credenziali Alpaca PAPER.";
    notice.hidden = true;
  } catch (error) {
    status.textContent = "Backend non raggiungibile";
    dot.classList.add("offline");
    sidebarDot.classList.add("offline");
    runtime.textContent = "Offline";
    runtimeNote.textContent = "API non raggiungibile";
    alpaca.textContent = "Non verificabile";
    alpaca.className = "pill muted";
    heading.textContent = "In attesa del backend";
    detail.textContent = "La pagina è soltanto l'interfaccia. Per leggere dati Alpaca serve il runtime Python protetto sul server.";
    notice.hidden = false;
    notice.querySelector("strong").textContent = "Runtime non collegato";
    notice.querySelector("span").textContent = error.message;
  }
}

document.querySelector("#refresh-status")?.addEventListener("click", refreshStatus);
refreshStatus();
