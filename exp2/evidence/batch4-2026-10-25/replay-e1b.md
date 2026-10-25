# Batch 4 E1b: flips, stale checks and scope under change units, against the runs' records

| run | flips | classification changed | rounds with stale-check differences | rounds with scope differences |
|---|---|---|---|---|
| rep1j | 8 | 0 | 0 | 0 |
| rep1k | 8 | 2 | 0 | 0 |
| rep1l | 0 | 0 | 0 | 0 |
| rep1m | 0 | 0 | 0 | 0 |
| rep1n | 15 | 0 | 0 | 2 |

## Flips

| run | round | guard | cycle | recorded | now | retired by the reviewer | units behind it now |
|---|---|---|---|---|---|---|---|
| rep1j | 1 | G3 | C1.3 | regression (none) | regression (none) |  |  |
| rep1j | 1 | G3 | C1.4 | regression (none) | regression (none) |  |  |
| rep1j | 2 | G3 | C2.1 | changed_text (object, edge) | changed_text (object) | yes |  |
| rep1j | 5 | G1 | C5.2 | changed_text (revision, object) | changed_text (revision, object) | yes |  |
| rep1j | 5 | G57 | C5.3 | regression (none) | regression (none) |  |  |
| rep1j | 5 | G57 | C5.4 | regression (none) | regression (none) |  |  |
| rep1j | 5 | G57 | C5.5 | regression (none) | regression (none) |  |  |
| rep1j | 6 | G57 | C6.1 | regression (none) | regression (none) |  |  |
| rep1k | 3 | G40 | C3.1 | changed_text (revision, object) | changed_text (revision, object) | yes |  |
| rep1k | 5 | G2 | C5.2 | changed_text (revision, object) | changed_text (revision, object) | yes |  |
| rep1k | 5 | G3 | C5.2 | changed_text (revision, object) | changed_text (revision, object) | yes |  |
| rep1k | 5 | G4 | C5.2 | changed_text (object, edge) | changed_text (object) | yes |  |
| rep1k | 5 | G5 | C5.2 | regression (none) | regression (none) |  |  |
| rep1k | 5 | G16 | C5.2 | changed_text (object) | changed_text (object) | yes |  |
| rep1k | 6 | G87 | C6.1 | changed_text (edge) | regression (none) **differs** |  |  |
| rep1k | 6 | G88 | C6.1 | changed_text (edge) | regression (none) **differs** |  |  |
| rep1n | 5 | G5 | C5.2 | regression (none) | regression (none) |  |  |
| rep1n | 5 | G6 | C5.2 | changed_text (object) | changed_text (object) | yes |  |
| rep1n | 5 | G7 | C5.2 | regression (none) | regression (none) |  |  |
| rep1n | 5 | G9 | C5.2 | changed_text (object) | changed_text (object) | yes |  |
| rep1n | 5 | G14 | C5.2 | changed_text (object) | changed_text (object) | yes |  |
| rep1n | 5 | G64 | C5.4 | regression (none) | regression (none) |  |  |
| rep1n | 5 | G65 | C5.4 | regression (none) | regression (none) |  |  |
| rep1n | 5 | G64 | C5.5 | regression (none) | regression (none) |  |  |
| rep1n | 5 | G65 | C5.5 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G64 | C6.1 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G65 | C6.1 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G5 | C6.2 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G7 | C6.2 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G5 | C6.4 | regression (none) | regression (none) |  |  |
| rep1n | 6 | G7 | C6.4 | regression (none) | regression (none) |  |  |

## Stale checks: more or fewer than the run marked

| run | round | stale now, not then | stale then, not now |
|---|---|---|---|

## Objects in scope through another object's text (edge then, unit now)

| run | round | in scope now through a unit, not through an edge then | through an edge then, out of scope now |
|---|---|---|---|
| rep1n | 5 | O2 ingest command (U5.c1) | — |
| rep1n | 6 | O1 dpipe CLI (U6.c1) | — |
