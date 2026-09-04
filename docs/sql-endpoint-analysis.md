# SQL endpoint integration

PocketBase v0.40.2 keeps its SQL handler, request/response types, and query
execution helpers private to `apis`. Replacing the route would duplicate form
validation, transaction handling, row decoding, and response serialization.

`001-worker-runtime.patch` instead adds one optional `apis.PrepareSQLQuery`
hook. The D1 adapter installs `adapter/d1.PrepareSQLQuery`, which splits SQL
statements while preserving quotes, comments, and trigger bodies, classifies
CTE statements by their outer operation, and rejects mixed reads/writes before
queuing a write. The patched handler executes the returned write statements
inside its existing transaction callback. Native SQLite and DO SQLite leave
the hook unset and retain upstream SQL handling.

The parser belongs to `adapter/d1/sql.go` and has independent regression tests.
Only the hook and the small execution loop need upstream patches; changes to
the parser no longer require editing PocketBase internals.

## D1 limits

D1 transactions are deferred write batches. The SQL console cannot provide
interactive read-after-write behavior, and affected-row counts read inside the
transaction callback may be zero before the batch commits. These constraints
also apply to callers outside the console; see [D1 compatibility](D1-COMPATIBILITY.md).
