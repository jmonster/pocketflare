import { settingsSidebar } from "./settingsSidebar.js";
import { pocketflareRestorePage } from "./restore.js";

export function pageBackupsSettings(route) {
    app.store.title = "Backups";

    const restore = pocketflareRestorePage();

    return t.div(
        { pbEvent: "pageBackupsSettings", className: "page page-backups-settings" },
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
                restore.render(),
            ),
            t.footer({ className: "page-footer" }, app.components.credits()),
        ),
    );
}
