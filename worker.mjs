import "./wasm_exec.js";
import { createRuntimeContext, loadModule } from "./runtime.mjs";

async function run(ctx) {
  const go = new Go();
  const mod = await loadModule();

  let ready;
  const readyPromise = new Promise((resolve) => {
    ready = resolve;
  });

  const instance = new WebAssembly.Instance(mod, {
    ...go.importObject,
    workers: {
      ready: () => {
        ready();
      },
    },
  });

  go.run(instance, ctx);
  await readyPromise;
}

// Keep one Go/PocketBase runtime per isolate. Booting per request lets browser
// fan-out instantiate multiple ~39 MB WASM heaps inside the same 128 MB isolate.
let runtimePromise;
let runtimeContext;

async function getBinding(env, ctx) {
  if (runtimePromise === undefined) {
    runtimeContext = createRuntimeContext({ env, ctx, binding: {} });
    runtimePromise = run(runtimeContext)
      .then(() => runtimeContext.binding)
      .catch((err) => {
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

  try {
    const binding = await getBinding(env, ctx);
    const response = await binding.handleRequest(req);
    return response;
  } catch (e) {
    return new Response(
      `pocketflare error: ${e.message}\n\n${e.stack || ''}`,
      { status: 500, headers: { 'Content-Type': 'text/plain' } }
    );
  }
}

async function scheduled(event, env, ctx) {
  const binding = await getBinding(env, ctx);
  return binding.runScheduler(event);
}

export default { fetch, scheduled };
