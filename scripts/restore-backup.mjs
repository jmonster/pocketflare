#!/usr/bin/env node

// restore-backup.mjs — Restore a PocketBase backup zip into a Pocketflare target.
//
// Recommended for large backups. Uses the same restore API as the admin UI.
//
// Usage:
//   node scripts/restore-backup.mjs <worker-url> <backup.zip> --token <superuser-token>
//
// The script uses JSZip and sql.js from the admin UI build dependencies.
// Install them first:
//   cd internal/pocketbase/ui && pnpm install
//
// Progress is printed to stderr; final result is printed to stdout as JSON.
// Exits 0 on success, non-zero on any failure.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_NODE_MODULES = resolve(__dirname, "../internal/pocketbase/ui/node_modules");

const D1_MAX_BOUND_PARAMS = 100;
const FILE_UPLOAD_CONCURRENCY = 3;

function usage() {
  console.error("Usage: node scripts/restore-backup.mjs <worker-url> <backup.zip> --token <superuser-token>");
  console.error("       node scripts/restore-backup.mjs <worker-url> <backup.zip> --email <email> --password <password>");
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);

  let workerURL, zipPath, token, email, password;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--token": token = args[++i]; break;
      case "--email": email = args[++i]; break;
      case "--password": password = args[++i]; break;
      case "-h": case "--help": usage(); break;
      default:
        if (!workerURL) workerURL = args[i];
        else if (!zipPath) zipPath = args[i];
    }
  }

  if (!workerURL || !zipPath) usage();
  if (!token && (!email || !password)) {
    console.error("Error: provide --token or --email/--password for authentication.");
    usage();
  }

  workerURL = workerURL.replace(/\/+$/, "");

  if (!existsSync(zipPath)) {
    console.error("Error: backup zip not found:", zipPath);
    process.exit(1);
  }

  // Resolve JSZip and sql.js from the admin UI build dependencies.
  let JSZip, initSqlJs;
  try {
    JSZip = (await import(resolve(UI_NODE_MODULES, "jszip/dist/jszip.min.js"))).default;
    initSqlJs = (await import(resolve(UI_NODE_MODULES, "sql.js/dist/sql-wasm.js"))).default;
  } catch {
    console.error("Error: JSZip or sql.js not found. Install admin UI dependencies:");
    console.error("  cd internal/pocketbase/ui && pnpm install");
    process.exit(1);
  }

  if (!token) {
    token = await authenticate(workerURL, email, password);
  }

  const api = makeAPI(workerURL, token);

  // ── Phase 1: Check status ──
  log("Checking target status...");
  const status = await api.get("/api/pocketflare/restore/status");

  if (!status.empty) {
    log("ERROR: Target is not empty.");
    for (const reason of status.blockingReasons) {
      log("  - " + reason);
    }
    process.exit(1);
  }

  if (status.activeRestore) {
    log("WARNING: Active restore session exists (phase: " + status.activeRestore.phase + ").");
  }

  log("Target is empty. DB mode: " + status.dbMode);

  // ── Phase 2: Read and validate backup zip before starting session ──
  log("Reading backup zip...");
  const zipData = readFileSync(zipPath);
  const zip = await JSZip.loadAsync(Buffer.from(zipData));

  const dataDbEntry = zip.file("data.db");
  if (!dataDbEntry) {
    log("ERROR: data.db not found in backup zip.");
    process.exit(1);
  }

  const auxDbEntry = zip.file("auxiliary.db");
  const storageEntries = zip.file(/^storage\//);

  // ── Phase 3: Start restore session (zip validated) ──
  log("Starting restore session...");
  const start = await api.post("/api/pocketflare/restore/start", {});
  const sessionId = start.sessionId;
  const fileUploadToken = start.fileUploadToken;

  // ── Phase 4: Import database ──
  const SQL = await initSqlJs();
  const dataBuf = await dataDbEntry.async("arraybuffer");
  const dataDB = new SQL.Database(new Uint8Array(dataBuf));

  let auxDB = null;
  if (auxDbEntry) {
    const auxBuf = await auxDbEntry.async("arraybuffer");
    auxDB = new SQL.Database(new Uint8Array(auxBuf));
  }

  log("Preparing database import...");

  try {
    await importDatabase(api, dataDB, auxDB, sessionId);
  } finally {
    dataDB.close();
    if (auxDB) auxDB.close();
  }

  // Transition phase: database → files so the Worker accepts uploads.
  log("Transitioning to files phase...");
  await api.post("/api/pocketflare/restore/phase", { sessionId, phase: "files" });

  // ── Phase 5: Upload files ──
  if (storageEntries.length > 0) {
    log(`Uploading ${storageEntries.length} storage files...`);
    let done = 0;
    const total = storageEntries.length;
    const pending = [...storageEntries];

    async function uploadOne(entry) {
      const blob = await entry.async("nodebuffer");
      const key = entry.name;
      await uploadFile(workerURL, fileUploadToken, key, blob);
      done++;
      if (done % 10 === 0 || done === total) {
        log(`  Files: ${done}/${total}`);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(FILE_UPLOAD_CONCURRENCY, total); i++) {
      workers.push((async () => {
        while (pending.length > 0) {
          await uploadOne(pending.shift());
        }
      })());
    }
    await Promise.all(workers);
    log("File upload complete.");
  }

  // ── Phase 6: Finalize ──
  log("Finalizing restore...");
  const finalize = await api.post("/api/pocketflare/restore/finalize", { sessionId });
  log("Restore complete.");
  if (finalize.note) {
    log("Note: " + finalize.note);
  }

  console.log(JSON.stringify({ ok: true, sessionId }));
  process.exit(0);
}

// ── Database import ──

async function importDatabase(api, dataDB, auxDB, sessionId) {
  // Collect tables, separated into system (names starting with _) and user.
  const appTables = getTablesFromDB(dataDB);
  const auxTables = auxDB ? getTablesFromDB(auxDB) : [];
  const allTables = [
    ...appTables.filter((t) => t.name !== "_logs"),
    ...auxTables.filter((t) => t.name !== "_logs"),
  ];
  const sysTables = allTables.filter((t) => t.name.startsWith("_"));
  const userTables = allTables.filter((t) => !t.name.startsWith("_"));

  // Phase A: delete existing rows from system tables.
  log("Clearing bootstrap data...");
  for (const table of sysTables) {
    const dbTarget = tableDBName(dataDB, auxDB, table.name);
    await api.post("/api/pocketflare/restore/database", {
      sessionId, db: dbTarget, statements: [{ sql: "DELETE FROM [" + table.name + "]", params: [] }],
    });
  }

  // Phase B: drop and recreate user tables.
  log("Creating user tables...");
  for (const table of userTables) {
    const createSQL = getCreateTableSQL(dataDB, auxDB, table.name);
    if (!createSQL) continue;
    const dbTarget = tableDBName(dataDB, auxDB, table.name);
    await api.post("/api/pocketflare/restore/database", {
      sessionId, db: dbTarget,
      statements: [
        { sql: "DROP TABLE IF EXISTS [" + table.name + "]", params: [] },
        { sql: createSQL.trim(), params: [] },
      ],
    });
  }

  // Phase C: import data into all tables.
  log("Importing data...");
  for (const table of allTables) {
    const dbInstance = tableDB(dataDB, auxDB, table.name);
    const cols = getTableColumns(dataDB, auxDB, table.name);
    if (cols.length === 0) continue;

    const rows = dbInstance.exec("SELECT * FROM [" + table.name + "]");
    if (rows.length === 0) continue;

    const values = rows[0].values;
    const rowsPerBatch = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMS / cols.length));
    const colList = cols.map((c) => '"' + c + '"').join(", ");
    const placeholder = "(" + cols.map(() => "?").join(", ") + ")";
    const insertVerb = table.name.startsWith("_") ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    for (let i = 0; i < values.length; i += rowsPerBatch) {
      const chunk = values.slice(i, i + rowsPerBatch);
      const placeholders = chunk.map(() => placeholder).join(", ");
      const sql = insertVerb + " [" + table.name + "] (" + colList + ") VALUES " + placeholders;
      const params = chunk.flat().map((v) => v instanceof Uint8Array ? Array.from(v) : v);

      await api.post("/api/pocketflare/restore/database", {
        sessionId, db: tableDBName(dataDB, auxDB, table.name), statements: [{ sql, params }],
      });
    }

    log("  Table " + table.name + ": " + values.length + " rows imported");
  }

  // Phase D: recreate indexes, views, and triggers for user tables.
  const schemaObjects = getUserSchemaObjects(dataDB, auxDB);
  if (schemaObjects.length > 0) {
    log("Creating indexes and views (" + schemaObjects.length + " objects)...");
    const dbTarget = tableDBName(dataDB, auxDB, schemaObjects[0].tableName || userTables[0]?.name || "_");
    await api.post("/api/pocketflare/restore/database", {
      sessionId, db: dbTarget,
      statements: schemaObjects.map((o) => ({ sql: o.sql, params: [] })),
    });
  }

  log("Database import complete.");
}

