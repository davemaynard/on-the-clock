// The tracker. The page carries its data in `window.ON_THE_CLOCK` (one entry per
// league, plus whether live sync is on); everything else is derived here.
import { mountLeague } from "./league.js";

const { leagues, live } = window.ON_THE_CLOCK;

// League tabs: per-viewer chrome, deliberately not shared state.
const tabs = [...document.querySelectorAll(".tab")];
for (const tab of tabs) {
  tab.addEventListener("click", () => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      document.getElementById(other.dataset.panel).classList.toggle("is-active", selected);
    }
  });
}

for (const league of leagues) mountLeague(league, live);
