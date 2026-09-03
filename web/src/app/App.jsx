import { useState } from "preact/hooks";
import { LeaguePanel } from "../league/LeaguePanel.jsx";
import styles from "./App.module.css";
import { Footer } from "./Footer.jsx";
import { LeagueTabs } from "./LeagueTabs.jsx";
import { Masthead } from "./Masthead.jsx";

/** The whole page: masthead, one tab per league, the active league's draft room, footer. */
export function App({ data }) {
  const { leagues, live, year } = data;
  // Which league is showing is per-viewer chrome, deliberately not saved state.
  const [active, setActive] = useState(0);
  return (
    <main class={styles.page}>
      <Masthead year={year} leagueCount={leagues.length} />
      <LeagueTabs leagues={leagues} active={active} onSelect={setActive} />
      {leagues.map((league) => (
        <LeaguePanel
          key={league.key}
          league={league}
          live={live}
          active={league.index === active}
        />
      ))}
      <Footer live={live} />
    </main>
  );
}
