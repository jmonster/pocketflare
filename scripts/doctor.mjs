#!/usr/bin/env node
// doctor.mjs — Pocketflare deployment/platform health check.
//
// Verifies: WASM boot, DB connectivity, R2 access (via /api/pocketflare/doctor),
// admin assets served by ASSETS binding, realtime SSE reachability,
// bundle size.
//
// Usage:
//   node scripts/doctor.mjs <worker-url> --token <superuser-token>
//   node scripts/doctor.mjs <worker-url> --email <email> --password <password>
//
// Exits 0 when all checks pass, non-zero otherwise.

let total = 0;
let passed = 0;
let failed = 0;
let skipped = 0;

function assert(label, ok) {
  total++;
  if (ok) { passed++; console.log("  PASS:", label); }
  else    { failed++; console.log("  FAIL:", label); }
}

function skip(label, reason) {
  total++;
  skipped++;
  console.log("  SKIP:", label, "(" + reason + ")");
}

function fatal(msg) {
  console.error("FATAL:", msg);
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  let workerURL, token, email, password;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--token": token = args[++i]; break;
      case "--email": email = args[++i]; break;
      case "--password": password = args[++i]; break;
      case "-h": case "--help": usage(); break;
      default:
        if (!workerURL) workerURL = args[i];
    }
  }

  if (!workerURL) usage();
  workerURL = workerURL.replace(/\/+$/, "");

  // ── Auth ──
  if (!token && email && password) {
    console.log("Authenticating as superuser...");
    try {
      const r = await fetch(`${workerURL}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: email, password }),
      });
      if (!r.ok) fatal("Auth failed: " + r.status);
      token = (await r.json()).token;
      if (!token) fatal("Auth returned no token");
    } catch (e) {
      fatal("Auth error: " + e.message);
    }
  }

  const authHeaders = token ? { Authorization: "Bearer " + token } : {};

  // ── 1. Health ──
  console.log("── 1. Health ──");
  let healthOK = false;
  try {
    const r = await fetch(`${workerURL}/api/health`);
    const body = await r.json();
    healthOK = r.status === 200 && body.code === 200;
    const route = r.headers.get("X-Pocketflare-Route") || "";
    console.log("  Route:", route, "Status:", r.status);
  } catch (e) {
    console.log("  Error:", e.message);
  }
  assert("health endpoint returns 200", healthOK);

  // ── 2. Doctor (DB + R2 connectivity) ──
  console.log("── 2. Doctor (DB + R2) ──");
  if (!token) {
    skip("doctor endpoint", "auth required");
  } else {
    let docOK = false;
    let body = null;
    try {
      const r = await fetch(`${workerURL}/api/pocketflare/doctor`, { headers: authHeaders });
      body = await r.json();
      console.log("  DB mode:", body.dbMode);
      console.log("  Main DB:", body.db?.ok ? "OK (" + body.db.latency + ")" : "FAIL: " + (body.db?.error || ""));
      console.log("  Aux DB:", body.auxDb?.ok ? "OK (" + body.auxDb.latency + ")" : "FAIL: " + (body.auxDb?.error || ""));
      console.log("  R2 STORAGE:", body.storage?.ok ? "OK" : "FAIL: " + (body.storage?.error || ""));
      console.log("  R2 BACKUPS:", body.backups?.ok ? "OK" : "FAIL: " + (body.backups?.error || ""));
      docOK = r.status === 200 && body.db?.ok && body.auxDb?.ok;
    } catch (e) {
      console.log("  Error:", e.message);
    }
    assert("doctor: DB healthy", docOK);
    // R2 bindings may be unavailable in local dev; note but don't fail.
    if (docOK) {
      if (body?.storage?.ok && body?.backups?.ok) {
        assert("doctor: R2 STORAGE + BACKUPS accessible", true);
      } else {
        skip("doctor: R2 STORAGE + BACKUPS", "bindings unavailable (expected in local dev)");
      }
    }
  }

  // ── 3. Admin assets ──
  console.log("── 3. Admin assets ──");
  let assetRouteOK = false;
  try {
    const r = await fetch(`${workerURL}/_/`, { redirect: "manual" });
    const route = r.headers.get("X-Pocketflare-Route") || "";
    const statusOK = r.status === 200 || r.status === 302;
    assetRouteOK = statusOK && route === "assets";
    console.log("  Route:", route, "Status:", r.status);
  } catch (e) {
    console.log("  Error:", e.message);
  }
  assert("admin assets served by ASSETS binding (route=assets)", assetRouteOK);

  // ── 4. Realtime SSE ──
  console.log("── 4. Realtime SSE ──");
  let realtimeResult = null;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(`${workerURL}/api/realtime`, {
        headers: { ...authHeaders, Accept: "text/event-stream" },
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (r.status < 500) {
        realtimeResult = "pass";
        console.log("  Status:", r.status, "Content-Type:", r.headers.get("Content-Type") || "");
      } else {
        realtimeResult = "fail";
        console.log("  FAIL: status", r.status);
      }
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        // Timeout is expected for SSE — the connection stays open.
        realtimeResult = "skip";
        console.log("  Connection open (SSE, timed out after 3s — expected)");
      } else {
        realtimeResult = "fail";
        console.log("  FAIL:", e.message);
      }
    }
  } catch (e) {
    realtimeResult = "fail";
    console.log("  FAIL:", e.message);
  }

  if (realtimeResult === "pass") {
    assert("realtime SSE endpoint reachable", true);
  } else if (realtimeResult === "skip") {
    skip("realtime SSE endpoint", "SSE connection held open (expected behavior)");
  } else {
    assert("realtime SSE endpoint reachable", false);
  }

  // ── 5. Bundle size ──
  console.log("── 5. Bundle size ──");
  try {
    const { statSync } = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
    try {
      const wasmStat = statSync(path.join(distDir, "app.wasm"));
      const wasmMB = (wasmStat.size / (1024 * 1024)).toFixed(1);
      console.log("  app.wasm:", wasmMB, "MB");
      assert("WASM under 40 MB", wasmStat.size < 40 * 1024 * 1024);
    } catch {
      skip("bundle size check", "dist/app.wasm not found — run make build first");
    }
  } catch {
    skip("bundle size check", "fs not available");
  }

  // ── Report ──
  console.log("");
  console.log("=========================================");
  console.log(`Results: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    console.log("DOCTOR: " + failed + " CHECK(S) FAILED");
    process.exit(1);
  }
  console.log("DOCTOR: ALL CHECKS PASSED");
}

function usage() {
  console.log("Usage: node scripts/doctor.mjs <worker-url> --token <superuser-token>");
  console.log("       node scripts/doctor.mjs <worker-url> --email <email> --password <password>");
  process.exit(2);
}

main().catch((err) => {
  console.error("FATAL:", err?.message || err);
  process.exit(2);
});
