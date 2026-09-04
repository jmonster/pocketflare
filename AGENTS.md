# Pocketflare

## Command Authority

- Use `make dev`, `make proof`, `make deploy`, and the scripts under `scripts/` for their named operations.
- A fresh checkout requires `./scripts/update-pb.sh`. Durable PocketBase changes belong in the patch stack; never edit generated `internal/pocketbase/` as the lasting fix.

## Production Safety

- Wrangler v4 D1 and R2 commands that target production must include `--remote`. Without it, Wrangler operates on an unrelated local mirror.
- Production export, import, Time Travel, migration, and backup commands also require `--remote`. Confirm the exact target before any destructive restore or sync.
- PocketBase backup ZIPs are not complete Pocketflare backups: application SQLite state lives in D1 or Durable Objects and file fields live in R2. Use `docs/production-backups.md` only for backup or recovery work.

## Runtime Boundaries

- `worker.mjs` owns the Worker entry point. `APP_DB` and `LOGS_DB` are database bindings; `STORAGE` is PocketBase file storage; `BACKUPS` stores upstream backup artifacts.
- The R2 adapter implements PocketBase-managed file behavior, not a general POSIX filesystem. Preserve Worker-compatible constraints for custom code.
- `/_pf` owns first-superuser setup. Bootstrap credentials are temporary and must be removed after setup; never commit credentials.

## Verification

- Use the narrowest existing proof for the changed boundary. PocketBase upgrades, D1 imports, storage migrations, email, deploys, and recovery are separate operational tasks and do not run automatically.
