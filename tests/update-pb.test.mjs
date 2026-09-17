import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

// Exercise the real updater without GitHub, credentials, or Cloudflare resources.
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "pocketflare-update-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = path.join(root, "upstream");
  const project = path.join(root, "project");
  const pb = path.join(project, "internal", "pocketbase");
  mkdirSync(upstream);
  mkdirSync(path.join(project, "scripts"), { recursive: true });
  mkdirSync(path.join(project, "patches"));
  copyFileSync(new URL("../scripts/update-pb.sh", import.meta.url), path.join(project, "scripts", "update-pb.sh"));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `url.${pathToFileURL(upstream).href}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/pocketbase/pocketbase.git",
    GIT_AUTHOR_NAME: "Updater Test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "Updater Test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
    GIT_TERMINAL_PROMPT: "0",
  };
  function git(cwd, ...args) {
    const result = spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  }
  git(upstream, "init", "-q");
  writeFileSync(path.join(upstream, "value.txt"), "base\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-qm", "base");
  git(upstream, "tag", "v0.40.2");
  writeFileSync(path.join(upstream, "value.txt"), "next base\n");
  git(upstream, "commit", "-qam", "next");
  git(upstream, "tag", "v0.41.0");

  function patch(name, before, after) {
    writeFileSync(path.join(project, "patches", name),
      `diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-${before}\n+${after}\n`);
  }
  function seed() {
    git(project, "clone", "--quiet", "--depth", "1", "--branch", "v0.40.2", pathToFileURL(upstream).href, pb);
  }
  function run(version = "v0.40.2", extraEnv = {}) {
    return spawnSync("bash", [path.join(project, "scripts", "update-pb.sh"), version], {
      cwd: project, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 10_000,
    });
  }
  function cleanStaging() {
    const internal = path.dirname(pb);
    assert.deepEqual(readdirSync(internal).filter(name => name.startsWith(".pocketbase-update.")), []);
  }
  return { upstream, project, pb, git, patch, seed, run, cleanStaging };
}

function succeeded(result) {
  assert.equal(result.status, 0, result.stderr || String(result.error));
}
function failed(result) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0, result.stdout);
}

test("fresh checkout applies dependent patches in filename order", t => {
  const f = fixture(t);
  f.patch("002-second.patch", "patched", "final");
  f.patch("001-first.patch", "base", "patched");
  succeeded(f.run());
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "final\n");
  assert.equal(f.git(f.pb, "rev-parse", "HEAD"), f.git(f.upstream, "rev-parse", "v0.40.2"));
  f.cleanStaging();
});

test("successful upgrade replaces a clean checkout only after patching", t => {
  const f = fixture(t);
  f.seed();
  f.patch("001.patch", "next base", "upgraded");
  succeeded(f.run("v0.41.0"));
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "upgraded\n");
  assert.equal(f.git(f.pb, "rev-parse", "HEAD"), f.git(f.upstream, "rev-parse", "v0.41.0"));
  f.cleanStaging();
});

test("a conflict in a later patch preserves the existing checkout and HEAD", t => {
  const f = fixture(t);
  f.seed();
  const head = f.git(f.pb, "rev-parse", "HEAD");
  f.patch("001.patch", "next base", "partially patched");
  f.patch("002.patch", "does not exist", "broken");
  failed(f.run("v0.41.0"));
  assert.equal(f.git(f.pb, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "base\n");
  assert.equal(f.git(f.pb, "status", "--porcelain"), "");
  f.cleanStaging();
});

test("a failed fresh replay leaves no partial PocketBase checkout", t => {
  const f = fixture(t);
  f.patch("001.patch", "base", "partially patched");
  f.patch("002.patch", "does not exist", "broken");
  failed(f.run());
  assert.equal(existsSync(f.pb), false);
  f.cleanStaging();
});

test("an unavailable upstream tag does not delete the existing checkout", t => {
  const f = fixture(t);
  f.seed();
  const head = f.git(f.pb, "rev-parse", "HEAD");
  failed(f.run("v99.0.0"));
  assert.equal(f.git(f.pb, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "base\n");
  f.cleanStaging();
});

for (const kind of ["tracked", "staged", "untracked"]) {
  test(`refuses to overwrite ${kind} local changes`, t => {
    const f = fixture(t);
    f.seed();
    const name = kind === "untracked" ? "local.txt" : "value.txt";
    writeFileSync(path.join(f.pb, name), "keep me\n");
    if (kind === "staged") f.git(f.pb, "add", name);
    failed(f.run("v0.41.0"));
    assert.equal(readFileSync(path.join(f.pb, name), "utf8"), "keep me\n");
  });
}

test("refuses to remove a non-Git directory", t => {
  const f = fixture(t);
  mkdirSync(f.pb, { recursive: true });
  writeFileSync(path.join(f.pb, "local.txt"), "keep me\n");
  failed(f.run());
  assert.equal(readFileSync(path.join(f.pb, "local.txt"), "utf8"), "keep me\n");
});

test("refuses a symlink checkout", t => {
  const f = fixture(t);
  mkdirSync(path.dirname(f.pb), { recursive: true });
  symlinkSync(f.upstream, f.pb);
  failed(f.run());
  assert.equal(readFileSync(path.join(f.upstream, "value.txt"), "utf8"), "next base\n");
});

test("refuses to delete ignored local data during checkout replacement", t => {
  const f = fixture(t);
  f.seed();
  writeFileSync(path.join(f.pb, ".git", "info", "exclude"), "local-data/\n");
  mkdirSync(path.join(f.pb, "local-data"));
  writeFileSync(path.join(f.pb, "local-data", "data.db"), "keep me\n");
  assert.equal(f.git(f.pb, "status", "--porcelain"), "");
  failed(f.run("v0.41.0"));
  assert.equal(readFileSync(path.join(f.pb, "local-data", "data.db"), "utf8"), "keep me\n");
});

test("refuses concurrent updates without removing the other updater's lock", t => {
  const f = fixture(t);
  const lock = path.join(path.dirname(f.pb), ".pocketbase-update.lock");
  mkdirSync(lock, { recursive: true });
  failed(f.run());
  assert.equal(existsSync(lock), true);
  assert.equal(existsSync(f.pb), false);
});

for (const interrupt of [false, true]) {
  test(`restores the previous checkout when promotion ${interrupt ? "is interrupted" : "fails"}`, t => {
    const f = fixture(t);
    f.seed();
    const head = f.git(f.pb, "rev-parse", "HEAD");
    f.patch("001.patch", "next base", "upgraded");
    const bin = path.join(f.project, "bin");
    mkdirSync(bin);
    const realMv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();
    assert.ok(realMv);
    // Fail only the second rename; let cleanup restore the saved checkout.
    writeFileSync(path.join(bin, "mv"), `#!/bin/bash
