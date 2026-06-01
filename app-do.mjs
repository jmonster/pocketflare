// AppDO — Durable Object that hosts the PocketBase Go/WASM runtime for
// DO SQLite mode. One object per deployed app instance.
//
// The DO owns the WASM runtime so that ctx.storage.sql and
// ctx.storage.transactionSync() are available to the Go database/sql driver.
// The outer Worker routes all dynamic (non-asset, non-realtime) requests here
// when POCKETFLARE_DB_MODE=do_sqlite.

import "./wasm_exec.js";
import { createRuntimeContext, loadModule } from "./runtime.mjs";
import { registerSmtpTransport } from "./smtp-transport.mjs";

export class AppDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.runtimePromise = undefined;
    this.runtimeContext = undefined;
    this.runtimeReady = false;
    this.runtimeBootSeq = 0;
    this.runtimeMetrics = undefined;
  }

  async fetch(req) {
    const url = new URL(req.url);

    // Internal: cron/scheduled events forwarded by the outer Worker.
    if (url.pathname === "/_do/scheduled" && req.method === "POST") {
      return this.handleScheduled(req);
    }

    const fetchStart = performance.now();
    const runtimeState = this.runtimeStateForRequest();
    const runtimeWaitStart = performance.now();

    let binding;
    try {
      binding = await this.getBinding();
    } catch (e) {
      console.error({
        family: "pocketflare-do",
        phase: "init-error",
        bootId: this.runtimeMetrics?.bootId,
        message: e.message,
        stack: e.stack,
      });
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const runtimeWaitDone = performance.now();
    const handlerStart = performance.now();

    let response;
    try {
      response = await binding.handleRequest(req);
    } catch (e) {
      console.error({ message: e.message, stack: e.stack, cause: e.cause });
      return new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const handlerDone = performance.now();
    const totalMs = handlerDone - fetchStart;
    const serverTiming = [
      ["pf_total", totalMs],
      ["pf_runtime_wait", runtimeWaitDone - runtimeWaitStart],
      ["pf_handler", handlerDone - handlerStart],
    ];
    if (runtimeState !== "warm" && this.runtimeMetrics) {
      const m = this.runtimeMetrics;
      if (m.wasmLoadStart && m.wasmLoadDone) {
        serverTiming.push(["pf_wasm_load", m.wasmLoadDone - m.wasmLoadStart]);
      }
      if (m.wasmInstantiateStart && m.wasmInstantiateDone) {
        serverTiming.push([
          "pf_wasm_instantiate",
          m.wasmInstantiateDone - m.wasmInstantiateStart,
        ]);
      }
      if (m.goRunStart && m.goReady) {
        serverTiming.push(["pf_go_ready", m.goReady - m.goRunStart]);
      }
      if (m.initStart && m.initReady) {
        serverTiming.push(["pf_boot_total", m.initReady - m.initStart]);
      }
    }

    console.log({
      family: "pocketflare-do-request",
      method: req.method,
      path: url.pathname,
      runtime: runtimeState,
      bootId: this.runtimeMetrics?.bootId,
      totalMs: roundMs(totalMs),
      runtimeWaitMs: roundMs(runtimeWaitDone - runtimeWaitStart),
      handlerMs: roundMs(handlerDone - handlerStart),
    });

    const headers = new Headers(response.headers);
    headers.set("X-Pocketflare-Route", "dynamic-do");
    if (runtimeState) headers.set("X-Pocketflare-Runtime", runtimeState);
    if (this.runtimeMetrics?.bootId !== undefined) {
      headers.set(
        "X-Pocketflare-Boot-Id",
        String(this.runtimeMetrics.bootId),
      );
    }
    if (serverTiming.length) {
      headers.set(
        "Server-Timing",
        serverTiming
          .map(([name, value]) => `${name};dur=${roundMs(value)}`)
          .join(", "),
      );
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  // ── Go/WASM runtime lifecycle ──────────────────────────────────────────

  async getBinding() {
    if (this.runtimePromise === undefined) {
      this.runtimeReady = false;
      this.runtimeMetrics = {
        bootId: ++this.runtimeBootSeq,
        initStart: performance.now(),
      };
      console.log({
        family: "pocketflare-do",
        phase: "init-start",
        bootId: this.runtimeMetrics.bootId,
      });
      this.runtimeContext = createRuntimeContext({
        env: this.env,
        ctx: this.ctx,
        binding: {},
      });
      this.runtimePromise = this.run(this.runtimeContext, this.runtimeMetrics)
        .then(() => {
          this.runtimeReady = true;
          this.runtimeMetrics.initReady = performance.now();
          console.log({
            family: "pocketflare-do",
            phase: "init-ready",
            bootId: this.runtimeMetrics.bootId,
          });
          return this.runtimeContext.binding;
        })
        .catch((err) => {
          console.error({
            family: "pocketflare-do",
            phase: "init-error",
            bootId: this.runtimeMetrics?.bootId,
            message: err.message,
            stack: err.stack,
          });
          this.runtimePromise = undefined;
          this.runtimeContext = undefined;
          this.runtimeReady = false;
          throw err;
        });
    } else {
      this.runtimeContext.env = this.env;
      this.runtimeContext.ctx = this.ctx;
    }

    return this.runtimePromise;
  }

  async run(ctx, metrics) {
    registerDoStorageBridge();

    metrics.smtpRegisterStart = performance.now();
    console.log({
      family: "pocketflare-do",
      phase: "smtp-register",
      bootId: metrics.bootId,
    });
    try {
      registerSmtpTransport();
    } catch (_) {
      // SMTP transport unavailable. HTTP mail providers and non-mail paths continue.
    }
    metrics.smtpRegisterDone = performance.now();

    const go = new Go();
    metrics.wasmLoadStart = performance.now();
    console.log({
      family: "pocketflare-do",
      phase: "wasm-load-start",
      bootId: metrics.bootId,
    });
    const mod = await loadModule();
    metrics.wasmLoadDone = performance.now();
    console.log({
      family: "pocketflare-do",
      phase: "wasm-load-done",
      bootId: metrics.bootId,
    });

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
          console.log({
            family: "pocketflare-do",
            phase: "go-ready",
            bootId: metrics.bootId,
          });
          ready();
        },
      },
    });
    metrics.wasmInstantiateDone = performance.now();

    metrics.goRunStart = performance.now();
    console.log({
      family: "pocketflare-do",
      phase: "go-run-start",
      bootId: metrics.bootId,
    });
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

  runtimeStateForRequest() {
    if (this.runtimePromise === undefined) return "cold";
    if (!this.runtimeReady) return "boot_wait";
    return "warm";
  }

  // ── Scheduled events (cron) ────────────────────────────────────────────

  async handleScheduled(req) {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    const binding = await this.getBinding();
    await binding.runScheduler(body);
    return new Response("ok", { status: 200 });
  }
}

function registerDoStorageBridge() {
  globalThis.__pocketflareDoTransactionSync = (storage, callback) => {
    try {
      storage.transactionSync(() => {
        const errorMessage = callback();
        if (errorMessage) {
          throw new Error(String(errorMessage));
        }
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  };
}

function roundMs(value) {
  return Math.round(value * 100) / 100;
}
