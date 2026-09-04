#!/usr/bin/env node
// generate-large-backup-zip.mjs — Generate a scale-proof backup fixture
// with PocketBase v0.39.0 schema: 1000+ records, multiple collections.
//
// Usage:   node tests/fixtures/generate-large-backup-zip.mjs
// Deps:    pnpm install

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESTORE_NODE_MODULES = resolve(__dirname, "../../node_modules");
const outPath = resolve(__dirname, "large-backup.zip");

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 23) + "Z";
}

async function main() {
  let JSZip, initSqlJs;
  try {
    JSZip = (await import(resolve(RESTORE_NODE_MODULES, "jszip/dist/jszip.min.js"))).default;
  } catch (e) {
    console.error("JSZip import failed. Install: pnpm install");
    process.exit(1);
  }
  try {
    initSqlJs = (await import(resolve(RESTORE_NODE_MODULES, "sql.js/dist/sql-wasm.js"))).default;
  } catch (e) {
    console.error("sql.js import failed. Install: pnpm install");
    process.exit(1);
  }

  const sqlWasmPath = resolve(RESTORE_NODE_MODULES, "sql.js/dist/sql-wasm.wasm");
  const SQL = await initSqlJs({ locateFile: () => sqlWasmPath });
  const db = new SQL.Database();
  const now = ts();
  const emptyArr = "[]";
  const emptyObj = "{}";
  const RECORD_COUNT = 1000;
  const authIndexes = (name, id) => JSON.stringify([
    `CREATE UNIQUE INDEX \`idx_tokenKey_${id}\` ON \`${name}\` (\`tokenKey\`)`,
    `CREATE UNIQUE INDEX \`idx_email_${id}\` ON \`${name}\` (\`email\`) WHERE \`email\` != ''`,
  ]);

  // Auth options captured from PocketBase v0.39.0 fresh bootstrap.
  const superusersOpts = JSON.stringify({
    authRule: "",
    manageRule: null,
    authAlert: { enabled: true, emailTemplate: { subject: "Login from a new location", body: "<p>Hello,</p>\n<p>We noticed a login to your {APP_NAME} account from a new location:</p>\n<p><em>{ALERT_INFO}</em></p>\n<p><strong>If this wasn't you, you should immediately change your {APP_NAME} account password to revoke access from all other locations.</strong></p>\n<p>If this was you, you may disregard this email.</p>\n<p>\n  Thanks,<br/>\n  {APP_NAME} team\n</p>" } },
    oauth2: { providers: null, mappedFields: { id: "", name: "", username: "", avatarURL: "" }, enabled: false },
    passwordAuth: { enabled: true, identityFields: ["email"] },
    mfa: { enabled: false, duration: 600, rule: "" },
    otp: { enabled: false, duration: 180, length: 8 },
    authToken: { secret: "test-superuser-auth-secret", duration: 1209600 },
    passwordResetToken: { secret: "test-superuser-pwreset-secret", duration: 1800 },
    emailChangeToken: { secret: "test-superuser-emailchange-secret", duration: 1800 },
    verificationToken: { secret: "test-superuser-verify-secret", duration: 259200 },
    fileToken: { secret: "test-superuser-file-secret", duration: 120 },
  });

  const usersOpts = JSON.stringify({
    authRule: "",
    manageRule: null,
    authAlert: { enabled: true },
    oauth2: { providers: null, mappedFields: { id: "", name: "name", username: "", avatarURL: "avatar" }, enabled: false },
    passwordAuth: { enabled: true, identityFields: ["email"] },
    mfa: { enabled: false, duration: 600, rule: "" },
    otp: { enabled: false, duration: 180, length: 8 },
    authToken: { secret: "test-user-auth-secret", duration: 604800 },
    passwordResetToken: { secret: "test-user-pwreset-secret", duration: 1800 },
    emailChangeToken: { secret: "test-user-emailchange-secret", duration: 1800 },
    verificationToken: { secret: "test-user-verify-secret", duration: 259200 },
    fileToken: { secret: "test-user-file-secret", duration: 120 },
  });

  const superusersFields = JSON.stringify([
    { id: "fid", name: "id", type: "text", system: true, required: true, primaryKey: true, pattern: "^[a-z0-9]+$" },
    { id: "fpwd", name: "password", type: "password", system: true, required: true, minLength: 10 },
    { id: "ftk", name: "tokenKey", type: "text", system: true, required: true, hidden: true },
    { id: "fe", name: "email", type: "email", system: true, required: true },
    { id: "fev", name: "emailVisibility", type: "bool", system: true },
    { id: "fv", name: "verified", type: "bool", system: true },
    { id: "fc", name: "created", type: "autodate", system: true, onCreate: true },
    { id: "fu", name: "updated", type: "autodate", system: true, onCreate: true, onUpdate: true },
  ]);

  const usersFields = JSON.stringify([
    { id: "fid", name: "id", type: "text", system: true, required: true, primaryKey: true, pattern: "^[a-z0-9]+$" },
    { id: "fpwd", name: "password", type: "password", system: true, required: true, minLength: 8 },
    { id: "ftk", name: "tokenKey", type: "text", system: true, required: true, hidden: true },
    { id: "fe", name: "email", type: "email", system: true, required: false },
    { id: "fev", name: "emailVisibility", type: "bool", system: true },
    { id: "fv", name: "verified", type: "bool", system: true },
    { id: "fn", name: "name", type: "text", max: 255 },
    { id: "fav", name: "avatar", type: "file", maxSize: 5242880, options: { maxSelect: 1, maxSize: 5242880, thumbs: ["50x50"] } },
    { id: "fc", name: "created", type: "autodate", onCreate: true },
    { id: "fu", name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ]);

  const scaleFields = JSON.stringify([
    { id: "fs_title", name: "title", type: "text", required: true },
    { id: "fs_count", name: "count", type: "number", required: false },
    { id: "fs_data", name: "data", type: "json", required: false },
  ]);

  // ── _collections ──
  db.run("CREATE TABLE _collections (id TEXT PRIMARY KEY NOT NULL, system INTEGER DEFAULT 0 NOT NULL, type TEXT DEFAULT 'base' NOT NULL, name TEXT UNIQUE NOT NULL, fields TEXT DEFAULT '[]' NOT NULL, indexes TEXT DEFAULT '[]' NOT NULL, listRule TEXT, viewRule TEXT, createRule TEXT, updateRule TEXT, deleteRule TEXT, options TEXT DEFAULT '{}' NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");

  const collections = [
    ["sys001", 1, "auth", "_superusers", superusersFields, authIndexes("_superusers", "sys001"), superusersOpts],
    ["sys002", 0, "auth", "users", usersFields, authIndexes("users", "sys002"), usersOpts],
    ["sys003", 1, "base", "_mfas", emptyArr, emptyArr, emptyObj],
    ["sys004", 1, "base", "_otps", emptyArr, emptyArr, emptyObj],
    ["sys005", 1, "base", "_authOrigins", emptyArr, emptyArr, emptyObj],
    ["sys006", 1, "base", "_externalAuths", emptyArr, emptyArr, emptyObj],
    ["sc001", 0, "base", "scale_items", scaleFields, emptyArr, emptyObj],
  ];

  const insColl = db.prepare("INSERT INTO _collections (id,system,type,name,fields,indexes,options,created,updated) VALUES (?,?,?,?,?,?,?,?,?)");
  for (const row of collections) {
    insColl.run([row[0], row[1], row[2], row[3], row[4], row[5], row[6], now, now]);
  }
  insColl.free();

  // ── _params ──
  db.run("CREATE TABLE _params (id TEXT PRIMARY KEY NOT NULL, value TEXT, created TEXT NOT NULL, updated TEXT NOT NULL)");
  db.run("INSERT INTO _params (id,value,created,updated) VALUES (?,?,?,?)", [
    "settings",
    JSON.stringify({
      meta: { appName: "Pocketflare Scale Test", appURL: "http://localhost:8787", senderName: "Scale", senderAddress: "scale@test.local" },
      logs: { maxDays: 5, maxPerDay: 10000, logIP: false },
      smtp: { enabled: false, host: "", port: 587, username: "", password: "", tls: true, authMethod: "PLAIN", localName: "" },
      s3: { enabled: false, bucket: "", region: "", endpoint: "", accessKey: "", secret: "", forcePathStyle: false },
      backups: { cronMaxKeep: 3 },
      rateLimits: { enabled: false, rules: [] },
      superuserIPs: [],
      batch: { enabled: true, maxRequests: 10, timeout: 30, maxBodySize: 5242880 },
    }),
    now, now,
  ]);

  // ── _migrations ──
  db.run("CREATE TABLE _migrations (file TEXT PRIMARY KEY NOT NULL, applied INTEGER NOT NULL)");
  const migrations = [
    "1640988000_init.go", "1640998000_2.go", "1651234000_3.go",
    "1678293000_4.go", "1680715000_5.go", "1687801000_6.go",
    "1693147200_7.go", "1695129600_8.go", "1699801200_9.go",
    "1703149200_10.go", "1703391600_11.go", "1703749200_12.go",
    "1704435600_13.go", "1704522000_14.go", "1704613200_15.go",
    "1704699600_16.go", "1704786000_17.go", "1704872400_18.go",
  ];
  const t = Math.floor(Date.now() / 1000);
  const insMig = db.prepare("INSERT INTO _migrations (file,applied) VALUES (?,?)");
  for (const m of migrations) { insMig.run([m, t]); }
  insMig.free();

  // ── _superusers ──
  db.run("CREATE TABLE _superusers (id TEXT PRIMARY KEY NOT NULL, password TEXT NOT NULL, tokenKey TEXT NOT NULL, email TEXT NOT NULL, emailVisibility INTEGER DEFAULT 0 NOT NULL, verified INTEGER DEFAULT 0 NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");
  const hash = "$2a$10$UZfMXTYiQYSzYlCi6Qnoy.Yost9D3oVfnrsMw3o5qY4LfDyTl8xn6";
  db.run("INSERT INTO _superusers (id,password,tokenKey,email,emailVisibility,verified,created,updated) VALUES (?,?,?,?,?,?,?,?)",
    ["su001", hash, "tk-scale-token-key-32chars-xxx", "admin@scale.local", 1, 1, now, now]);

  // ── users ──
  db.run("CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL, password TEXT NOT NULL, tokenKey TEXT NOT NULL, email TEXT DEFAULT '' NOT NULL, emailVisibility INTEGER DEFAULT 0 NOT NULL, verified INTEGER DEFAULT 0 NOT NULL, name TEXT DEFAULT '', avatar TEXT DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL)");
  db.run("INSERT INTO users (id,password,tokenKey,email,emailVisibility,verified,name,avatar,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ["u001", hash, "tk-scale-user-token-key-32chx", "user@scale.local", 1, 1, "Scale User", "", now, now]);

  // ── scale_items ──
  db.run("CREATE TABLE scale_items (id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, count REAL DEFAULT 0, data TEXT DEFAULT '{}')");
  const insScale = db.prepare("INSERT INTO scale_items (id,title,count,data) VALUES (?,?,?,?)");
  for (let i = 1; i <= RECORD_COUNT; i++) {
    const id = `sc${String(i).padStart(5, "0")}`;
    const title = `Scale item ${i} — ${"x".repeat(50)}`;
    const count = (i * 1.5) % 1000;
    const data = JSON.stringify({ index: i, tags: ["scale", "proof", `tag-${i % 10}`], description: `Record ${i} with some extra data for larger payload size. `.repeat(3) });
    insScale.run([id, title, count, data]);
  }
  insScale.free();

  // ── Other system tables ──
  db.run("CREATE TABLE _mfas (id TEXT PRIMARY KEY NOT NULL, collectionRef TEXT NOT NULL, recordRef TEXT NOT NULL, method TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");
  db.run("CREATE TABLE _otps (id TEXT PRIMARY KEY NOT NULL, collectionRef TEXT NOT NULL, recordRef TEXT NOT NULL, password TEXT NOT NULL, sentTo TEXT DEFAULT '', created TEXT NOT NULL, updated TEXT NOT NULL)");
  db.run("CREATE TABLE _authOrigins (id TEXT PRIMARY KEY NOT NULL, collectionRef TEXT NOT NULL, recordRef TEXT NOT NULL, fingerprint TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");
  db.run("CREATE TABLE _externalAuths (id TEXT PRIMARY KEY NOT NULL, collectionRef TEXT NOT NULL, recordRef TEXT NOT NULL, provider TEXT NOT NULL, providerId TEXT NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");

  // ── Views ──
  db.run("CREATE VIEW users_public AS SELECT id,email,name FROM users");
  db.run("CREATE VIEW scale_items_public AS SELECT id,title,count FROM scale_items");

  const dataBuffer = db.export();
  db.close();
  console.log(`data.db: ${(dataBuffer.length / 1024).toFixed(1)} KB`);

  // ── auxiliary.db ──
  const aux = new SQL.Database();
  aux.run("CREATE TABLE _logs (id TEXT PRIMARY KEY NOT NULL, level INTEGER DEFAULT 0 NOT NULL, message TEXT DEFAULT '' NOT NULL, data TEXT DEFAULT '{}' NOT NULL, created TEXT NOT NULL, updated TEXT NOT NULL)");
  const insLog = aux.prepare("INSERT INTO _logs (id,level,message,data,created,updated) VALUES (?,?,?,?,?,?)");
  for (let i = 1; i <= 500; i++) {
    const id = `log${String(i).padStart(5, "0")}`;
    insLog.run([id, i % 4, `Log entry ${i}: operation completed`, JSON.stringify({ op: `op-${i}`, duration: Math.random() * 100 }), now, now]);
  }
  insLog.free();
  aux.run("CREATE TABLE _migrations (file TEXT PRIMARY KEY NOT NULL, applied INTEGER NOT NULL)");
  const auxBuffer = aux.export();
  aux.close();
  console.log(`auxiliary.db: ${(auxBuffer.length / 1024).toFixed(1)} KB`);

  // ── Build zip ──
  const zip = new JSZip();
  zip.file("data.db", dataBuffer, { binary: true });
  zip.file("auxiliary.db", auxBuffer, { binary: true });

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(outPath, buf);
  console.log(`Wrote ${outPath} (${(buf.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error("FATAL:", err?.stack || err?.message || err);
  process.exit(1);
});
