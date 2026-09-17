#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repo = "pocketbase/pocketbase";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const updateScript = path.join(root, "scripts", "update-pb.sh");
const api = `https://api.github.com/repos/${repo}`;

export function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Invalid semver tag: ${value}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`Invalid semver tag: ${value}`);
  }
  return { tag: `v${major}.${minor}.${patch}`, major, minor, patch };
}

export function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export async function fetchJSON(url, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "pocketflare-version-check",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function latestVersion(request = fetchJSON) {
  const release = await request(`${api}/releases/latest`);
  if (release.draft || release.prerelease) throw new Error("Latest release is not stable");
  return parseVersion(release.tag_name);
}

export async function inspectVersion(currentTag, request = fetchJSON) {
  const current = parseVersion(currentTag);
  const latest = await latestVersion(request);
  const comparison = compareVersions(current, latest);
  let newerReleases = [];
  if (comparison < 0) {
    const releases = await request(`${api}/releases?per_page=100`);
    newerReleases = releases.filter(release => !release.draft && !release.prerelease)
      .flatMap(release => {
        try { return [parseVersion(release.tag_name)]; } catch { return []; }
      })
      .filter(version => compareVersions(version, current) > 0 && compareVersions(version, latest) <= 0)
      .sort(compareVersions);
  }
  return { current, latest, comparison, newerReleases };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--latest") {
    console.log((await latestVersion()).tag);
    return;
  }
  if (args.length) throw new Error("Usage: check-pb-version.mjs [--latest]");

  const content = await readFile(updateScript, "utf8");
  const match = content.match(/VERSION="\$\{1:-([^}]+)\}"/);
  if (!match) throw new Error(`Could not find default PocketBase version in ${path.relative(root, updateScript)}`);
  const { current, latest, comparison, newerReleases } = await inspectVersion(match[1]);
  if (comparison === 0) {
    console.log(`PocketBase is up to date: ${current.tag}`);
  } else if (comparison > 0) {
    console.log(`PocketBase target ${current.tag} is newer than latest GitHub release ${latest.tag}.`);
  } else {
    console.log(`PocketBase is out of date: ${current.tag} -> ${latest.tag}.`);
    console.log(`Newer stable releases (latest 100 entries): ${newerReleases.map(version => version.tag).join(", ")}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(err => {
    console.error(err.message);
    process.exitCode = 2;
  });
}
