import styles from "./Footer.module.css";

/** Where the numbers come from, in four short paragraphs. */
export function Footer({ live }: { live: boolean }) {
  return (
    <footer class={styles.footer}>
      <p>
        <b>Projections</b> are ESPN's own, run through each league's actual scoring, verified by
        recomputing every rule against ESPN's projected stat lines and matching their published
        totals to the cent. <b>VOR</b> is value over replacement, where replacement comes from a
        greedy fill of that league's real starting lineup.
      </p>
      <p>
        <b>Before the draft</b>, availability is modelled from each player's ADP. <b>During it</b>,
        the model switches to something stronger: how many players the market rates above him are
        still on the board, against how many picks separate you from your turn. Recording picks
        makes the numbers better, not just tidier.
      </p>
      <p>
        <b>Kickers and defenses sit at the bottom with real numbers</b>: VOR against the first unit
        left on waivers. Still take them with your last two picks; the numbers are there so those
        picks aren't guesses. <b>Only Out and Doubtful are flagged</b>; ESPN had 17 of the top 20
        projected players marked Questionable in camp.
      </p>
      <p>
        {live && (
          <>
            <b>Live sync is on.</b> Picks entered in ESPN are marked off automatically; tapping
            still works and always wins.{" "}
          </>
        )}
        Picks are stored in this browser only; nothing is shared or uploaded. Rebuild the board the
        morning of each draft; August boards move weekly.
      </p>
    </footer>
  );
}
