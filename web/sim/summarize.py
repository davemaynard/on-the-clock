"""Roll up one or more sim reports: where the page and the judge part ways, and the
roster shapes the page builds.

    python web/sim/summarize.py out/sim-report-*.md
"""

import re
import sys
from collections import Counter

rows, rosters, verdicts = [], [], Counter()
for path in sys.argv[1:]:
    text = open(path).read()
    body = text.split("## Every pick", 1)[1].split("## Rosters", 1)[0]
    for line in body.splitlines():
        m = re.match(r"\| (\d+) \| (\d+) \| (.*?) \| (.*?) \| (.*?) \| (\w+) \|$", line)
        if m:
            rows.append(m.groups())
            verdicts[m.group(6)] += 1
    rosters += re.findall(r"^- Draft \d+: (.*)$", text, re.M)

print(f"{len(rows)} of your picks over {len(rosters)} rooms:", dict(verdicts))

print("\nDivergence rate by pick:")
by_pick = Counter(int(r[1]) for r in rows)
div_pick = Counter(int(r[1]) for r in rows if r[5] == "DIVERGE")
for pick in sorted(by_pick):
    if div_pick[pick]:
        print(f"  pick {pick:>3}: {div_pick[pick]}/{by_pick[pick]}")

print("\nWhat the page took first at pick 19 (round 2):")
for name, n in Counter(r[3].split(" / ")[0] for r in rows if r[1] == "19").most_common(8):
    print(f"  {n:>3}  {name}")

print("\nAdvice line at pick 19:")
for adv, n in Counter(r[2] for r in rows if r[1] == "19").most_common(5):
    print(f"  {n:>3}  {adv}")

print("\nTight ends per roster:")
for k, n in sorted(Counter(r.count("TE ") for r in rosters).items()):
    print(f"  {k} TEs: {n} rooms")
qb_early = sum(1 for r in rows if int(r[1]) < 78 and r[3].split(' / ')[0] in ('Josh Allen', 'Jalen Hurts', 'Jayden Daniels', 'Lamar Jackson', 'Joe Burrow'))
print(f"\nQB proposed first before pick 78: {qb_early} of {len(rosters)} rooms")