function getUserSchemaObjects(dataDB, auxDB) {
  const objects = [];
  for (const db of [dataDB, auxDB]) {
    if (!db) continue;
    const result = db.exec(
      "SELECT type, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('index','view','trigger') AND tbl_name NOT LIKE '_%' AND tbl_name NOT LIKE 'sqlite_%'",
    );
    if (result.length === 0) continue;
    for (const row of result[0].values) {
      const [type, tblName, sql] = row;
      if (!sql || typeof sql !== "string") continue;
      if (sql.includes("sqlite_autoindex")) continue;
      let ddl = sql.trim();
      if (type === "index" && !ddl.toUpperCase().includes("IF NOT EXISTS")) {
        ddl = ddl.replace(/CREATE INDEX/i, "CREATE INDEX IF NOT EXISTS");
      }
      objects.push({ type, tableName: tblName, sql: ddl });
    }
  }
  return objects;
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
  const result = db.exec('PRAGMA table_info("' + tableName + '")');
  if (result.length === 0) return [];
  return result[0].values.map((row) => row[1]);
}

function getCreateTableSQL(dataDB, auxDB, tableName) {
  const db = tableDB(dataDB, auxDB, tableName);
  const result = db.exec(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='" + tableName +
      "' AND sql IS NOT NULL",
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

// ── File upload ──

async function uploadFile(workerURL, fileUploadToken, key, data) {
  const resp = await fetch(`${workerURL}/api/pocketflare/restore/files`, {
    method: "PUT",
    headers: {
      "X-Pocketflare-File-Key": key,
      "X-Pocketflare-Restore-Token": fileUploadToken,
      "Content-Type": "application/octet-stream",
    },
    body: data,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`File upload failed for ${key}: ${err.error || resp.statusText}`);
  }
}

// ── API helpers ──

function makeAPI(baseURL, token) {
  async function request(method, path, body) {
    const opts = {
      method,
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(`${baseURL}${path}`, opts);

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(`${method} ${path}: ${resp.status} — ${data.error || data.message || resp.statusText}`);
    }

    return data;
  }

  return {
    get: (path) => request("GET", path),
    post: (path, body) => request("POST", path, body),
  };
}

// ── Authentication ──

async function authenticate(workerURL, email, password) {
  log("Authenticating as superuser...");
  const resp = await fetch(`${workerURL}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error("Authentication failed:", err.message || resp.statusText);
    process.exit(1);
  }
  const data = await resp.json();
  log("Authenticated as:", data.record?.email || email);
  return data.token;
}

// ── Logging ──

function log(...args) {
  console.error(...args);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
