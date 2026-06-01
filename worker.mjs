import "./wasm_exec.js";
import { createRuntimeContext, loadModule } from "./runtime.mjs";
import { AppDO } from "./app-do.mjs";
import { RealtimeDO } from "./realtime-do.mjs";
import { registerSmtpTransport } from "./smtp-transport.mjs";

async function run(ctx, metrics) {
  metrics.smtpRegisterStart = performance.now();
  console.log({ family: "pocketflare-runtime", phase: "smtp-register", bootId: metrics.bootId });
  try {
    registerSmtpTransport();
  } catch (_) {
    // SMTP transport unavailable — non-SMTP deployments are unaffected.
    // Go will report a clear error at send time if SMTP is configured.
  }
  metrics.smtpRegisterDone = performance.now();

  const go = new Go();
  metrics.wasmLoadStart = performance.now();
  console.log({ family: "pocketflare-runtime", phase: "wasm-load-start", bootId: metrics.bootId });
  const mod = await loadModule();
  metrics.wasmLoadDone = performance.now();
  console.log({ family: "pocketflare-runtime", phase: "wasm-load-done", bootId: metrics.bootId });

  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });

  metrics.wasmInstantiateStart = performance.now();
  const instance = new WebAssembly.Instance(mod, {
    ...go.importObject,
    workers: {
      ready: () => {
        metrics.goReady = performance.now();
        console.log({ family: "pocketflare-runtime", phase: "go-ready", bootId: metrics.bootId });
        ready();
      },
    },
  });
  metrics.wasmInstantiateDone = performance.now();

  metrics.goRunStart = performance.now();
  console.log({ family: "pocketflare-runtime", phase: "go-run-start", bootId: metrics.bootId });
  const goPromise = go.run(instance, ctx);
  await Promise.race([
    readyPromise,
    goPromise.then(
      () => {
        throw new Error("Go program exited before signaling ready");
      },
      (err) => {
        throw err;
      },
    ),
  ]);
  metrics.ready = performance.now();
}

// Keep one Go/PocketBase runtime per isolate. Booting per request lets browser
// fan-out instantiate multiple ~39 MB WASM heaps inside the same 128 MB isolate.
let runtimePromise;
let runtimeContext;
let runtimeReady = false;
let runtimeBootSeq = 0;
let runtimeMetrics;

async function getBinding(env, ctx) {
  if (runtimePromise === undefined) {
    runtimeReady = false;
    runtimeMetrics = {
      bootId: ++runtimeBootSeq,
      initStart: performance.now(),
    };
    console.log({ family: "pocketflare-runtime", phase: "init-start", bootId: runtimeMetrics.bootId });
    runtimeContext = createRuntimeContext({ env, ctx, binding: {} });
    runtimePromise = run(runtimeContext, runtimeMetrics)
      .then(() => {
        runtimeReady = true;
        runtimeMetrics.initReady = performance.now();
        console.log({ family: "pocketflare-runtime", phase: "init-ready", bootId: runtimeMetrics.bootId });
        return runtimeContext.binding;
      })
      .catch((err) => {
        console.error({ family: "pocketflare-runtime", phase: "init-error", bootId: runtimeMetrics?.bootId, message: err.message, stack: err.stack });
        runtimePromise = undefined;
        runtimeContext = undefined;
        runtimeReady = false;
        throw err;
      });
  } else {
    runtimeContext.env = env;
    runtimeContext.ctx = ctx;
  }

  return runtimePromise;
}

function runtimeStateForRequest() {
  if (runtimePromise === undefined) return "cold";
  if (!runtimeReady) return "boot_wait";
  return "warm";
}

