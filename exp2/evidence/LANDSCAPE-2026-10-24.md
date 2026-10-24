# Landscape check: is the problem open, what to cite, what a paper needs (2026-10-24)

Subagent (Opus, ~15 searches, abstracts + bodies of the key benchmarks). Lowest-weight reference; claims tagged [O] read in
source / [I] inference by the agent. Used to set the "paper version" of PROTOCOL-2026-10-24.md.

## Is the problem open — yes
- EvoCode-Bench (2605.24110, preprint): 26 tasks, 13 models; best multi-round MT@4 54.0 (Opus-4.7); SR exceeds MT@4 by
  22–40; main failure "missed active requirement" (87–90%), stale superseded behaviour 28.6% mid-tier, regression 18.2%
  top-tier late rounds; authors suggest but do not test regression checks between rounds and active-requirement
  summaries. [O]
- SWE-Milestone (2603.13428, ICML 2026): >80% isolated → 38.03% continuous. SlopCodeBench (2603.24755): best 14.8%,
  cost per checkpoint ×2.2. SWE-EVO (2512.18470): best 25%. Regression Accumulation (2607.01855): 40–73% of tasks lose
  earlier behaviour. [O]

## Per sub-problem: cite rather than claim
- (a) requirement versioning: OpenSpec (ADDED/MODIFIED/REMOVED delta specs, no test binding); ProReFiCIA (2511.00262,
  TOSEM per snippet): change-impact recall 85.7% — the vetted analogue of our revision-relation recall; TraceDev (ISSTA 2026).
- (b) accumulated tests as guards: Verification Gate (2607.01855); TDAD (2603.17973); AnyPoC. **Risk**: Charoosaei et al.
  (2610.11835): 8–17% of LLM-generated tests are fault-enforcing and 83–92% stay so → IC must measure its guards'
  fault-enforcing rate.
- (c) regression vs obsolete test: Hao et al. ECOOP 2013; Testora (ICSE 2026): intended vs unintended from PR text;
  TEBench: test-stale hardest category (~36% F1).
- (d) delta vs cumulative context: SR-Eval (2509.18808); MemTrace (2610.04838): provenance-anchored memory, +17.8 on
  SWE-Milestone.
- (e) reproduce-before-repair: AnyPoC; Jin & Chen (2603.00539); "You're Right, Let Me Fix It" (2609.32616): false
  accusations damage correct work in up to 60% of runs, a harness gate cuts harm 74%.
- (f) attribution: Who&When (ICML 2025): 53.5% agent / 14.2% step.

## Plausibly unaddressed (weak evidence)
The closed loop: sentence-level revision record → guard provenance bound to sentences → deterministic flip classification
(superseded vs regression) → relation-scoped delivery to executor and reviewer, evaluated over many rounds with
withdrawals, with a cost slope against accumulated text. No individual mechanism is novel on its own.

## Paper checklist (minimum credible) vs our protocol
| item | paper minimum | our protocol (engineering) |
|---|---|---|
| tasks | all 26 EvoCode + one other suite + ~5 withdrawal-rich tasks | dpipe + lsm + service-mesh |
| models | ≥ 3 incl. one open-weight | 1 (gpt-5.6-luna-fast) |
| seeds | ≥ 3 per arm per task, CIs, paired test | ≤ 2 |
| baselines | bare CLI; trial+reviewer (ours); AGENTS.md/OpenSpec file; accumulated-tests gate with rollback; MemTrace | ours only |
| ablations | revision record off / LLM-judged flips; guards off or without provenance; cumulative text; reproduce gate off; LLM attribution | delta vs all only |
| metrics | per-round pass, MT@4/SR, first-violation round, regression and stale counts, flip-classifier P/R, guard fault-enforcing rate, cost slope | most, minus fault-enforcing rate and flip P/R |
| gold sets | two annotators + kappa for revision links, flip labels, attribution | single model + spot checks |
| threats | tests as sole oracle; dpipe leakage into design (held-out mandatory); model drift; fail-stop scoring; single-annotator labels | recorded |
| artifact | code, prompts, logs, records, containers | partly |
