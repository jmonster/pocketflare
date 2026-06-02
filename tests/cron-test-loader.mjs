// Node.js module loader hook that replaces WASM/runtime imports with
// lightweight mocks so that worker.mjs and app-do.mjs can be imported
// and tested without a real Go/WASM binary.

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = resolvePath(__dirname, "fixtures");

const MOCK_MAP = {
  "./wasm_exec.js": resolvePath(FIXTURES, "mock-wasm-exec.js"),
  "./runtime.mjs": resolvePath(FIXTURES, "mock-runtime.mjs"),
  "./realtime-do.mjs": resolvePath(FIXTURES, "mock-realtime-do.mjs"),
  "./smtp-transport.mjs": resolvePath(FIXTURES, "mock-smtp-transport.mjs"),
};

export async function resolve(specifier, context, nextResolve) {
  const mock = MOCK_MAP[specifier];
  if (mock) {
    return {
      url: pathToFileURL(mock).href,
      format: "module",
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
