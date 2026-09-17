import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compareVersions, fetchJSON, inspectVersion, latestVersion, parseVersion } from "../scripts/check-pb-version.mjs";

const stable = tag_name => ({ tag_name, draft: false, prerelease: false });

test("versions are compared numerically and normalized", () => {
  assert.equal(parseVersion(" 0.40.4 ").tag, "v0.40.4");
  for (const [a, b] of [["v0.40.10", "v0.40.9"], ["v0.41.0", "v0.40.99"], ["v1.0.0", "v0.99.99"]]) {
    assert.ok(compareVersions(parseVersion(a), parseVersion(b)) > 0);
  }
  for (const value of ["v0.40.4-rc.1", "master", "v0.40", "v0.40.4\necho bad", "v999999999999999999.0.0"]) {
    assert.throws(() => parseVersion(value), /Invalid semver tag/);
  }
});

test("current pins only need the latest endpoint", async () => {
  const urls = [];
  const result = await inspectVersion("v0.40.4", async url => {
    urls.push(url);
    return stable("v0.40.4");
  });
  assert.equal(result.comparison, 0);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/releases/latest"));
});

test("stale pins list only newer published stable versions in order", async () => {
  const result = await inspectVersion("v0.40.2", async url => url.endsWith("/latest") ? stable("v0.40.4") : [
    stable("v0.40.4"), stable("v0.40.3"), stable("v0.40.2"), stable("v0.40.5"),
    { ...stable("v0.40.3"), draft: true }, { ...stable("v0.40.3"), prerelease: true }, stable("bad-tag"),
  ]);
  assert.ok(result.comparison < 0);
  assert.deepEqual(result.newerReleases.map(v => v.tag), ["v0.40.3", "v0.40.4"]);
});

test("ahead-of-release pins retain existing behavior without another request", async () => {
  const result = await inspectVersion("v0.41.0", async () => stable("v0.40.4"));
  assert.ok(result.comparison > 0);
  assert.deepEqual(result.newerReleases, []);
});

test("latest lookup rejects unpublished and malformed releases", async () => {
  for (const release of [{ ...stable("v0.40.4"), draft: true }, { ...stable("v0.40.4"), prerelease: true }, stable("v0.40.4-rc.1")]) {
    await assert.rejects(latestVersion(async () => release));
  }
});

test("authenticated requests have bounded waits and do not log tokens", async () => {
  const data = await fetchJSON("https://api.github.com/repos/pocketbase/pocketbase/releases/latest", {
    token: "test-token",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => stable("v0.40.4") };
    },
  });
  assert.equal(data.tag_name, "v0.40.4");
});

test("anonymous requests remain supported", async () => {
  await fetchJSON("https://api.github.com/repos/pocketbase/pocketbase/releases/latest", {
    token: "",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, undefined);
      return { ok: true, json: async () => ({}) };
    },
  });
});

test("API and transport failures are not treated as compatibility", async () => {
  await assert.rejects(fetchJSON("https://api.github.com", {
    token: "test-token",
    fetchImpl: async () => ({ ok: false, status: 403, statusText: "Forbidden" }),
  }), { message: "GitHub request failed: 403 Forbidden" });
  await assert.rejects(inspectVersion("v0.40.4", async () => { throw new Error("network unavailable"); }), /network unavailable/);
});

test("CLI rejects unknown arguments without making requests", () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-pb-version.mjs", import.meta.url)), "--unknown"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage:/);
});

for (const scenario of [
  { name: "stale pin", args: [], release: stable("v999.0.0"), status: 1, output: /out of date/ },
  { name: "machine-readable latest tag", args: ["--latest"], release: stable("v999.0.0"), status: 0, output: /^v999\.0\.0\n$/ },
  { name: "API failure", args: [], failure: true, status: 2, output: /GitHub request failed: 503/ },
]) {
  test(`CLI: ${scenario.name}`, t => {
    const dir = mkdtempSync(path.join(tmpdir(), "pocketflare-version-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const preload = path.join(dir, "fetch.mjs");
    writeFileSync(preload, `globalThis.fetch = async url => ({
      ok: ${!scenario.failure}, status: 503, statusText: "Unavailable",
      json: async () => url.endsWith("/latest") ? ${JSON.stringify(scenario.release ?? {})} : []
    });`);
    const result = spawnSync(process.execPath, ["--import", preload,
      fileURLToPath(new URL("../scripts/check-pb-version.mjs", import.meta.url)), ...scenario.args], { encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, scenario.status, result.stderr);
    assert.match(result.stdout + result.stderr, scenario.output);
  });
}
