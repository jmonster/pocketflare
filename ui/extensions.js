// PocketBase loads this module before initializing its admin router.
app.routes.superuserOnly("#/settings/backups", async (route) => {
    const { pageBackupsSettings } = await import("./pageBackupsSettings.js");
    return pageBackupsSettings(route);
});
app.routes.superuserOnly("#/settings/storage", async () => {
    const { pageStorageSettings } = await import("./pageStorageSettings.js");
    return pageStorageSettings();
});
