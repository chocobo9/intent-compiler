/**
 * Runs `f` over `items` with at most `n` at a time (BLOCK10 §9.1); results in the order of `items`, whatever
 * order they finish in. The first error is raised once every started task has settled.
 */
export async function mapPool<T, R>(items: readonly T[], n: number, f: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0, failed: { e: unknown } | null = null
  const worker = async () => {
    while (next < items.length && !failed) {
      const i = next++
      try { out[i] = await f(items[i], i) } catch (e) { failed ??= { e } }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  if (failed) throw (failed as { e: unknown }).e
  return out
}
