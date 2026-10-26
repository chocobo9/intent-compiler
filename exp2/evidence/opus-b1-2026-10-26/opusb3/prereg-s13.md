# DESIGN-OPUS section 13 on exp2-icacc-r6-luna56-low-opusb3-20261026

| line | value | |
|---|---|---|
| R3–R6 (i) a round (A: against both control runs) <= 4 | R3 12, R4 12, R5 16, R6 25 | 不过 |
| R5 >= 656, R6 >= 688 | R5 640, R6 663 | 不过 |
| executor and reviewer original text a round <= round text x 2 + 10k (A+B over: sent, marked) | R1 21.8k/21.8k of 47.6k; R2 42.3k/39.1k of 59.2k; R3 26.7k/23.1k of 28.9k; R4 16.5k/11.1k of 19.5k; R5 18.6k/18.1k of 18.6k; R6 16.6k/19.3k of 16.6k | 不过 |
| non-executor tokens over six rounds <= 3.90M (uncached + 0.1 x cache read + output) | 5.00M | 不过 |
| wall over six rounds <= 248 min | 125 min | 过 |
| whole-cycle reverts = 0 | 0 | 过 |
| COVERED (only reported): guards / sentences bound / a line / unstable / conflicts, by round | R1 9/14/1.6/1/11; R2 6/15/2.5/0/6; R3 8/13/1.6/0/6; R4 12/39/3.3/0/7; R5 11/24/2.2/0/3; R6 10/28/2.8/10/1 | 只报（预先记为不过：冻结错误输出） |
| debt (only reported): entered / cleared / left, slice paragraphs | R1 +8/−0/8 (0); R2 +125/−5/128 (7); R3 +30/−19/142 (8); R4 +1/−32/111 (8); R5 +0/−33/78 (8); R6 +26/−20/84 (8) | 只报 |

## Snapshot guards: flips (regressions on unchanged text) and A cases on their op at the round's end

| round | snapshot flips | sent back to the executor | ops | A cases failing at the end on those ops |
|---|---|---|---|---|
| R1 | 6 (G15, G16, G17, G18, G14, G27) | 6 | filter, derive, manifest, sort | 5 (transform.sort, transform.derive) |
| R2 | 4 (G18, G50, G51, G63) | 4 | sort, profile, manifest | 52 (profile) |
| R3 | 2 (G64, G98) | 2 | normalize, manifest | 2 (transform.normalize) |
| R4 | 5 (G18, G114, G116, G117, G125) | 5 | sort, --help, manifest, validate | 0 |
| R5 | 11 (G13, G27, G84, G85, G122, G123, G127, G143, G144, G155, G157) | 11 | ingest, derive, fill, deduplicate, drift, checkpoint, manifest, profile | 9 (transform.derive, profile, transform.deduplicate) |
| R6 | 13 (G12, G13, G27, G84, G85, G122, G127, G153, G156, G158, G171, G172, G177) | 6 | ingest, derive, fill, deduplicate, checkpoint, filter, impute, detect, bin, resample | 11 (ingest, transform.derive, transform.deduplicate, transform.detect) |

## Items held (no progress) and their end

| round | held (distinct items) | of them passing at the round's end | still open at the end | guards among the held |
|---|---|---|---|---|
| R1 | 14 | 8 | 6 | 2 |
| R2 | 35 | 3 | 32 | 6 |
| R3 | 35 | 7 | 28 | 9 |
| R4 | 39 | 3 | 36 | 6 |
| R5 | 55 | 0 | 55 | 21 |
| R6 | 73 | 16 | 57 | 33 |

## (i) cases (A, failing at first delivery and at the end, op named by no review item)

- R3: c279 transform.deduplicate; c336 transform.normalize; c337 transform.normalize; c428 transform.rename-drop; c429 transform.rename-drop; c430 transform.rename-drop; c433 transform.encode; c434 transform.encode; c435 transform.encode; c436 transform.encode; c476 transform.encode; c477 transform.encode
- R4: c142 transform.window; c143 transform.window; c144 transform.window; c145 transform.window; c146 transform.window; c147 transform.window; c148 transform.window; c279 transform.deduplicate; c336 transform.normalize; c337 transform.normalize; c470 compare; c471 compare
- R5: c141 transform.window; c142 transform.window; c143 transform.window; c144 transform.window; c145 transform.window; c146 transform.window; c147 transform.window; c278 transform.deduplicate; c335 transform.normalize; c336 transform.normalize; c432 transform.encode; c433 transform.encode; c434 transform.encode; c435 transform.encode; c469 compare; c470 compare
- R6: c111 determinism; c141 transform.window; c142 transform.window; c143 transform.window; c144 transform.window; c145 transform.window; c146 transform.window; c147 transform.window; c256 profile; c278 transform.deduplicate; c317 profile; c335 transform.normalize; c336 transform.normalize; c416 profile; c417 profile; c423 profile; c424 profile; c425 profile; c432 transform.encode; c433 transform.encode; c434 transform.encode; c435 transform.encode; c469 compare; c470 compare; c668 determinism

## Verdict

Lines failing: (i), R5/R6, original text, tokens. COVERED: pre-recorded as 不过 (frozen wrong output). A cases on ops of flipped snapshot guards, summed over rounds: 79. Whether a failing line's loss falls on regressions the snapshot guards pulled back (then 未证明 under the contamination rule) is in the case accounts.
