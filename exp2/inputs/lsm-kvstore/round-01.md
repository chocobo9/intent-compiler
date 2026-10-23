I need a high-performance embedded key-value storage engine built in Go from scratch, using an LSM-Tree (Log-Structured Merge-Tree) architecture with full MVCC (Multi-Version Concurrency Control) support, optimistic transactions, and advanced query capabilities. The engine must be accessible through a command-line interface that reads commands from stdin (one per line) and writes results to stdout.

## CLI Interface

The binary should be buildable via `go build -o kvstore ./cmd/kvstore` from the `/app` directory. It accepts a `--data-dir <path>` flag (default: `./data`) pointing to the directory where all persistent state is stored.

### Basic Commands

- **`PUT <key> <value>`** — Insert or update a key-value pair outside any transaction (auto-commit). Keys are single tokens (no whitespace). Values are everything after the key, trimmed of leading/trailing whitespace. Output: `OK <seqnum>` where seqnum is the assigned sequence number.
- **`GET <key>`** — Retrieve the latest committed value. Output: the value string if found, or `NOT_FOUND`.
- **`DELETE <key>`** — Mark a key as deleted via point tombstone (auto-commit). Output: `OK <seqnum>`.
- **`DELETE_RANGE <start_key> <end_key>`** — Mark all keys in the inclusive lexicographic range [start_key, end_key] as deleted via a range tombstone (auto-commit). Output: `OK <seqnum>`.
- **`SCAN <start_key> <end_key> [flags]`** — Inclusive lexicographic range scan on the latest committed state. Output one line per matching entry: `<key>\t<value>` (tab-separated). Flags:
  - `--prefix <p>` — Only return keys starting with prefix `p` (applied within the [start_key, end_key] range).
  - `--limit <N>` — Return at most N entries.
  - `--reverse` — Return entries in reverse lexicographic order.
  - Flags can be combined in any order. Output nothing if the result is empty. Deleted keys (by point or range tombstone) must not appear.
- **`FLUSH`** — Force the current MemTable to be written to disk as an SSTable. Output: `OK`.
- **`COMPACT`** — Trigger a full compaction across all levels. Output: `OK`.
- **`STATS`** — Output engine statistics as `key=value` pairs, one per line. Must include at minimum: `memtable_size`, `l0_sstable_count`, `total_sstable_count`, `total_keys` (live keys excluding tombstoned/expired), `wal_size`, `current_seqnum` (latest assigned sequence number), `open_snapshots` (number of active snapshots), `open_transactions` (number of active transactions).

### MVCC Snapshot Commands

- **`SNAPSHOT`** — Create a read-only snapshot at the current committed sequence number. Output: `SNAP:<id>` where id is a monotonically increasing integer starting at 1.
- **`SNAP_GET <snap_id> <key>`** — Read a key from the given snapshot. Only mutations with sequence number <= the snapshot's sequence number are visible. Output: value or `NOT_FOUND`.
- **`SNAP_SCAN <snap_id> <start_key> <end_key> [flags]`** — Range scan from the given snapshot. Same flags as SCAN. Only data committed at or before the snapshot's sequence number is visible.
- **`SNAP_RELEASE <snap_id>`** — Release a snapshot. Output: `OK`. After release, the snapshot ID is invalid and further operations on it return `ERROR: invalid snapshot`.

### Transaction Commands

Transactions use optimistic concurrency control (OCC). Each transaction operates on a private snapshot taken at BEGIN time, with buffered writes.

- **`BEGIN`** — Start a new transaction. Output: `TX:<id>` where id is a monotonically increasing integer starting at 1.
- **`TX_PUT <tx_id> <key> <value>`** — Buffer a PUT within the transaction. Output: `OK`.
- **`TX_DELETE <tx_id> <key>`** — Buffer a DELETE within the transaction. Output: `OK`.
- **`TX_DELETE_RANGE <tx_id> <start_key> <end_key>`** — Buffer a range DELETE within the transaction. Output: `OK`.
- **`TX_GET <tx_id> <key>`** — Read a key within the transaction. Sees the transaction's own buffered writes overlaid on its snapshot. Output: value or `NOT_FOUND`.
- **`TX_SCAN <tx_id> <start_key> <end_key> [flags]`** — Scan within the transaction. Sees buffered writes overlaid on snapshot. Same flags as SCAN.
- **`COMMIT <tx_id>`** — Attempt to commit the transaction. Uses optimistic conflict detection: if any key written by this transaction was also written (committed) by another transaction after this transaction's snapshot sequence number, the commit fails. Output: `OK <seqnum>` on success (seqnum is the commit sequence number), or `CONFLICT` on conflict. On conflict, the transaction is automatically rolled back.
- **`ROLLBACK <tx_id>`** — Discard all buffered writes. Output: `OK`.

