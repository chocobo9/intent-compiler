# Batch 1c acceptance replay: rep1h R3's three reviews (BLOCK-ACCEPT-NOTES 22.14)

- `materials.json`: for each R3 review of rep1h, what IC held of it (the library leads it gave, the files and commands of
  the reviewer's session, read from the coding server after the run), and the carried units of R3's package.
- `replay.mjs`: formalizes each review twice — with the recorded formalizer replies and the old request (every
  round's annotated text), and with live formalizer calls and the new request (the round's package, annotated) — then
  runs the premises and the reproduction on the program the review saw (docker), with accept.ts's dispositions.
  Run from the dev worktree after `npm run build`: `node replay.mjs <this directory>` (needs the run directory, docker,
  and the management server of rep1h for the live calls).
- `result.json`: the output of the run on 2026-10-24 (code: batch 1c working tree on 00a0a7f+).
