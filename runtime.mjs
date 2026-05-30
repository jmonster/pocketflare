let mod;

export async function loadModule() {
  if (mod === undefined) {
    const wasmModule = await import("./app.wasm");
    mod = wasmModule.default;
  }
  return mod;
}

export function createRuntimeContext({ env, ctx, binding }) {
  return { env, ctx, binding };
}
