/**
 * Checks that judge each item on its own report every failing item in one
 * rejection, so a repair is one answer and not one answer per item.  One
 * problem keeps its own message; several are joined by PROBLEM_SEPARATOR.
 */
export const PROBLEM_SEPARATOR = " | "
const LISTED_PROBLEMS = 12

/** Throw one error naming every collected problem (and how many more were left out). */
export function throwProblems(problems: readonly string[]): void {
  if (problems.length === 0) return
  const hidden = problems.length - LISTED_PROBLEMS
  throw new Error(problems.slice(0, LISTED_PROBLEMS).join(PROBLEM_SEPARATOR) + (hidden > 0 ? `${PROBLEM_SEPARATOR}${hidden} more not listed` : ""))
}

/** Run one item's check; a failure becomes a problem instead of ending the pass. */
export function collectProblem(problems: string[], check: () => void): void {
  try { check() } catch (error) { problems.push(error instanceof Error ? error.message : String(error)) }
}
