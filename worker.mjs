import "./wasm_exec.js";
import { createRuntimeContext, loadModule } from "./runtime.mjs";
import { RealtimeDO } from "./realtime-do.mjs";
import { registerSmtpTransport } from "./smtp-transport.mjs";

async function run(ctx) {
  console.log({ family: "pocketflare-runtime", phase: "smtp-register" });
  try {
    registerSmtpTransport();
  } catch (_) {
    // SMTP transport unavailable — non-SMTP deployments are unaffected.
    // Go will report a clear error at send time if SMTP is configured.
  }

  const go = new Go();
  console.log({ family: "pocketflare-runtime", phase: "wasm-load-start" });
  const mod = await loadModule();
  console.log({ family: "pocketflare-runtime", phase: "wasm-load-done" });

  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });

  const instance = new WebAssembly.Instance(mod, {
    ...go.importObject,
    workers: {
      ready: () => {
        console.log({ family: "pocketflare-runtime", phase: "go-ready" });
        ready();
      },
    },
  });

  console.log({ family: "pocketflare-runtime", phase: "go-run-start" });
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
}

// Keep one Go/PocketBase runtime per isolate. Booting per request lets browser
// fan-out instantiate multiple ~39 MB WASM heaps inside the same 128 MB isolate.
let runtimePromise;
let runtimeContext;

async function getBinding(env, ctx) {
  if (runtimePromise === undefined) {
    console.log({ family: "pocketflare-runtime", phase: "init-start" });
    runtimeContext = createRuntimeContext({ env, ctx, binding: {} });
    runtimePromise = run(runtimeContext)
      .then(() => {
        console.log({ family: "pocketflare-runtime", phase: "init-ready" });
        return runtimeContext.binding;
      })
      .catch((err) => {
        console.error({ family: "pocketflare-runtime", phase: "init-error", message: err.message, stack: err.stack });
        runtimePromise = undefined;
        runtimeContext = undefined;
        throw err;
      });
  } else {
    runtimeContext.env = env;
    runtimeContext.ctx = ctx;
  }

  return runtimePromise;
}

async function fetch(req, env, ctx) {
  const url = new URL(req.url);
  if (url.pathname === "/_" || url.pathname.startsWith("/_/")) {
    return env.ASSETS.fetch(req);
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
    const binding = await getBinding(env, ctx);
    const response = await binding.handleRequest(req);
    return response;
  } catch (e) {
    console.error({ message: e.message, stack: e.stack, cause: e.cause });
    return new Response(
      'Internal Server Error',
      { status: 500, headers: { 'Content-Type': 'text/plain' } }
    );
  }
}

async function scheduled(event, env, ctx) {
  const binding = await getBinding(env, ctx);
  return binding.runScheduler(event);
}

export { RealtimeDO };
export default { fetch, scheduled };
