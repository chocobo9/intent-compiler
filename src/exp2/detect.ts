/**
 * The product list of the offline replay (`intent-exp2-replay`). The BLOCK9 harness that ran a state's library on the
 * products (`detect`, `intent-exp2-detect`) is gone with the probes path (§12j.4); git has it before batch 1.
 */

export interface Product {
  name: string
  /** The round whose library judges it. */
  round: number
  /** The product's Go source tree (read only; built elsewhere). */
  path: string
  /** Official result, as the list gives it (for the table only). */
  official?: string
  note?: string
}

/** Tab-separated: name, round, path, official result, note; `#` starts a comment. */
export function parseProducts(text: string): Product[] {
  return text.split(/\r?\n/u).map(l => l.replace(/#.*$/u, "").trimEnd()).filter(l => l.trim()).map(l => {
    const [name, round, path, official, note] = l.split("\t").map(x => x.trim())
    if (!name || !round || !path || !Number.isSafeInteger(Number(round))) throw new Error(`product line needs name, round and path, tab-separated: ${l}`)
    return { name, round: Number(round), path, ...(official ? { official } : {}), ...(note ? { note } : {}) }
  })
}
