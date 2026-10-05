import assert from 'node:assert/strict';

export function createCallBudget(limit = 8) {
  let used = 0;
  return () => { assert(used < limit, 'No further management call authorized'); return ++used; };
}

// A coding-session review can add a rejection, never remove a model finding
// or turn an unavailable/inconsistent check into an acceptance.
export function addSessionRejections(result, review) {
  assert.equal(review.origin, 'coding_session_review');
  assert(Array.isArray(review.findings));
  if (!review.findings.length) return result;
  assert(result.verdict, 'A failed model check cannot be manually accepted');
  assert(['ir', 'ci'].includes(review.repair_target));
  for (const finding of review.findings) {
    for (const key of ['dimension', 'claim', 'expected', 'observed']) assert.equal(typeof finding[key], 'string');
    assert(Array.isArray(finding.refs) && finding.refs.length > 0);
  }
  return {...result, verdict:{verdict:'inconsistent',
    repair_target:result.verdict.repair_target==='ir'||review.repair_target==='ir'?'ir':'ci',
    findings:[...result.verdict.findings,...review.findings]}};
}
