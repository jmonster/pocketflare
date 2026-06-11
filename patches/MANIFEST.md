# Pocketflare Patch Manifest

| Patch file | Bytes | Category | Upstream? |
|---|---:|---|---|
| `000-base-wasm-stubs.patch` | 1358 | behavioral-platform | No |
| `001-bootstrap-wasm.patch` | 3230 | behavioral-platform | No |
| `002-filesystem-wasm.patch` | 3129 | behavioral-platform | No |
| `003-nil-body-fix.patch` | 1534 | behavioral-upstream | Yes |
| `004-filesystem-newblob.patch` | 3476 | behavioral-upstream | Yes |
| `005-cron-rundue.patch` | 1084 | behavioral-upstream | Yes |
| `006-realtime-wasm.patch` | 1353 | behavioral-platform | No |
| `007-defaultclient-setid.patch` | 737 | behavioral-upstream | Yes |
| `008a-accent-color.patch` | 431 | admin-ui | No |
| `008b-pocketflare-branding-ui.patch` | 5605 | admin-ui | No |
| `009-idempotent-migrations.patch` | 3624 | behavioral-d1 | Partial |
| `010-d1-transaction-compat.patch` | 16020 | behavioral-d1 | No |
| `011-do-sqlite-transaction-hook.patch` | 2701 | behavioral-platform | No |
| `012-d1-migrations-without-outer-tx.patch` | 4868 | behavioral-d1 | No |
| `013-active-restore-bootstrap.patch` | 2498 | behavioral-platform | No |
| `015-restore-feature.patch` | 483004 | admin-ui | No |
| `016-storage-settings.patch` | 8696 | admin-ui | No |
| `017-d1-parity-fixes.patch` | 33995 | behavioral-d1 | No |

## Categories

- **admin-ui**: Cosmetic or UI-only changes, including branding, restore page, and storage settings. No behavioral impact on PocketBase core.
- **behavioral-platform**: WASM or Cloudflare Workers platform adaptations. Pocketflare-specific, not upstreamable.
- **behavioral-d1**: D1 batch-transaction workarounds. Tied to Cloudflare D1's transaction model.
- **behavioral-upstream**: Bug fixes or generally useful extensions that could be proposed to upstream PocketBase.
