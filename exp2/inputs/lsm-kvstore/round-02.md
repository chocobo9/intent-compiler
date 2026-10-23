I need key expiration support. Add a `--ttl <seconds>` flag to `PUT` — when set, the key expires after that many seconds from the time of the write (use wall-clock time). Expired keys behave exactly like deleted keys: `GET` returns `NOT_FOUND`, `SCAN` excludes them, and compaction can GC them (respecting MVCC snapshot visibility — a snapshot taken before expiration still sees the key).

New command: `TTL <key>` — returns the remaining seconds until expiration (integer, rounded down), `-1` if the key has no TTL, or `NOT_FOUND` if the key doesn't exist.

`PUT` without `--ttl` on a key that previously had a TTL clears the TTL. `TX_PUT` and `BATCH PUT` also accept `--ttl <seconds>`.

`STATS` adds `expired_keys` (count of keys whose TTL has elapsed but haven't been GC'd yet). `total_keys` must exclude expired keys.

The TTL expiration timestamp must be persisted in the WAL and SSTables. For single WAL entries, add an `expire_at` field (uint64 LE, Unix timestamp in seconds, 0 = no expiration) immediately after `seqnum`. For batch WAL entries, each operation in the `ops` array becomes: `op` (uint8) + `expire_at` (uint64 LE) + `key_len` (uint32 LE) + `key` + `val_len` (uint32 LE) + `value`. SSTable data block entries add `expire_at` immediately after `seqnum`. The SSTable footer size does not change.
