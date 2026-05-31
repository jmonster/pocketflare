#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = "pocketbase/pocketbase";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const updateScript = path.join(root, "scripts", "update-pb.sh");

function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid semver tag: ${value}`);
  }
  return {
    tag: `v${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function semanticDelta(from, to) {
  if (to.major !== from.major) return `${to.major - from.major} major`;
  if (to.minor !== from.minor) return `${to.minor - from.minor} minor`;
  return `${to.patch - from.patch} patch`;
}

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "pocketflare-version-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function currentTarget() {
  const content = await readFile(updateScript, "utf8");
  const match = content.match(/VERSION="\$\{1:-([^}]+)\}"/);
  if (!match) {
    throw new Error(`Could not find default PocketBase version in ${path.relative(root, updateScript)}`);
  }
  return parseVersion(match[1]);
}

async function main() {
  const current = await currentTarget();
  const latestRelease = await fetchJSON(`https://api.github.com/repos/${repo}/releases/latest`);
  const latest = parseVersion(latestRelease.tag_name);
  const comparison = compareVersions(current, latest);

  if (comparison === 0) {
    console.log(`PocketBase is up to date: ${current.tag}`);
    return;
  }

  if (comparison > 0) {
    console.log(`PocketBase target ${current.tag} is newer than latest GitHub release ${latest.tag}.`);
    return;
  }

  const releases = await fetchJSON(`https://api.github.com/repos/${repo}/releases?per_page=100`);
  const newerReleases = releases
    .map((release) => {
      try {
        return parseVersion(release.tag_name);
      } catch {
        return null;
      }
    })
    .filter((version) => version && compareVersions(version, current) > 0 && compareVersions(version, latest) <= 0)
    .sort(compareVersions);
  console.log(
    `PocketBase is out of date: ${current.tag} -> ${latest.tag} (${semanticDelta(current, latest)} behind; ${newerReleases.length} newer releases).`,
  );
  console.log(`Newer releases: ${newerReleases.map((version) => version.tag).join(", ")}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 2;
});
