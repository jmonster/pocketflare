The logo lives here as the source for the post-build admin UI overlay.

After rebuilding and syncing `internal/pocketbase/ui/dist/` into `admin-ui/_/`, run:

```sh
make admin-ui-overlays
```

This copies `branding/logo.png` to `admin-ui/_/images/logo.png`.
