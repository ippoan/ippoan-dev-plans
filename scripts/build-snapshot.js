#!/usr/bin/env node
/**
 * build-snapshot.js
 *
 * GitHub API から `label:plan` の Issue を全 fetch し、
 * 本文中の ```yaml ... ``` block を flag 定義として抽出して
 * `manifests/production.snapshot.json` を生成する。
 *
 * Usage:
 *   GITHUB_TOKEN=xxx node build-snapshot.js [--owner <org>] [--repo <name>]
 *
 * これは「雛形」。consumer repo にコピーして使うときは:
 * - owner/repo を実際の plan 集約 repo (ippoan/ippoan-dev-plans) に固定
 * - manifests/ の出力先を必要に応じて変更
 */

import { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = { owner: "ippoan", repo: "ippoan-dev-plans" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--owner") out.owner = argv[++i];
    else if (argv[i] === "--repo") out.repo = argv[++i];
  }
  return out;
}

function extractYamlBlock(body) {
  if (!body) return null;
  const m = body.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
  if (!m) return null;
  try {
    return parseYaml(m[1]);
  } catch (err) {
    console.error(`[warn] yaml parse failed: ${err.message}`);
    return null;
  }
}

function pickStage(labels) {
  const stages = labels
    .map((l) => l.name)
    .filter((n) => n.startsWith("stage:"))
    .map((n) => n.slice("stage:".length));
  return stages[0] ?? "proposed";
}

function pickScope(labels) {
  return labels
    .map((l) => l.name)
    .filter((n) => n.startsWith("scope:"))
    .map((n) => n.slice("scope:".length));
}

async function main() {
  const { owner, repo } = parseArgs(process.argv);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error("GITHUB_TOKEN or GH_TOKEN env var required");
    process.exit(1);
  }
  const octokit = new Octokit({ auth: token });

  console.error(`Fetching plan issues from ${owner}/${repo}...`);
  const issues = await octokit.paginate(octokit.issues.listForRepo, {
    owner,
    repo,
    labels: "plan",
    state: "all",
    per_page: 100,
  });
  // PR を除外 (listForRepo は PR を含む)
  const planIssues = issues.filter((i) => !i.pull_request);
  console.error(`Found ${planIssues.length} plan issues`);

  const flags = [];
  let lastUpdated = "1970-01-01T00:00:00Z";

  for (const issue of planIssues) {
    if (issue.updated_at > lastUpdated) lastUpdated = issue.updated_at;

    const def = extractYamlBlock(issue.body);
    if (!def || typeof def !== "object" || !def.id) {
      // yaml block 無し or id 欠如 → flag 定義としては記録しない (Issue 自体は last_updated に反映済)
      continue;
    }
    flags.push({
      id: def.id,
      plan_id: def.plan_id ?? null,
      stage: pickStage(issue.labels),
      scope: pickScope(issue.labels),
      owner: def.owner ?? null,
      default_value: def.default_value ?? false,
      rollout: def.rollout ?? {},
      expires_at: def.expires_at ?? null,
      source_issue: issue.number,
      issue_state: issue.state,
    });
  }

  flags.sort((a, b) => a.id.localeCompare(b.id));

  const snapshot = {
    generated_at: new Date().toISOString(),
    issues_last_updated_at: lastUpdated,
    source: { owner, repo },
    flags,
  };

  const outPath = path.join(REPO_ROOT, "manifests", "production.snapshot.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.error(`Wrote ${outPath} (${flags.length} flags, last_updated=${lastUpdated})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
