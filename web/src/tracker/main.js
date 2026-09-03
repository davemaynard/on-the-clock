// The tracker. The page carries its data in `window.ON_THE_CLOCK` (one entry per
// league, plus whether live sync is on); everything else is derived here.
import { mountLeague } from "./league.js";

const { leagues, live } = window.ON_THE_CLOCK;

// League tabs: per-viewer chrome, deliberately not shared state. Roving tabindex and
// arrow keys, so the tab roles keep the keyboard contract they promise.
const tabs = [...document.querySelectorAll(".tab")];
const selectTab = (tab) => {
  for (const other of tabs) {
    const selected = other === tab;
    other.setAttribute("aria-selected", String(selected));
    other.tabIndex = selected ? 0 : -1;
    document.getElementById(other.dataset.panel).classList.toggle("is-active", selected);
  }
};
tabs.forEach((tab, i) => {
  tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    selectTab(next);
    next.focus();
  });
});

for (const league of leagues) mountLeague(league, live);
