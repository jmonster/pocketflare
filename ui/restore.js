import { getUserSchemaObjects } from "../lib/restore-schema.mjs";
// Pocketflare restore page — imports a PocketBase backup zip into a
// fresh Pocketflare target. Uses JSZip + sql.js, loaded only
// on this page via dynamic import through dynamic imports.

const D1_MAX_BOUND_PARAMS = 100;
const FILE_UPLOAD_CONCURRENCY = 3;

function detectMime(e) {
    var n = (e || "").split(".").pop()?.toLowerCase();
    return {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        pdf: "application/pdf",
        json: "application/json",
        html: "text/html",
        css: "text/css",
        js: "text/javascript",
    }[n] || "application/octet-stream";
}

export function pocketflareRestorePage() {
    const data = store({
        phase: "idle",
        dbMode: "",
        blockingReasons: [],
        activeRestore: null,
        progress: { done: 0, total: 0 },
        error: null,
        cancelError: null,
        sessionId: null,
        fileUploadToken: null,
        statusMsg: "",
        uploadedFiles: 0,
        totalFiles: 0,
    });

    function restoreHeaders() {
        return data.fileUploadToken
            ? { "Content-Type": "application/json", "X-Pocketflare-Restore-Token": data.fileUploadToken }
            : { "Content-Type": "application/json" };
    }

    checkStatus();

    async function checkStatus() {
        data.phase = "checking";
        try {
            const resp = await app.pb.send("/api/pocketflare/restore/status", { method: "GET" });
            data.dbMode = resp.dbMode;
            if (resp.activeRestore) {
                data.activeRestore = resp.activeRestore;
                data.fileUploadToken = resp.activeRestore.fileUploadToken;
                data.sessionId = resp.activeRestore.sessionId;
                data.phase = "resume";
                return;
            }
            if (resp.empty) {
                data.phase = "ready";
            } else {
                data.blockingReasons = resp.blockingReasons;
                data.phase = "blocked";
            }
        } catch (err) {
            if (!err.isAbort) {
                const t = sessionStorage.getItem("pocketflareRestoreToken");
                if (t) {
                    try {
                        const resp = await fetch(app.pb.buildURL("/api/pocketflare/restore/session"), {
                            headers: { "X-Pocketflare-Restore-Token": t },
                        });
                        if (resp.ok) {
                            const body = await resp.json();
                            data.activeRestore = {
                                sessionId: body.sessionId,
                                phase: body.phase,
                                startedAt: body.startedAt,
                                dbProgress: body.dbProgress,
                                fileProgress: body.fileProgress,
                                fileUploadToken: body.fileUploadToken,
                            };
                            data.fileUploadToken = body.fileUploadToken;
                            data.sessionId = body.sessionId;
                            data.phase = "resume";
                            return;
                        }
                    } catch (_) { /* fall through to error */ }
                }
                data.error = err.response?.message || err.message || "Failed to check restore status";
                data.phase = "error";
            }
        }
    }

    async function handleFile(file) {
        if (!file || !file.name.endsWith(".zip")) {
            data.error = "Please select a .zip backup file.";
            data.phase = "error";
            return;
        }

        data.phase = "reading";
        data.statusMsg = "Reading backup zip...";

        let zip, sqlJS;
        try {
            const [JSZip, sqljsModule] = await Promise.all([import("jszip"), import("sql.js")]);
            zip = await JSZip.default.loadAsync(file);
            sqlJS = await sqljsModule.default({
                locateFile: (f) => app.pb.buildURL("/_/assets/" + f),
            });
        } catch (err) {
            data.error = "Failed to read backup zip: " + (err.message || err);
            data.phase = "error";
            return;
        }

        const dataDbEntry = zip.file("data.db");
        if (!dataDbEntry) {
            data.error = "Backup zip does not contain data.db — not a valid PocketBase backup.";
            data.phase = "error";
            return;
        }

        const auxDbEntry = zip.file("auxiliary.db");
        const storageEntries = zip.file(/^storage\//);

        data.statusMsg = "Starting restore session...";
        let sessionId, fileUploadToken;
        try {
            const resp = await app.pb.send("/api/pocketflare/restore/start", {
                method: "POST",
                body: JSON.stringify({}),
                headers: { "Content-Type": "application/json" },
            });
            sessionId = resp.sessionId;
            fileUploadToken = resp.fileUploadToken;
            data.sessionId = sessionId;
            data.fileUploadToken = fileUploadToken;
            sessionStorage.setItem("pocketflareRestoreToken", fileUploadToken);
            sessionStorage.setItem("pocketflareRestoreSessionId", sessionId);
        } catch (err) {
            if (!err.isAbort) {
                const info = err.response || {};
                if (err.status === 409 && info.blockingReasons) {
                    data.blockingReasons = info.blockingReasons;
                    data.phase = "blocked";
                } else {
                    data.error = info.message || err.message || "Failed to start restore";
                    data.phase = "error";
                }
            }
            return;
        }

        data.statusMsg = "Preparing database import...";
        try {
            await importDatabase(sqlJS, dataDbEntry, auxDbEntry, sessionId, (msg, done, total) => {
                data.statusMsg = msg;
                if (total > 0) {
                    data.progress = { done, total };
                    data.phase = "importing";
                }
            });
        } catch (err) {
            data.error = "Database import failed: " + (err.message || err);
            data.phase = "error";
            return;
        }

        // Transition phase: database → files so the Worker JS file route accepts uploads.
        try {
            await app.pb.send("/api/pocketflare/restore/phase", {
                method: "POST",
                body: JSON.stringify({ sessionId, phase: "files" }),
                headers: restoreHeaders(),
            });
        } catch (err) {
            if (!err.isAbort) {
                data.error = "Failed to transition to files phase: " + (err.response?.message || err.message || "");
                data.phase = "error";
                return;
            }
        }

        if (storageEntries.length > 0) {
            data.phase = "uploading";
            data.totalFiles = storageEntries.length;
            data.uploadedFiles = 0;
            try {
                await uploadStorageFiles(storageEntries, fileUploadToken, (done, total) => {
                    data.uploadedFiles = done;
                    data.totalFiles = total;
                });
            } catch (err) {
                data.error = "File upload failed: " + (err.message || err);
                data.phase = "error";
                return;
            }
        }

        data.phase = "finalizing";
        data.statusMsg = "Finalizing restore...";
        try {
            await app.pb.send("/api/pocketflare/restore/finalize", {
                method: "POST",
                body: JSON.stringify({ sessionId }),
                headers: restoreHeaders(),
            });
        } catch (err) {
            if (!err.isAbort) {
                data.error = "Finalize failed: " + (err.response?.message || err.message || "");
                data.phase = "error";
                return;
            }
        }

        data.phase = "complete";
        data.statusMsg = "Restore complete. You may need to log in with restored superuser credentials.";
        sessionStorage.removeItem("pocketflareRestoreToken");
        sessionStorage.removeItem("pocketflareRestoreSessionId");
    }

    async function resumeRestore(file) {
        if (!file || !file.name.endsWith(".zip")) {
            data.error = "Please select a .zip backup file.";
            data.phase = "error";
            return;
        }
        data.phase = "reading";
        data.statusMsg = "Reading backup zip for resume...";
        let zip, sqlJS;
        try {
            const [JSZip, sqljsModule] = await Promise.all([import("jszip"), import("sql.js")]);
            zip = await JSZip.default.loadAsync(file);
            sqlJS = await sqljsModule.default({
                locateFile: (f) => app.pb.buildURL("/_/assets/" + f),
            });
        } catch (err) {
            data.error = "Failed to read backup zip: " + (err.message || err);
            data.phase = "error";
            return;
        }
        const dataDbEntry = zip.file("data.db");
        if (!dataDbEntry) {
            data.error = "Backup zip does not contain data.db.";
            data.phase = "error";
            return;
        }
        const auxDbEntry = zip.file("auxiliary.db");
        const storageEntries = zip.file(/^storage\//);
        const sid = data.sessionId || data.activeRestore?.sessionId || "";
        const phase = data.activeRestore?.phase || "db";
        if (phase !== "files") {
            data.statusMsg = "Resuming database import...";
            try {
                await importDatabase(sqlJS, dataDbEntry, auxDbEntry, sid, (msg, done, total) => {
                    data.statusMsg = msg;
                    if (total > 0) {
                        data.progress = { done, total };
                        data.phase = "importing";
                    }
                });
            } catch (err) {
                data.error = "Database import failed: " + (err.message || err);
                data.phase = "error";
                return;
            }
            try {
                await app.pb.send("/api/pocketflare/restore/phase", {
                    method: "POST",
                    body: JSON.stringify({ sessionId: sid, phase: "files" }),
                    headers: restoreHeaders(),
                });
            } catch (err) {
                if (!err.isAbort) {
                    data.error = "Failed to transition to files phase: " + (err.response?.message || err.message || "");
                    data.phase = "error";
                    return;
                }
            }
        }
        if (storageEntries.length > 0) {
            data.phase = "uploading";
            data.totalFiles = storageEntries.length;
            data.uploadedFiles = 0;
            try {
                await uploadStorageFiles(storageEntries, data.fileUploadToken, (done, total) => {
                    data.uploadedFiles = done;
                    data.totalFiles = total;
                });
            } catch (err) {
                data.error = "File upload failed: " + (err.message || err);
                data.phase = "error";
                return;
            }
        }
        data.phase = "finalizing";
        data.statusMsg = "Finalizing restore...";
        try {
            await app.pb.send("/api/pocketflare/restore/finalize", {
                method: "POST",
                body: JSON.stringify({ sessionId: sid }),
                headers: restoreHeaders(),
            });
        } catch (err) {
            if (!err.isAbort) {
                data.error = "Finalize failed: " + (err.response?.message || err.message || "");
                data.phase = "error";
                return;
            }
        }
        data.phase = "complete";
        data.statusMsg = "Restore complete. You may need to log in with restored superuser credentials.";
        sessionStorage.removeItem("pocketflareRestoreToken");
        sessionStorage.removeItem("pocketflareRestoreSessionId");
    }

    async function startOver() {
        data.cancelError = null;
        try {
            const sid = data.sessionId || data.activeRestore?.sessionId || "";
            const tok = data.fileUploadToken || sessionStorage.getItem("pocketflareRestoreToken") || "";
            await app.pb.send("/api/pocketflare/restore/cancel", {
                method: "POST",
                body: JSON.stringify({ sessionId: sid }),
                headers: tok
                    ? { "X-Pocketflare-Restore-Token": tok, "Content-Type": "application/json" }
                    : { "Content-Type": "application/json" },
            });
        } catch (err) {
            if (!err.isAbort) {
                data.cancelError =
                    "Restore cannot be canceled after database import has started. Continue the restore, or start with a fresh Pocketflare target.";
            }
            return;
        }
        data.activeRestore = null;
        data.sessionId = null;
        data.fileUploadToken = null;
        data.progress = { done: 0, total: 0 };
        data.statusMsg = "";
        data.error = null;
        sessionStorage.removeItem("pocketflareRestoreToken");
        sessionStorage.removeItem("pocketflareRestoreSessionId");
        await checkStatus();
    }

    async function importDatabase(sqlJS, dataDbEntry, auxDbEntry, sessionId, onProgress) {
        const dataBuf = await dataDbEntry.async("arraybuffer");
        const dataDB = new sqlJS.Database(new Uint8Array(dataBuf));
        let auxDB = null;
        if (auxDbEntry) {
            const auxBuf = await auxDbEntry.async("arraybuffer");
            auxDB = new sqlJS.Database(new Uint8Array(auxBuf));
        }
        try {
            const appTables = getTablesFromDB(dataDB);
            const auxTables = auxDB ? getTablesFromDB(auxDB) : [];
            const allTables = [
                ...appTables.filter((t) => t.name !== "_logs"),
                ...auxTables.filter((t) => t.name !== "_logs"),
            ];
            const sysTables = allTables.filter((t) => t.name.startsWith("_"));
            const userTables = allTables.filter((t) => !t.name.startsWith("_"));

            let totalBatches = 0, doneBatches = 0;
            for (const table of allTables) {
                const cols = getTableColumns(dataDB, auxDB, table.name);
                if (cols.length === 0) continue;
                const dbInstance = tableDB(dataDB, auxDB, table.name);
                const rowCount = dbInstance.exec("SELECT COUNT(*) as c FROM [" + table.name + "]")[0]?.values?.[0]?.[0]
                    || 0;
                if (rowCount > 0) {
                    totalBatches += Math.ceil(rowCount / Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / cols.length)));
                }
                totalBatches += 1;
            }
            onProgress("Importing database...", 0, totalBatches);

            for (const table of sysTables) {
                const dbTarget = tableDBName(dataDB, auxDB, table.name);
                await sendDatabaseBatch(sessionId, dbTarget, [{ sql: "DELETE FROM [" + table.name + "]", params: [] }]);
                doneBatches++;
                onProgress("Clearing " + table.name + "...", doneBatches, totalBatches);
            }

            for (const table of userTables) {
                const createSQL = getCreateTableSQL(dataDB, auxDB, table.name);
                if (!createSQL) continue;
                const dbTarget = tableDBName(dataDB, auxDB, table.name);
                await sendDatabaseBatch(sessionId, dbTarget, [
                    { sql: "DROP TABLE IF EXISTS [" + table.name + "]", params: [] },
                    { sql: createSQL.trim(), params: [] },
                ]);
                doneBatches++;
                onProgress("Creating " + table.name + "...", doneBatches, totalBatches);
            }

            for (const table of allTables) {
                const cols = getTableColumns(dataDB, auxDB, table.name);
                if (cols.length === 0) continue;
                const dbInstance = tableDB(dataDB, auxDB, table.name);
                const rows = dbInstance.exec("SELECT * FROM [" + table.name + "]");
                if (rows.length === 0) continue;
                const values = rows[0].values;
                const rowsPerBatch = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / cols.length));
                const dbTarget = tableDBName(dataDB, auxDB, table.name);
                const colList = cols.map((c) => "\"" + c + "\"").join(", ");
                const placeholder = "(" + cols.map(() => "?").join(", ") + ")";
                const insertVerb = table.name.startsWith("_") ? "INSERT OR REPLACE INTO" : "INSERT INTO";
                for (let i = 0; i < values.length; i += rowsPerBatch) {
                    const chunk = values.slice(i, i + rowsPerBatch);
                    const placeholders = chunk.map(() => placeholder).join(", ");
                    const sql = insertVerb + " [" + table.name + "] (" + colList + ") VALUES " + placeholders;
                    const params = chunk.flat().map((v) => v instanceof Uint8Array ? Array.from(v) : v);
                    await sendDatabaseBatch(sessionId, dbTarget, [{ sql, params }]);
                    doneBatches++;
                    onProgress("Importing " + table.name + "...", doneBatches, totalBatches);
                }
            }

            const schemaObjects = getUserSchemaObjects(dataDB, auxDB);
            for (const dbTarget of ["app", "aux"]) {
                const objects = schemaObjects.filter((o) => o.db === dbTarget);
                if (!objects.length) continue;
                totalBatches += 1;
                await sendDatabaseBatch(sessionId, dbTarget, objects.map((o) => ({ sql: o.sql, params: [] })));
                doneBatches++;
                onProgress("Creating indexes and views...", doneBatches, totalBatches);
            }

            onProgress("Database import complete.", doneBatches, totalBatches);
        } finally {
            dataDB.close();
            if (auxDB) auxDB.close();
        }
    }

    function getTablesFromDB(db) {
        const result = db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        if (result.length === 0) return [];
        return result[0].values.map((row) => ({ name: row[0] }));
    }

    function getTableColumns(dataDB, auxDB, tableName) {
        const db = tableDB(dataDB, auxDB, tableName);
        const result = db.exec("PRAGMA table_info(\"" + tableName + "\")");
        if (result.length === 0) return [];
        return result[0].values.map((row) => row[1]);
    }

    function getCreateTableSQL(dataDB, auxDB, tableName) {
        const db = tableDB(dataDB, auxDB, tableName);
        const result = db.exec(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='" + tableName + "' AND sql IS NOT NULL",
        );
        if (result.length === 0 || result[0].values.length === 0) return null;
        const sql = result[0].values[0][0];
        if (typeof sql !== "string" || sql.includes("sqlite_sequence")) return null;
        return sql;
    }

    function tableDB(dataDB, auxDB, tableName) {
        try {
            dataDB.exec("SELECT 1 FROM [" + tableName + "] LIMIT 0");
            return dataDB;
        } catch (_) {
            return auxDB || dataDB;
        }
    }

    function tableDBName(dataDB, auxDB, tableName) {
        try {
            dataDB.exec("SELECT 1 FROM [" + tableName + "] LIMIT 0");
            return "app";
        } catch (_) {
            return auxDB && auxDB !== dataDB ? "logs" : "app";
        }
    }

    async function sendDatabaseBatch(sessionId, db, statements) {
        const resp = await app.pb.send("/api/pocketflare/restore/database", {
            method: "POST",
            body: JSON.stringify({ sessionId, db, statements }),
            headers: restoreHeaders(),
        });
        if (!resp.ok) throw new Error("Database batch failed");
        return resp;
    }

    async function uploadStorageFiles(entries, fileUploadToken, onProgress) {
        let done = 0;
        const total = entries.length;
        const pending = [...entries];
        async function uploadOne(entry) {
            const blob = await entry.async("blob");
            const headers = { "X-Pocketflare-File-Key": entry.name, "X-Pocketflare-Restore-Token": fileUploadToken };
            headers["X-Pocketflare-File-Content-Type"] = detectMime(entry.name) || blob.type
                || "application/octet-stream";
            const resp = await fetch("/api/pocketflare/restore/files", { method: "PUT", headers, body: blob });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error("Upload failed for " + entry.name + ": " + (err.error || resp.statusText));
            }
            done++;
            onProgress(done, total);
        }
        const workers = [];
        for (let i = 0; i < Math.min(FILE_UPLOAD_CONCURRENCY, total); i++) {
            workers.push((async () => {
                while (pending.length > 0) await uploadOne(pending.shift());
            })());
        }
        await Promise.all(workers);
    }

    return {
        data,
        handleFile,
        checkStatus,
        resumeRestore,
        startOver,
        render: function() {
            return t.div(
                { className: "block" },
                t.div({ className: "txt-lg m-b-base" }, t.p(null, "Restore from PocketBase backup")),
                t.div(
                    { className: "alert alert-info m-b-base" },
                    t.p(
                        null,
                        "Restore imports into an empty Pocketflare app and replaces all data. You may be signed out and should log in with the restored superuser credentials.",
                    ),
                    t.p(
                        { className: "m-t-sm" },
                        "Existing S3-backed PocketBase files are not included in backup zips — copy those from the source S3 bucket into Pocketflare's R2 ",
                        t.code(null, "STORAGE"),
                        " bucket separately.",
                    ),
                ),
                () =>
                    data.phase === "blocked"
                        ? t.div(
                            { className: "alert danger" },
                            t.p({ className: "txt-bold" }, "Target is not empty"),
                            t.p(
                                null,
                                "This restore target already contains data. Create a fresh Pocketflare deployment or clear existing data outside Pocketflare, then retry.",
                            ),
                            t.ul(null, ...data.blockingReasons.map((r) => t.li(null, r))),
                            t.button({
                                type: "button",
                                className: "btn secondary m-t-sm",
                                onclick: () => checkStatus(),
                                textContent: "Check again",
                            }),
                        )
                        : null,
                () =>
                    data.phase === "checking"
                        ? t.div(
                            { className: "txt-center m-v-lg" },
                            t.span({ className: "loader lg" }),
                            t.p({ className: "m-t-sm" }, "Checking target status..."),
                        )
                        : null,
                () =>
                    data.phase === "ready"
                        ? t.div(
                            null,
                            t.p(
                                { className: "m-b-sm" },
                                "Target is empty and ready for restore. Select a PocketBase backup zip file.",
                            ),
                            t.input({
                                type: "file",
                                accept: ".zip",
                                className: "m-b-sm",
                                onchange: (e) => {
                                    const f = e.target?.files?.[0];
                                    if (f) handleFile(f);
                                },
                            }),
                        )
                        : null,
                () =>
                    ["reading", "importing", "uploading", "finalizing"].includes(data.phase)
                        ? t.div(
                            { className: "m-v-lg" },
                            t.div(
                                { className: "flex gap-10 items-center m-b-sm" },
                                t.span({ className: "loader" }),
                                t.span(null, data.statusMsg || ""),
                            ),
                            () =>
                                data.progress.total > 0
                                    ? t.div(
                                        { className: "progress m-b-sm" },
                                        t.div({
                                            className: "progress-bar",
                                            style: "width: "
                                                + Math.round((data.progress.done / data.progress.total) * 100) + "%",
                                        }),
                                    )
                                    : null,
                            () =>
                                data.phase === "uploading"
                                    ? t.p(
                                        { className: "txt-sm txt-hint" },
                                        "Files uploaded: " + data.uploadedFiles + " / " + data.totalFiles,
                                    )
                                    : null,
                        )
                        : null,
                () =>
                    data.phase === "complete"
                        ? t.div(
                            { className: "alert success m-t-base" },
                            t.p({ className: "txt-bold" }, "Restore complete"),
                            t.p(
                                null,
                                "All data has been imported. You may need to log in with the restored superuser credentials.",
                            ),
                            t.p(
                                { className: "m-t-sm txt-sm txt-hint" },
                                "Navigate to another page and back, or refresh to see imported collections.",
                            ),
                        )
                        : null,
                () =>
                    data.phase === "error"
                        ? t.div(
                            { className: "alert danger m-t-base" },
                            t.p({ className: "txt-bold" }, "Restore failed"),
                            t.p(null, data.error || "Unknown error"),
                            t.button({
                                type: "button",
                                className: "btn secondary m-t-sm",
                                onclick: () => checkStatus(),
                                textContent: "Try again",
                            }),
                        )
                        : null,
                () =>
                    data.phase === "resume"
                        ? t.div(
                            { "html-data-test": "restore-active-session" },
                            t.p({ className: "m-b-sm txt-bold" }, "Active restore session detected"),
                            t.p(
                                { className: "m-b-sm" },
                                "Session: " + (data.activeRestore?.sessionId || data.sessionId || ""),
                            ),
                            t.p(
                                { className: "m-b-sm" },
                                "Phase: " + (data.activeRestore?.phase || ""),
                            ),
                            t.p(
                                { className: "m-b-sm" },
                                "Started: " + (data.activeRestore?.startedAt || ""),
                            ),
                            () =>
                                data.cancelError
                                    ? t.div(
                                        { "html-data-test": "restore-cancel-error", className: "alert danger m-b-sm" },
                                        t.p(null, data.cancelError),
                                    )
                                    : null,
                            t.input({
                                type: "file",
                                accept: ".zip",
                                className: "m-b-sm",
                                onchange: (e) => {
                                    const f = e.target?.files?.[0];
                                    if (f) resumeRestore(f);
                                },
                            }),
                            t.button({
                                type: "button",
                                "html-data-test": "restore-start-over",
                                className: "btn secondary m-t-sm",
                                onclick: () => startOver(),
                                textContent: "Start Over",
                            }),
                        )
                        : null,
            );
        },
    };
}
