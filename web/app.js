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

async function refreshConnection() {
  const status = document.querySelector("#connection-status");
  const notice = document.querySelector("#connection-notice");
  const engine = document.querySelector("#engine-status");
  try {
    const response = await fetch("/api/health", { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const health = await response.json();
    if (!health.ok || health.mode !== "PAPER" || health.live_enabled !== false) throw new Error("Invalid safety state");
    status.textContent = "Backend Miracolo raggiungibile · PAPER";
    status.classList.add("online");
    status.querySelector(".dot")?.classList.remove("offline");
    notice.hidden = true;
    engine.textContent = "Backend disponibile · Condor da verificare";
    engine.classList.remove("muted");
  } catch {
    status.textContent = "Backend non raggiungibile";
    status.classList.remove("online");
    status.querySelector(".dot")?.classList.add("offline");
    notice.hidden = false;
    engine.textContent = "In attesa del backend";
    engine.classList.add("muted");
  }
}
refreshConnection();
