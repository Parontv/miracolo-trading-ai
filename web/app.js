const links = [...document.querySelectorAll("[data-view]")];
const views = [...document.querySelectorAll(".view")];
const title = document.querySelector("#page-title");
links.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const name = link.dataset.view;
    links.forEach((item) => item.classList.toggle("active", item === link));
    views.forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    title.textContent = link.textContent.trim();
    history.replaceState(null, "", `#${name}`);
  });
});
const initial = location.hash.slice(1);
const initialLink = links.find((link) => link.dataset.view === initial);
if (initialLink) initialLink.click();