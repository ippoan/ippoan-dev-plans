#!/usr/bin/env node
/**
 * check-snapshot.js
 *
 * 1. snapshot drift 検出: GitHub API 上の最新 updated_at と
 *    manifests/production.snapshot.json の issues_last_updated_at を比較
 * 2. flag 漏れ検出 (consumer repo 用): コードを grep して flag 名を抽出 →
 *    snapshot に存在しない flag があれば exit 1
 * 3. removed flag の参照検出: snapshot 内 stage:removed の flag を
 *    コードがまだ参照していたら exit 1
 *
 * Usage:
 *   GITHUB_TOKEN=xxx node check-snapshot.js [--owner X] [--repo Y] [--skip-grep]
 *
 * これは「雛形」。consumer repo にコピーして使うときは:
 * - GREP_PATTERNS を実際の言語 (Rust の if_flag!() / Vue の useFeatureFlag()) に合わせて編集
 * - SOURCE_DIRS を src/ や app/ などに合わせて編集
 */

import { Octokit } from "@octokit/rest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// consumer repo で編集する箇所 ↓↓↓
const GREP_PATTERNS = [
  // Rust: if_flag!("xxx") / flag_value!("xxx")
  /\bif_flag!\(\s*"([a-z][a-z0-9_]+)"/g,
  /\bflag_value!\(\s*"([a-z][a-z0-9_]+)"/g,
  // Vue/TS: useFeatureFlag('xxx') / useFeatureFlag("xxx")
  /\buseFeatureFlag\(\s*['"]([a-z][a-z0-9_]+)['"]/g,
];
const SOURCE_DIRS = ["src", "app", "crates", "server"]; // 存在するものだけ scan
// ここまで ↑↑↑

function parseArgs(argv) {
  const out = { owner: "ippoan", repo: "ippoan-dev-plans", skipGrep: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--owner") out.owner = argv[++i];
    else if (argv[i] === "--repo") out.repo = argv[++i];
    else if (argv[i] === "--skip-grep") out.skipGrep = true;
  }
  return out;
}

function readSnapshot() {
  const p = path.join(REPO_ROOT, "manifests", "production.snapshot.json");
  if (!fs.existsSync(p)) {
    console.error(`snapshot not found: ${p}`);
    console.error("run: node scripts/build-snapshot.js");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function fetchLastUpdated(octokit, owner, repo) {
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    labels: "plan",
    state: "all",
    per_page: 100,
  });
  const planIssues = issues.filter((i) => !i.pull_request);
  let last = "1970-01-01T00:00:00Z";
  for (const i of planIssues) if (i.updated_at > last) last = i.updated_at;
  return last;
}

function grepFlagsFromCode() {
  const found = new Set();
  for (const dir of SOURCE_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    let stdout;
    try {
      // ripgrep 優先、なければ grep -r
      stdout = execSync(`rg --no-heading --line-number --no-filename -- '' ${abs}`, {
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
    } catch {
      try {
        stdout = execSync(`grep -rh '' ${abs}`, {
          stdio: ["ignore", "pipe", "ignore"],
        }).toString();
      } catch {
        continue;
      }
    }
    for (const re of GREP_PATTERNS) {
      const r = new RegExp(re.source, re.flags);
      let m;
      while ((m = r.exec(stdout)) !== null) found.add(m[1]);
    }
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv);
  const snapshot = readSnapshot();

  // 1. drift 検出
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN or GH_TOKEN env var required");
    process.exit(1);
  }
  const octokit = new Octokit({ auth: token });
  const remoteLast = await fetchLastUpdated(octokit, args.owner, args.repo);
  if (remoteLast !== snapshot.issues_last_updated_at) {
    console.error(
      `snapshot drift detected:\n  snapshot: ${snapshot.issues_last_updated_at}\n  remote:   ${remoteLast}`
    );
    console.error("rerun: node scripts/build-snapshot.js && git add manifests/");
    process.exit(1);
  }
  console.error(`OK: snapshot up-to-date (${remoteLast})`);

  // 2. & 3. (consumer repo 用) コード grep
  if (args.skipGrep) {
    console.error("skipping code grep (--skip-grep)");
    return;
  }

  const codeFlags = grepFlagsFromCode();
  const snapshotIds = new Set(snapshot.flags.map((f) => f.id));
  const removedIds = new Set(
    snapshot.flags.filter((f) => f.stage === "removed").map((f) => f.id)
  );

  const missing = [...codeFlags].filter((f) => !snapshotIds.has(f));
  const stillReferencedRemoved = [...codeFlags].filter((f) => removedIds.has(f));

  if (missing.length > 0) {
    console.error(`flags referenced in code but missing from snapshot:`);
    missing.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  if (stillReferencedRemoved.length > 0) {
    console.error(`flags marked stage:removed but still referenced in code:`);
    stillReferencedRemoved.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }

  console.error(`OK: ${codeFlags.size} flag references match snapshot`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
