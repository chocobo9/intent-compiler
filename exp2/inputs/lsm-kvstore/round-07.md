Two things this round.

First, rotate the WAL into segments. Instead of a single WAL file, use numbered segment files: `wal_000001.log`, `wal_000002.log`, etc. in the data directory. Start a new segment when the current one reaches or exceeds 64KB. On memtable flush, delete all WAL segments whose highest seqnum is <= the flushed seqnum — don't truncate the active segment. On startup, replay all segment files in numerical order, applying the same CRC rules per segment — a corrupted entry stops replay of that segment and all later segments are skipped entirely.

Second, there's a cursor bug. If you open a cursor with no flags, seek to a key that exists, then immediately call CURSOR_PREV, you get back the same key you just seeked to instead of the key before it. For example: PUT a, b, c, d, then open a cursor, CURSOR_SEEK to `c` returns `c	<value>`, then CURSOR_PREV should return `b	<value>` but it returns `c	<value>` again. Fix that.
