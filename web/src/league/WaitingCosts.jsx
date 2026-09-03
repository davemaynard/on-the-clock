import shared from "../styles/shared.module.css";
import styles from "./WaitingCosts.module.css";

const SHOWN = 8;

/**
 * The pre-draft table: value of the best player still on the board, by position, at
 * each of your first picks. Structural, from simulated drafts, not live.
 */
export function WaitingCosts({ picks, curve }) {
  if (!picks.length) {
    return (
      <>
        <h2>What waiting costs</h2>
        <p class={shared.lede}>
          Not built yet: the draft order isn't published. Rebuild this page once the slot is known
          for the full pre-draft table; the live tracker above works either way, from the slot you
          set or the one ESPN reveals.
        </p>
      </>
    );
  }
  const shown = picks.slice(0, SHOWN);
  return (
    <>
      <h2>What waiting costs</h2>
      <p class={shared.lede}>
        Value of the best player still on the board, by position, at each of your first eight picks,
        from 4,000 simulated drafts run before the draft starts. Structural, not live: a flat row
        means waiting is free, a steep one means the tier empties before your next turn.
      </p>
      <div class={styles.scroller}>
        <table class={styles.curve}>
          <thead>
            <tr>
              <th scope="col">
                <span class={shared.visuallyHidden}>Position</span>
              </th>
              {shown.map((pick) => (
                <th key={pick} scope="col">
                  {pick}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {curve.map(({ pos, values }) => {
              const top = Math.max(...values) || 1;
              return (
                <tr key={pos}>
                  <th scope="row">{pos}</th>
                  {values.map((value, i) => (
                    <td key={shown[i]}>
                      <span class={styles.heat} style={{ "--fill": (value / top).toFixed(3) }}>
                        {Math.round(value)}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
