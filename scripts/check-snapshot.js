#!/usr/bin/env node
/**
 * Verify `<repo-root>/manifests/production.snapshot.json` against:
 *   1. drift   — remote `issues_last_updated_at` (within scope filter) matches snapshot
 *   2. refs    — every `if_flag!("name#sha")`-style ref in code resolves to a snapshot entry
 *                with id===name && sha===sha
 *   3. removed — refs whose snapshot entry has stage=="removed" are flagged
 *
 * Config sources: see `config.js`.
 *
 * Auth: GITHUB_TOKEN or GH_TOKEN env var.
 *
 * Args:
 *   --skip-grep   skip steps 2/3 (drift only)
 */

import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { loadConfig, repoRoot } from "./config.js";

function readSnapshot() {
  const p = path.join(repoRoot(), "manifests", "production.snapshot.json");
  if (!fs.existsSync(p)) {
    console.error(`snapshot not found: ${p}`);
    console.error("run: npx dev-plans-snapshot build");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function matchesScope(labels, scopeLabels) {
  if (!scopeLabels || scopeLabels.length === 0) return true;
  const wanted = new Set(scopeLabels.map((s) => `scope:${s}`));
  return labels.some((l) => wanted.has(typeof l === "string" ? l : l.name));
}

async function fetchLastUpdated(octokit, owner, repo, scopeLabels) {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    labels: "plan",
    state: "all",
    per_page: 100,
  });
  const filtered = issues
    .filter((i) => !i.pull_request)
    .filter((i) => matchesScope(i.labels, scopeLabels));
  let last = "1970-01-01T00:00:00Z";
  for (const i of filtered) if (i.updated_at > last) last = i.updated_at;
  return last;
}

function grepRefsFromCode(grepPatterns, sourceDirs) {
  const refs = [];
  const root = repoRoot();
  for (const dir of sourceDirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    let stdout;
    try {
      stdout = execSync(
        `rg --no-heading --line-number --no-filename -- '' ${JSON.stringify(abs)}`,
        { stdio: ["ignore", "pipe", "ignore"] },
      ).toString();
    } catch {
      try {
        stdout = execSync(`grep -rh '' ${JSON.stringify(abs)}`, {
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
      } catch {
        continue;
      }
    }
    for (const re of grepPatterns) {
      const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = r.exec(stdout)) !== null) {
        refs.push({ name: m[1], sha: m[2] ?? null });
      }
    }
  }
  return refs;
}

async function main() {
  const args = process.argv.slice(2);
  const skipGrep = args.includes("--skip-grep");

  const config = await loadConfig();
  const snapshot = readSnapshot();

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN or GH_TOKEN env var required");
    process.exit(1);
  }
  const octokit = new Octokit({ auth: token });

  const remoteLast = await fetchLastUpdated(
    octokit,
    config.owner,
    config.repo,
    config.scopeLabels,
  );
  if (remoteLast !== snapshot.issues_last_updated_at) {
    console.error(
      `snapshot drift detected:\n  snapshot: ${snapshot.issues_last_updated_at}\n  remote:   ${remoteLast}`,
    );
    console.error("rerun: npx dev-plans-snapshot build && git add manifests/");
    process.exit(1);
  }
  console.error(`OK: snapshot up-to-date (${remoteLast})`);

  if (skipGrep || config.grepPatterns.length === 0) {
    console.error("OK: code grep skipped (no patterns or --skip-grep)");
    return;
  }

  const refs = grepRefsFromCode(config.grepPatterns, config.sourceDirs);
  const byName = new Map();
  for (const f of snapshot.flags) {
    if (!byName.has(f.id)) byName.set(f.id, []);
    byName.get(f.id).push(f);
  }
  const removedKeys = new Set(
    snapshot.flags.filter((f) => f.stage === "removed").map((f) => `${f.id}#${f.sha}`),
  );

  const errors = [];
  for (const ref of refs) {
    const entries = byName.get(ref.name);
    const refLabel = ref.sha ? `${ref.name}#${ref.sha}` : ref.name;
    if (!entries) {
      errors.push(
        `unregistered flag: ${refLabel} (no plan issue with id="${ref.name}" found in snapshot)`,
      );
      continue;
    }
    if (ref.sha === null) {
      continue;
    }
    const matched = entries.find((e) => e.sha === ref.sha);
    if (!matched) {
      const known = entries.map((e) => e.sha).join(", ");
      errors.push(
        `stale sha: ${refLabel} — known sha(s) for "${ref.name}": [${known}]. regenerate snapshot or update code reference.`,
      );
      continue;
    }
    if (removedKeys.has(`${ref.name}#${ref.sha}`)) {
      errors.push(`removed flag still referenced: ${refLabel} (stage:removed)`);
    }
  }

  if (errors.length > 0) {
    console.error("flag reference check failed:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.error(`OK: ${refs.length} flag references match snapshot`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
