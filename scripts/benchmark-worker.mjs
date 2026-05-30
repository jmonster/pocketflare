#!/usr/bin/env node

const baseURL = process.argv[2];
const warmCount = Number(process.argv[3] || 20);

if (!baseURL) {
  console.error("Usage: node scripts/benchmark-worker.mjs <worker-url> [warm-count]");
  process.exit(1);
}

const base = baseURL.replace(/\/+$/, "");

async function timedFetch(label, path) {
  const url = new URL(path, base + "/");
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.text();
  const clientMs = performance.now() - started;
  return {
    label,
    url: url.toString(),
    status: response.status,
    clientMs,
    route: response.headers.get("x-pocketflare-route") || "",
    runtime: response.headers.get("x-pocketflare-runtime") || "",
    bootId: response.headers.get("x-pocketflare-boot-id") || "",
    serverTiming: response.headers.get("server-timing") || "",
    body,
  };
}

function assetPathFromAdminHTML(html) {
  const match = html.match(/src="\.(\/assets\/[^"]+\.js)"/);
  return match ? "/_" + match[1] : "/_/";
}

function p(values, percentile) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1);
  return sorted[index];
}

function ms(value) {
  return `${Math.round(value * 100) / 100}ms`;
}

function printResult(result) {
  const route = result.route || "bypassed";
  const runtime = result.runtime ? ` runtime=${result.runtime}` : "";
  const boot = result.bootId ? ` boot=${result.bootId}` : "";
  console.log(`${result.label}: status=${result.status} client=${ms(result.clientMs)} route=${route}${runtime}${boot}`);
  if (result.serverTiming) {
    console.log(`  server-timing: ${result.serverTiming}`);
  }
}

const admin = await timedFetch("admin shell", "/_/");
printResult(admin);

const assetPath = assetPathFromAdminHTML(admin.body);
const asset = await timedFetch("admin asset", assetPath);
printResult(asset);

const firstDynamic = await timedFetch("dynamic first", "/api/settings");
printResult(firstDynamic);

const warm = [];
for (let i = 0; i < warmCount; i++) {
  warm.push(await timedFetch(`dynamic warm ${i + 1}`, "/api/settings"));
}

for (const result of warm) {
  printResult(result);
}

const warmClient = warm.map((r) => r.clientMs);
console.log("");
console.log("Summary");
console.log(`static admin asset client: ${ms(asset.clientMs)}`);
console.log(`first dynamic client: ${ms(firstDynamic.clientMs)} runtime=${firstDynamic.runtime || "unknown"}`);
console.log(`warm dynamic samples: ${warm.length}`);
console.log(`warm dynamic p50 client: ${ms(p(warmClient, 50))}`);
console.log(`warm dynamic p95 client: ${ms(p(warmClient, 95))}`);
