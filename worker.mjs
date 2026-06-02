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
  // The production proof lane targets this GET -> REALTIME_DO -> DO.fetch path
  // on a deployed Worker. The bridge-only local proof is separate and must not
  // be used to claim this production route.
  // The DO is optional — without it, realtime falls through to Go where
  // SSE is non-functional on Workers (Flush is a no-op in the WASM bridge).
  if (url.pathname === "/api/realtime" && req.method === "GET" && env.REALTIME_DO) {
    // Worker-held SSE with DO polling (gated behind env var for local proof).
    // In production, stub.fetch(req) routes through the DO which handles
    // streaming natively; Go broadcasts via DOClient.Send → DO /__send.
    if (env.POCKETFLARE_REALTIME_WORKER_BRIDGE === "1") {
      return handleRealtimeSSE(env, req.signal);
    }
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

  // Proof: trigger the full scheduled-event → cron path via HTTP.
  // Gated — only active when POCKETFLARE_ENABLE_PROOF_ROUTES=1.
  if (url.pathname === "/_pf/proof/scheduled" && env.POCKETFLARE_ENABLE_PROOF_ROUTES === "1") {
    try {
      await scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, env, ctx);
      return new Response(JSON.stringify({ scheduled: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ scheduled: false, error: e.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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

    // Worker-side realtime bridge: only active when explicitly enabled for
    // local proofing. The subscription body must be read before Go consumes it.
    let realtimeSubBody = null;
    if (env.POCKETFLARE_REALTIME_WORKER_BRIDGE === "1") {
      if (url.pathname === "/api/realtime" && req.method === "POST") {
        try { realtimeSubBody = await req.clone().json(); } catch {}
      }
    }

    const binding = await getBinding(env, ctx);
    const runtimeWaitDone = performance.now();
    const handlerStart = performance.now();
    const response = await binding.handleRequest(req);
    const handlerDone = performance.now();

    if (env.POCKETFLARE_REALTIME_WORKER_BRIDGE === "1" && response.ok) {
      ctx.waitUntil(bridgeRealtimeToDO(env, url, req.method, realtimeSubBody, response.clone(), ctx));
    }
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

// ── Realtime SSE (proof bridge, gated) ────────────────────────────────
//
// Only active when POCKETFLARE_REALTIME_WORKER_BRIDGE=1 (set by the
// realtime proof script). Creates an SSE stream in the Worker and polls
// the RealtimeDO for messages. In production, GET /api/realtime routes
// through stub.fetch() to the DO which handles streaming natively; Go
// broadcasts via DOClient.Send → DO /__send.

async function handleRealtimeSSE(env, signal) {
  const clientId = crypto.randomUUID();
  const encoder = new TextEncoder();

  const doId = env.REALTIME_DO.idFromName("hub");
  const doStub = env.REALTIME_DO.get(doId);

  const stream = new ReadableStream({
    start(controller) {
      // Send PB_CONNECT immediately so the client receives the clientId.
      const connectMsg = `id:${clientId}\nevent:PB_CONNECT\ndata:${JSON.stringify({ clientId })}\n\n`;
      try {
        controller.enqueue(encoder.encode(connectMsg));
      } catch (e) {
        console.error({family:"rt-sse-error",phase:"pb-connect",message:e.message});
        return;
      }

      // Fire-and-forget poll loop: fetch queued messages from the DO
      // every 200ms and forward them to the SSE stream.
      const doPoll = () => {
        if (signal.aborted) { try { controller.close(); } catch {} return; }
        try {
          doStub.fetch(new Request(
            `https://do.local/__poll?clientId=${encodeURIComponent(clientId)}`,
            { method: "GET" }
          ))
          .then(r => r.ok ? r.json() : [])
          .then(messages => {
            if (!Array.isArray(messages)) return;
            if (messages.length > 0) console.log({family:"rt-poll",clientId,count:messages.length});
            for (const msg of messages) {
              const frame = `id:${clientId}\nevent:${msg.event}\ndata:${msg.data}\n\n`;
              controller.enqueue(encoder.encode(frame));
            }
          })
          .catch((e) => { console.error({family:"rt-poll-err",message:e.message}); try { controller.close(); } catch {} })
          .then(() => { if (!signal.aborted) scheduler.wait(200).then(doPoll); });
        } catch (e) {
          console.error({family:"rt-poll-fatal",message:e.message});
        }
      };

      scheduler.wait(100).then(doPoll).catch((e) => { console.error({family:"rt-sched-err",message:e.message}); });
    },

    cancel() {
      doStub.fetch(new Request("https://do.local/__unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      })).catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Realtime bridge (proof-only, gated) ──────────────────────────────
//
// Only active when POCKETFLARE_REALTIME_WORKER_BRIDGE=1. Forwards
// subscription data and record-change responses to the RealtimeDO so
// events reach Worker-held SSE connections during local proofing.
// Production relies on the Go broadcast path (DOClient.Send) which
// handles auth, record-level access control, and authoritative payloads.

async function bridgeRealtimeToDO(env, url, method, subBody, responseClone, ctx) {
  const doId = env.REALTIME_DO.idFromName("hub");
  const doStub = env.REALTIME_DO.get(doId);

  // Forward subscription to DO so the Worker's poll loop can find it.
  if (subBody && subBody.clientId) {
    try {
      await doStub.fetch(new Request("https://do.local/__subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: subBody.clientId,
          subscriptions: subBody.subscriptions || [],
        }),
      }));
    } catch (e) {
      console.error({ family: "rt-bridge", phase: "subscribe-err", message: e.message });
    }
  }

  // Forward record change events to subscribed clients via the DO.
  const recordMatch = url.pathname.match(/^\/api\/collections\/([^/]+)\/records(?:\/([^/]+))?$/);
  if (!recordMatch || url.pathname === "/api/realtime") return;

  const collectionName = recordMatch[1];
  let eventName;
  if (method === "POST") eventName = "RECORD_CREATE";
  else if (method === "PATCH") eventName = "RECORD_UPDATE";
  else if (method === "DELETE") eventName = "RECORD_DELETE";
  else return;

  try {
    const subsResp = await doStub.fetch(
      new Request("https://do.local/__subscriptions")
    );
    if (!subsResp.ok) return;
    const subs = await subsResp.json();

    // Read the authoritative record from Go's response body.
    // POST returns the created record; PATCH returns the updated record;
    // DELETE has no body (use empty record with the URL id).
    let record = {};
    if (method === "POST" || method === "PATCH") {
      try {
        const respText = await responseClone.text();
        record = JSON.parse(respText);
      } catch {}
    } else if (method === "DELETE") {
      record = { id: recordMatch[2] || "" };
    }
    const payload = JSON.stringify({
      action: eventName.toLowerCase().replace("record_", ""),
      collection: collectionName,
      record: record,
    });

    for (const sub of subs) {
      if (!sub.subscriptions || sub.subscriptions.indexOf(collectionName) === -1) continue;
      await doStub.fetch(new Request("https://do.local/__send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: sub.clientId, event: eventName, data: payload }),
      }));
    }
  } catch (e) {
    console.error({ family: "rt-bridge", phase: "broadcast-err", message: e.message });
  }
}

export { AppDO, RealtimeDO };
export default { fetch, scheduled };
