import "./wasm_exec.js";
import { createRuntimeContext, loadModule } from "./runtime.mjs";
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

async function scheduled(event, env, ctx) {
  const binding = await getBinding(env, ctx);
  return binding.runScheduler(event);
}

export { RealtimeDO };
export default { fetch, scheduled };
