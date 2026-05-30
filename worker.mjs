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

async function fetch(req, env, ctx) {
  const binding = {};
  try {
    await run(createRuntimeContext({ env, ctx, binding }));
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
  const binding = {};
  await run(createRuntimeContext({ env, ctx, binding }));
  return binding.runScheduler(event);
}

export default { fetch, scheduled };