A committed transaction's writes become visible atomically — they all share the same sequence number and are written to the WAL as a single batch entry.

Invalid transaction IDs (already committed, rolled back, or non-existent) return `ERROR: invalid transaction`.

### Write Batch Command

For atomic multi-key writes without full transaction overhead:

- **`BATCH <count>`** — Start reading a write batch of `count` operations. The next `count` lines must each be either `PUT <key> <value>` or `DELETE <key>` or `DELETE_RANGE <start> <end>`. All operations in the batch are written atomically to the WAL and applied with the same sequence number. Output after all operations are read: `OK <seqnum>`.

### Error Handling

The tool must handle EOF on stdin gracefully by flushing any pending MemTable data and exiting with code 0. Unknown commands produce `ERROR: unknown command` on stdout and continue processing. Commands with wrong argument counts produce `ERROR: wrong number of arguments` and continue.

## Storage Architecture

### Sequence Numbers and MVCC

Every mutation (PUT, DELETE, DELETE_RANGE) is assigned a monotonically increasing sequence number starting at 1. The sequence number is persisted in the WAL and SSTables. Multiple mutations in a single batch or transaction commit share the same sequence number.

For reads:
- Non-transactional GET/SCAN always read at the latest committed sequence number.
- Snapshot reads see only mutations with seq <= snapshot_seq.
- Transaction reads see their own buffered writes plus the snapshot at BEGIN time.

Compaction must preserve entries that are still visible to any open snapshot. An entry with sequence number S can only be garbage collected if: (a) there is a newer entry for the same key, AND (b) S is less than the minimum sequence number of all open snapshots, AND (c) the newer entry also has seq <= min_snapshot_seq (so the snapshot would see the newer version instead). If no snapshots are open, standard compaction rules apply (keep only newest entry per key).

### Write-Ahead Log (WAL)

Every mutation must be durably appended to the WAL before acknowledgment. The WAL supports two entry types:

**Single entry:**
| Field | Type | Description |
|-------|------|-------------|
| entry_type | uint8 | 1 = single |
| op | uint8 | 1 = PUT, 2 = DELETE, 3 = DELETE_RANGE |
| seqnum | uint64 LE | Sequence number |
| key_len | uint32 LE | Key length |
| key | []byte | Key |
| val_len | uint32 LE | Value length (0 for DELETE; for DELETE_RANGE: end_key length) |
| value | []byte | Value (for DELETE_RANGE: end_key) |
| crc | uint32 LE | CRC-32 IEEE over all preceding fields |

**Batch entry** (for write batches and transaction commits):
| Field | Type | Description |
|-------|------|-------------|
| entry_type | uint8 | 2 = batch |
| seqnum | uint64 LE | Shared sequence number |
| op_count | uint32 LE | Number of operations |
| ops | []op | Sequence of operations, each: op(uint8) + key_len(uint32 LE) + key + val_len(uint32 LE) + value |
| crc | uint32 LE | CRC-32 IEEE over all preceding fields |

On startup, replay the WAL. Entries with CRC mismatch are discarded and replay stops at the first corrupted entry. After successful MemTable flush, truncate the WAL.

### MemTable

In-memory sorted data structure holding recent writes. Each entry stores: key, value, sequence number, operation type (put/delete/delete_range). When total data size (sum of key+value byte lengths) reaches or exceeds **4096 bytes**, auto-flush to Level-0 SSTable.

