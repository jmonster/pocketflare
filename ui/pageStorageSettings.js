import { settingsSidebar } from "./settingsSidebar.js";

export function pageStorageSettings() {
    app.store.title = "File storage";

    return t.div(
        {
            pbEvent: "pageStorageSettings",
            className: "page page-storage-settings",
        },
        settingsSidebar(),
        t.div(
            { className: "page-content full-height" },
            t.header(
                { className: "page-header" },
                t.nav(
                    { className: "breadcrumbs" },
                    t.div({ className: "breadcrumb-item" }, "Settings"),
                    t.div({ className: "breadcrumb-item" }, () => app.store.title),
                ),
            ),
            t.div(
                { className: "wrapper m-b-base" },
                t.div(
                    { className: "block" },
                    t.div(
                        { className: "txt-lg m-b-base" },
                        t.p(null, "Pocketflare stores uploaded files in Cloudflare R2."),
                    ),
                    t.div(
                        { className: "alert alert-info" },
                        t.div(
                            null,
                            t.p(
                                null,
                                "The upstream PocketBase S3 storage setting is not available in Pocketflare. File fields use the Worker ",
                                t.code(null, "STORAGE"),
                                " R2 binding directly, so no PocketBase S3 credentials are needed here.",
                            ),
                            t.p(
                                null,
                                "Existing PocketBase local or S3 files should be migrated into the configured R2 bucket under the standard ",
                                t.code(null, "storage/"),
                                " prefix.",
                            ),
                        ),
                    ),
                ),
            ),
            t.footer({ className: "page-footer" }, app.components.credits()),
        ),
    );
}