async function fetch(req, env, ctx) {
  const fetchStart = performance.now();
  const url = new URL(req.url);

  if (url.pathname === "/_" || url.pathname.startsWith("/_/")) {
    const response = await env.ASSETS.fetch(req);
    return withTimingHeaders(response, {
      route: "assets",
      serverTiming: [
        ["pf_static", performance.now() - fetchStart],
        ["pf_total", performance.now() - fetchStart],
      ],
    });
  }

  // Restore file upload: stream directly to R2 without buffering in Go/WASM.
  // Validates the restore session token and storage key before writing.
  if (url.pathname === "/api/pocketflare/restore/files" && (req.method === "PUT" || req.method === "POST")) {
    return handleRestoreFileUpload(req, env, fetchStart);
  }

  // Realtime SSE connections live in a Durable Object so they can hold
  // connections open beyond the Worker fetch timeout and fan out across
  // isolates. Only GET (connection) is intercepted; POST (subscriptions)
  // still goes through Go for auth and access control.
  //
  // The DO is optional — without it, realtime falls through to Go where
  // SSE is non-functional on Workers (Flush is a no-op in the WASM bridge).
  if (url.pathname === "/api/realtime" && req.method === "GET" && env.REALTIME_DO) {
    const id = env.REALTIME_DO.idFromName("hub");
    const stub = env.REALTIME_DO.get(id);
    return stub.fetch(req);
  }

  // DO SQLite mode: route all dynamic requests (including /_pf installer)
  // through a Durable Object that owns the Go/WASM runtime.
  if (dbMode(env) === "do_sqlite") {
    if (!env.APP_DO) {
      return new Response("Pocketflare is configured for DO SQLite mode, but APP_DO is not bound.", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
    const id = env.APP_DO.idFromName("app");
    const stub = env.APP_DO.get(id);
    try {
      const response = await stub.fetch(req);
      return withTimingHeaders(response, {
        route: "dynamic-do",
        serverTiming: [
          ["pf_total", performance.now() - fetchStart],
        ],
      });
    } catch (e) {
      console.error({ message: e.message, stack: e.stack, cause: e.cause });
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }

  // D1 mode: boot Go/WASM inline in the Worker isolate.

  if (url.pathname === "/_pf" || url.pathname === "/_pf/") {
    const runtimeState = runtimeStateForRequest();
    const runtimeWaitStart = performance.now();
    const binding = await getBinding(env, ctx);
    const runtimeWaitDone = performance.now();
    const redirectURL = await binding.installerRedirectURL(req.url) || new URL("/_/", req.url).toString();
    return withTimingHeaders(Response.redirect(redirectURL, 302), {
      route: "installer",
      runtime: runtimeState,
      bootId: runtimeMetrics?.bootId,
      serverTiming: [
        ["pf_total", performance.now() - fetchStart],
        ["pf_runtime_wait", runtimeWaitDone - runtimeWaitStart],
      ],
    });
  }

  try {
    const runtimeState = runtimeStateForRequest();
    const runtimeWaitStart = performance.now();
    const binding = await getBinding(env, ctx);
    const runtimeWaitDone = performance.now();
    const handlerStart = performance.now();
    const response = await binding.handleRequest(req);
    const handlerDone = performance.now();
    const totalMs = handlerDone - fetchStart;
    const serverTiming = [
      ["pf_total", totalMs],
      ["pf_runtime_wait", runtimeWaitDone - runtimeWaitStart],
      ["pf_handler", handlerDone - handlerStart],
    ];
    if (runtimeState !== "warm" && runtimeMetrics) {
      appendBootTimings(serverTiming, runtimeMetrics);
    }
    console.log({
      family: "pocketflare-request",
      method: req.method,
      path: url.pathname,
      runtime: runtimeState,
      bootId: runtimeMetrics?.bootId,
      totalMs: roundMs(totalMs),
      runtimeWaitMs: roundMs(runtimeWaitDone - runtimeWaitStart),
      handlerMs: roundMs(handlerDone - handlerStart),
    });
    return withTimingHeaders(response, {
      route: "dynamic",
      runtime: runtimeState,
      bootId: runtimeMetrics?.bootId,
      serverTiming,
    });
  } catch (e) {
    console.error({ message: e.message, stack: e.stack, cause: e.cause });
    return new Response(
      'Internal Server Error',
      { status: 500, headers: { 'Content-Type': 'text/plain' } }
    );
  }
}

function appendBootTimings(serverTiming, metrics) {
  if (metrics.wasmLoadStart && metrics.wasmLoadDone) {
    serverTiming.push(["pf_wasm_load", metrics.wasmLoadDone - metrics.wasmLoadStart]);
  }
  if (metrics.wasmInstantiateStart && metrics.wasmInstantiateDone) {
    serverTiming.push(["pf_wasm_instantiate", metrics.wasmInstantiateDone - metrics.wasmInstantiateStart]);
  }
  if (metrics.goRunStart && metrics.goReady) {
    serverTiming.push(["pf_go_ready", metrics.goReady - metrics.goRunStart]);
  }
  if (metrics.initStart && metrics.initReady) {
    serverTiming.push(["pf_boot_total", metrics.initReady - metrics.initStart]);
  }
}

function withTimingHeaders(response, { route, runtime, bootId, serverTiming }) {
  const headers = new Headers(response.headers);
  headers.set("X-Pocketflare-Route", route);
  if (runtime) headers.set("X-Pocketflare-Runtime", runtime);
  if (bootId !== undefined) headers.set("X-Pocketflare-Boot-Id", String(bootId));
  if (serverTiming?.length) {
    headers.set("Server-Timing", serverTiming.map(([name, value]) => `${name};dur=${roundMs(value)}`).join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}

function dbMode(env) {
  return String(env.POCKETFLARE_DB_MODE || "d1").trim().toLowerCase();
}

// ── Restore file upload ─────────────────────────────────────────────────

const RESTORE_MARKER_KEY = "pocketflare-restore/active.json";

// PocketBase storage key shape: storage/<collectionId>/<recordId>/<filename>
// or storage/<collectionId>/<recordId>/thumbs_<filename>/<thumbSize>_<filename>
const STORAGE_KEY_RE = /^storage\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+\/(thumbs_[^/]+\/[^/]+|[^/]+)$/;

function validateStorageKey(key) {
  if (!STORAGE_KEY_RE.test(key)) return false;
  // Reject path traversal and empty segments.
  if (key.includes("..") || key.includes("\\")) return false;
  if (key.split("/").some(s => s === "")) return false;
  return true;
}

async function handleRestoreFileUpload(req, env, fetchStart) {
  const fileKey = req.headers.get("X-Pocketflare-File-Key");
  const restoreToken = req.headers.get("X-Pocketflare-Restore-Token");

  if (!fileKey || !restoreToken) {
    return new Response(
      JSON.stringify({ error: "missing X-Pocketflare-File-Key or X-Pocketflare-Restore-Token header" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Strict key validation: no traversal, no unexpected paths.
  if (!validateStorageKey(fileKey)) {
    return new Response(
      JSON.stringify({ error: "invalid storage key: " + fileKey }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate restore session.
  let marker;
  try {
    const markerObj = await env.STORAGE.get(RESTORE_MARKER_KEY);
    if (!markerObj) {
      return new Response(
        JSON.stringify({ error: "no active restore session" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    marker = await markerObj.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "failed to read restore marker" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!marker || marker.fileUploadToken !== restoreToken) {
    return new Response(
      JSON.stringify({ error: "invalid restore token" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  if (marker.phase !== "files") {
    return new Response(
      JSON.stringify({ error: "restore not accepting file uploads (phase: " + marker.phase + ")" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Stream body directly to R2.
  const contentType = req.headers.get("X-Pocketflare-File-Content-Type") || req.headers.get("Content-Type") || undefined;
  const putOpts = {};
  if (contentType) {
    putOpts.httpMetadata = { contentType };
  }

  try {
    await env.STORAGE.put(fileKey, req.body, putOpts);
  } catch (e) {
    console.error({ family: "pocketflare-restore", phase: "file-upload-error", key: fileKey, message: e.message });
    return new Response(
      JSON.stringify({ error: "failed to upload file to R2", key: fileKey }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return withTimingHeaders(
    new Response(JSON.stringify({ ok: true, key: fileKey }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    {
      route: "restore-file",
      serverTiming: [
        ["pf_total", performance.now() - fetchStart],
      ],
    },
  );
}

async function scheduled(event, env, ctx) {
  if (dbMode(env) === "do_sqlite") {
    if (!env.APP_DO) {
      throw new Error("Pocketflare is configured for DO SQLite mode, but APP_DO is not bound.");
    }
    const id = env.APP_DO.idFromName("app");
    const stub = env.APP_DO.get(id);
    const req = new Request("https://do.local/_do/scheduled", {
      method: "POST",
      body: JSON.stringify({ cron: event.cron, scheduledTime: event.scheduledTime }),
    });
    return stub.fetch(req);
  }
  const binding = await getBinding(env, ctx);
  return binding.runScheduler(event);
}

export { AppDO, RealtimeDO };
export default { fetch, scheduled };
