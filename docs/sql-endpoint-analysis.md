# SQL Endpoint Wrapper Analysis

## What the patches change in `apis/sql.go`

Patches **010-d1-transaction-compat** and **017-d1-parity-fixes** modify `internal/pocketbase/apis/sql.go` with three changes:

1.  **Multi-statement splitter** -- `splitSQLStatements()` splits a SQL string on `;` delimiters while respecting string literals, blob literals, and comments (patch 017 upgrades from a naive `strings.Split` to a rune-based state machine).
2.  **Mixed read/write detection** -- After splitting, each statement is classified as read (`SELECT`, `PRAGMA`) or write (one of `knownWriteQueryPrefixes`). If a batch contains both, the handler returns an error early.
3.  **Statement-by-statement write loop** -- In the `isPossibleWriteQuery` path, the original single `db.NewQuery(query).Execute()` is replaced with a loop over individual statements, each executed separately inside the same `RunInTransaction` callback. Affected rows are summed.

These patches also touch many other core files (`core/collection_model.go`, `core/record_model.go`, `core/collection_query.go`, `core/collection_record_table_sync.go`, `core/collection_import.go`, `core/view.go`, `core/app.go`, `core/base.go`, `core/collection_validate.go`, `ui/src/settings/backups/pocketflareRestore.js`). Those changes are out of scope for this analysis, which focuses only on the SQL endpoint.

## Can the handler be wrapped via `pbRouter.Bind()` middleware?

**Technically yes, but poorly.**

The PocketBase router supports `Bind()` at any group level. A middleware on the root router could intercept `POST /api/sql`, read the request body, perform the multi-statement and mixed-read/write logic itself, short-circuit the original handler by writing a response directly, and return `nil`.

However, a wrapper would be forced to **completely reimplement** the SQL endpoint logic because:

- `runSQL` (the handler) -- unexported
- `executeQuery` (the core execution logic) -- unexported
- `splitSQLStatements` -- unexported
- `runSQLForm` (request body schema) -- unexported
- `runSQLResult` / `runSQLResultColumn` (response schema) -- unexported

A wrapped replacement would need to duplicate form validation, query classification, transaction management, read-row iteration, column-type detection, and result serialization. This duplication is fragile against upstream PocketBase changes to the SQL endpoint.

## What does the handler depend on (exported vs. unexported)?

The handler (`runSQL`) and all its auxiliary types live in the unexported namespace of the `apis` package:

| Symbol | Scope | Status |
|---|---|---|
| `bindSQLApi` | function | unexported |
| `runSQL` | function (handler) | unexported |
| `executeQuery` | function (core logic) | unexported |
| `splitSQLStatements` | function | unexported |
| `runSQLForm` | type | unexported |
| `runSQLResult` | type | unexported |
| `runSQLResultColumn` | type | unexported |
| `knownWriteQueryPrefixes` | variable | unexported |

The route registration itself is also sealed: `bindSQLApi(app, apiGroup)` is called inside the exported `apis.NewRouter(app)`, and the route is committed to the router tree before `NewRouter` returns. There is no public API to unbind or replace an already-registered route.

The only public types used are `core.App`, `core.RequestEvent`, `router.RouterGroup`, and `router.Route` -- these are the standard framework types common to all PocketBase routes.

## Recommendation: **Keep patches as-is**

| Approach | Tradeoffs |
|---|---|
| **Patch** | + Minimal, localized diff to `executeQuery`<br>+ No code duplication<br>+ Resilient to upstream changes (patch applies on the same `executeQuery` function)<br>+ Consistent with the rest of Pocketflare's approach |
| **Wrap** | - Must duplicate the entire SQL handler (request parsing, form validation, both execution paths, result serialization)<br>- Fragile: if PocketBase changes the form schema or response format, wrapper breaks silently<br>- Cannot reuse unexported types<br>- Adds maintenance surface for no benefit |
| **Partial** (wrap some, patch rest) | - No clean seam: the split/mixed-detect logic is interleaved with `executeQuery` control flow<br>- Splitting off the statement parser is possible but trivial (look at the function) and buys nothing if the loop-over-statements still needs a patch |

The patch approach is the right tradeoff. It is small, focused, and keeps the change inside the function where the behavior is implemented. No wrapper would be cleaner or more maintainable.

If future PocketBase versions make `executeQuery` exported or provide an extension hook for the SQL endpoint, revisit this analysis. Today, the unexported surface blocks wrapping without complete duplication.