Range tombstones in the MemTable are stored as special entries with the start_key as the key and end_key as the value, marked with op type DELETE_RANGE. During reads, range tombstones must be checked: a key K is covered by a range tombstone [S, E] if S <= K <= E and the range tombstone's sequence number is greater than K's latest PUT sequence number.

### SSTable File Format

Each SSTable is named `<seqnum>_<level>.sst` (e.g., `000042_0.sst`). File layout:

1. **Data section**: Blocks of ~4096 bytes. Each entry in a block:
   - `key_len` (uint32 LE) + `key` + `val_len` (uint32 LE) + `value` + `op_type` (uint8: 1=put, 2=delete, 3=delete_range) + `seqnum` (uint64 LE)

2. **Index section**: Per-block index entries:
   - `first_key_len` (uint32 LE) + `first_key` + `block_offset` (uint64 LE) + `block_size` (uint32 LE)

3. **Bloom filter section**: Serialized bloom filter (k=7, m=10 bits per key) for point keys only (not range tombstone endpoints).

4. **Range tombstone section**: All range tombstones in this SSTable, sorted by start_key:
   - `count` (uint32 LE)
   - For each: `start_key_len` (uint32 LE) + `start_key` + `end_key_len` (uint32 LE) + `end_key` + `seqnum` (uint64 LE)

5. **Footer** (76 bytes):
   - `index_offset` (uint64 LE), `index_size` (uint32 LE)
   - `bloom_offset` (uint64 LE), `bloom_size` (uint32 LE)
   - `range_tomb_offset` (uint64 LE), `range_tomb_size` (uint32 LE)
   - `key_count` (uint64 LE), `data_size` (uint64 LE)
   - `min_seqnum` (uint64 LE), `max_seqnum` (uint64 LE)
   - `magic` (uint64 LE) = `0x4C534D5453535400`

### Read Path

**GET**: Check MemTable first (including checking range tombstones). Then SSTables from newest to oldest. For each SSTable, check bloom filter, then check range tombstones, then search data blocks. Return the first match with highest sequence number. If match is a point or range tombstone, return NOT_FOUND. For snapshot reads, only consider entries with seq <= snapshot_seq.

**SCAN**: Merge results from MemTable and all SSTables using a heap-based merge iterator. For each key, keep only the entry with the highest sequence number (within the visible range for snapshot reads). Apply range tombstone filtering: exclude keys covered by range tombstones with higher sequence numbers. Apply --prefix, --limit, --reverse flags. Results in strict lexicographic order (or reverse if --reverse).

### Compaction

Level-based compaction (same as basic LSM):
- L0: direct MemTable flushes, may overlap. Compact when 4+ L0 SSTables.
- L0 compaction: merge all L0 with overlapping L1, target ~64KB per new L1 SSTable.
- L1+: non-overlapping key ranges. Compact when level exceeds 10^L MB.
- Range tombstones: during compaction, range tombstones must be preserved until it's certain they don't shadow any entries in deeper levels. A range tombstone can only be dropped during deepest-level compaction when no deeper level has keys in its range.
- MVCC: entries visible to open snapshots must not be garbage collected (see MVCC rules above).
- `COMPACT` forces full compaction regardless of thresholds.

### Crash Recovery

On startup:
1. Delete `.tmp` SSTable files.
2. Load all `.sst` files, parse footers and indexes.
3. Replay WAL to reconstruct MemTable.
4. Rebuild snapshot/transaction state is lost on crash (snapshots and transactions are memory-only; clients must re-create them after restart).

## Correctness Requirements

- All operations must be linearizable when accessed sequentially.
- After graceful shutdown (EOF), all committed data is recoverable on restart.
- SCAN produces strict lexicographic order (or reverse), no duplicates, no tombstoned entries.
- Snapshot isolation: concurrent snapshots see consistent point-in-time views.
- Transaction conflict detection: if two transactions write the same key and both try to commit, exactly one succeeds.
- Write batches and transaction commits are atomic: either all mutations are visible or none.
- Range tombstones correctly shadow all point entries in their range with lower sequence numbers.
- Bloom filter empirical false positive rate below 5% for 1000+ keys.
- Compaction never loses live data and respects MVCC visibility.

Set up the project with `go.mod` at `/app/go.mod` using module path `kvstore`. Use only Go standard library packages.
