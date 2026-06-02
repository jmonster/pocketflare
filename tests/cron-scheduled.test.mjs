// Proof: PocketBase cron jobs run through the Worker scheduled handler
// and the AppDO forwarding path when POCKETFLARE_DB_MODE=do_sqlite.
//
// Uses Node module loader hooks (tests/cron-test-loader.mjs) to replace
// WASM-dependent imports with mocks so the production handler code can be
// tested without a real Go/WASM binary.
//
// Run:
//   node --test ./tests/cron-scheduled.test.mjs

import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import assert from "node:assert/strict";
import { describe, it, before } from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Register module loader hooks before importing anything that needs them.
await register(resolve(__dirname, "cron-test-loader.mjs"), import.meta.url);

// Dynamically imported after the loader hooks are active.
let workerModule;
let AppDO;

before(async () => {
  workerModule = await import("../worker.mjs");
  // The real app-do.mjs is imported by worker.mjs and re-exported.
  AppDO = workerModule.AppDO;
});

describe("scheduled handler — DO SQLite mode", () => {
  it("forwards scheduled event to AppDO via internal request", async () => {
    const event = {
      cron: "* * * * *",
      scheduledTime: Date.now(),
    };

    let capturedReq;
    const stub = {
      fetch(req) {
        capturedReq = req;
        return new Response("ok", { status: 200 });
      },
    };

    const env = {
      POCKETFLARE_DB_MODE: "do_sqlite",
      APP_DO: {
        idFromName(_name) {
          return "app-do-id";
        },
        get(_id) {
          return stub;
        },
      },
    };

    const { scheduled } = workerModule.default;
    const response = await scheduled(event, env, {});

    assert.ok(capturedReq, "stub.fetch should have been called");
    assert.equal(capturedReq.method, "POST");
    assert.ok(
      new URL(capturedReq.url).pathname === "/_do/scheduled",
      "pathname should be /_do/scheduled",
    );

    const body = await capturedReq.json();
    assert.equal(body.cron, "* * * * *");
    assert.equal(body.scheduledTime, event.scheduledTime);

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });

  it("throws when APP_DO is not bound in DO SQLite mode", async () => {
    const env = {
      POCKETFLARE_DB_MODE: "do_sqlite",
      // No APP_DO binding.
    };

    const { scheduled } = workerModule.default;
    await assert.rejects(
      scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, env, {}),
      /APP_DO is not bound/,
    );
  });
});

describe("scheduled handler — D1 mode", () => {
  it("attempts WASM runtime path (fails at WASM boot in test, confirming it did not hit a config/binding error)", async () => {
    const env = {
      // Default D1 mode (no POCKETFLARE_DB_MODE set).
    };

    const { scheduled } = workerModule.default;
    // In test, getBinding → run → loadModule returns {} → WebAssembly.Instance
    // throws TypeError because {} is not a valid WASM module.
    // This proves scheduled() reached the D1 code path (not DO, not a config error).
    await assert.rejects(
      scheduled({ cron: "* * * * *", scheduledTime: Date.now() }, env, {}),
      (err) => {
        // Must NOT be a config/binding error.
        assert.ok(
          !err.message.includes("APP_DO"),
          `unexpected APP_DO error: ${err.message}`,
        );
        assert.ok(
          !err.message.includes("configured"),
          `unexpected config error: ${err.message}`,
        );
        return true;
      },
      "D1 path should attempt WASM runtime (expected WASM boot failure in test)",
    );
  });
});

describe("AppDO handleScheduled", () => {
  it("calls binding.runScheduler with parsed body", async () => {
    const doInstance = new AppDO({}, {});

    let capturedBody;
    doInstance.getBinding = async () => ({
      runScheduler(body) {
        capturedBody = body;
      },
    });

    const event = { cron: "*/5 * * * *", scheduledTime: Date.now() };
    const req = new Request("https://do.local/_do/scheduled", {
      method: "POST",
      body: JSON.stringify(event),
    });

    const response = await doInstance.handleScheduled(req);

    assert.ok(capturedBody, "runScheduler should have been called");
    assert.equal(capturedBody.cron, "*/5 * * * *");
    assert.equal(capturedBody.scheduledTime, event.scheduledTime);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  });

  it("returns 400 on invalid JSON body", async () => {
    const doInstance = new AppDO({}, {});
    const req = new Request("https://do.local/_do/scheduled", {
      method: "POST",
      body: "not json",
    });

    const response = await doInstance.handleScheduled(req);

    assert.equal(response.status, 400);
    assert.equal(await response.text(), "invalid json");
  });
});
