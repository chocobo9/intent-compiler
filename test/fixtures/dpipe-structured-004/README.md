# Frozen dpipe structured-output failure

`candidate.json` and `event.json` are unchanged copies of the real full first-round
run `dpipe-full-semantic-smoke-20260928-004` on 2026-09-28. Originals:

- `D:\huawei\intent_compiler\smoke\dpipe-full-20260928-001\runs\dpipe-full-semantic-smoke-20260928-004\management-candidate-original.txt`
- `D:\huawei\intent_compiler\smoke\dpipe-full-20260928-001\runs\dpipe-full-semantic-smoke-20260928-004\round-01-input.json`

The real output contains five misplaced root arrays and lacks source_coverage.
It selects 40 of 48 original source segments into 10 content items, with 6 Atoms
and 5 Relations. The eight unselected segments are enclosing headings.

`test/dpipe-structured-replay.test.ts` runs the actual transport, model parser,
compiler preparation and dispatch projection without any network/model calls:

1. The unchanged real response must fail the sent strict schema with all six
   errors, retaining raw output and usage.
2. A fixture with corrected root shape must still fail source completeness.
3. A deliberately authored expectation adds each missing heading to its named
   IR destinations. That expectation must preserve all source segments, canonical
   requirement bytes, the task hierarchy, relations and dependency-gated dispatch.

The third case is a deterministic mechanism test, not evidence that the model
generated a valid candidate. No production code applies its fixture corrections.
