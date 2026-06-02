// Minimal mock of wasm_exec.js for testing worker.mjs and app-do.mjs
// without a real Go/WASM runtime.
globalThis.Go = class Go {
  constructor() {
    this.importObject = {};
  }
  async run(instance, ctx) {
    // Never resolve — cron tests don't call run().
    return new Promise(() => {});
  }
};