case "$1" in
  */.pocketbase-update.*/next) ${interrupt ? 'kill -TERM "$PPID"; ' : ""}exit 1 ;;
esac
exec "${realMv}" "$@"
`, { mode: 0o755 });
    failed(f.run("v0.41.0", { PATH: `${bin}:${process.env.PATH}` }));
    assert.equal(f.git(f.pb, "rev-parse", "HEAD"), head);
    assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "base\n");
    f.cleanStaging();
  });
}

test("successful upgrades preserve stashes, local branches, and Git configuration", t => {
  const f = fixture(t);
  f.seed();
  f.git(f.pb, "switch", "-c", "local-work");
  writeFileSync(path.join(f.pb, "local.txt"), "committed local work\n");
  f.git(f.pb, "add", "local.txt");
  f.git(f.pb, "commit", "-qm", "local work");
  const localCommit = f.git(f.pb, "rev-parse", "HEAD");
  writeFileSync(path.join(f.pb, "local.txt"), "stashed local work\n");
  f.git(f.pb, "stash", "push", "-m", "keep this stash");
  const stash = f.git(f.pb, "rev-parse", "refs/stash");
  f.git(f.pb, "config", "pocketflare.test", "keep this setting");
  f.patch("001.patch", "next base", "upgraded");
  succeeded(f.run("v0.41.0"));
  assert.equal(f.git(f.pb, "rev-parse", "local-work"), localCommit);
  assert.equal(f.git(f.pb, "show", "local-work:local.txt"), "committed local work");
  assert.equal(f.git(f.pb, "rev-parse", "refs/stash"), stash);
  assert.equal(f.git(f.pb, "show", "stash:local.txt"), "stashed local work");
  assert.equal(f.git(f.pb, "config", "pocketflare.test"), "keep this setting");
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "upgraded\n");
  f.cleanStaging();
});

test("refuses a symlinked Git directory without modifying its target", t => {
  const f = fixture(t);
  mkdirSync(f.pb, { recursive: true });
  symlinkSync(path.join(f.upstream, ".git"), path.join(f.pb, ".git"));
  writeFileSync(path.join(f.pb, "value.txt"), "next base\n");
  const head = f.git(f.upstream, "rev-parse", "HEAD");
  failed(f.run());
  assert.equal(f.git(f.upstream, "rev-parse", "HEAD"), head);
});

test("refuses an explicit core.worktree that could redirect staging commands", t => {
  const f = fixture(t);
  f.seed();
  f.git(f.pb, "config", "core.worktree", f.pb);
  failed(f.run("v0.41.0"));
  assert.equal(readFileSync(path.join(f.pb, "value.txt"), "utf8"), "base\n");
});
