#!/usr/bin/env node
/**
 * Fetch plan issues from the central repo, extract YAML flag definitions
 * from their bodies, attach a per-flag SHA, and write
 * `<repo-root>/manifests/production.snapshot.json`.
 *
 * Config sources (precedence high→low):
 *   1. env: SCOPE_LABELS, PLANS_OWNER, PLANS_REPO
 *   2. <repo-root>/dev-plans.config.js (default export)
 *   3. built-in defaults (owner=ippoan, repo=ippoan-dev-plans, no scope filter)
 *
 * Auth: GITHUB_TOKEN or GH_TOKEN env var.
 */

import { Octokit } from "@octokit/rest";
import { parse as parseYaml } from "yaml";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadConfig, repoRoot } from "./config.js";

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
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter((n) => n.startsWith("stage:"))
    .map((n) => n.slice("stage:".length));
  return stages[0] ?? "proposed";
}

function pickScope(labels) {
  return labels
    .map((l) => (typeof l === "string" ? l : l.name))
    .filter((n) => n.startsWith("scope:"))
    .map((n) => n.slice("scope:".length));
}

function computeSha(planId, id, sourceIssue) {
  return crypto
    .createHash("sha256")
    .update(`${planId}|${id}|${sourceIssue}`)
    .digest("hex")
    .slice(0, 8);
}

function matchesScope(labels, scopeLabels) {
  if (!scopeLabels || scopeLabels.length === 0) return true;
  const wanted = new Set(scopeLabels.map((s) => `scope:${s}`));
  return labels.some((l) => wanted.has(typeof l === "string" ? l : l.name));
}

async function main() {
  const config = await loadConfig();
  const { owner, repo, scopeLabels } = config;
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
  const planIssues = issues
    .filter((i) => !i.pull_request)
    .filter((i) => matchesScope(i.labels, scopeLabels));
  console.error(
    `Found ${planIssues.length} plan issues (scope filter: ${scopeLabels ? scopeLabels.join(",") : "none"})`,
  );

  const flags = [];
  let lastUpdated = "1970-01-01T00:00:00Z";

  for (const issue of planIssues) {
    if (issue.updated_at > lastUpdated) lastUpdated = issue.updated_at;

    const def = extractYamlBlock(issue.body);
    if (!def || typeof def !== "object" || !def.id) continue;

    const planId = def.plan_id ?? null;
    flags.push({
      id: def.id,
      sha: computeSha(planId, def.id, issue.number),
      plan_id: planId,
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

  flags.sort((a, b) => a.id.localeCompare(b.id) || a.sha.localeCompare(b.sha));

  const snapshot = {
    generated_at: new Date().toISOString(),
    issues_last_updated_at: lastUpdated,
    source: { owner, repo },
    scope_filter: scopeLabels ?? null,
    flags,
  };

  const outPath = path.join(repoRoot(), "manifests", "production.snapshot.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.error(
    `Wrote ${outPath} (${flags.length} flags, last_updated=${lastUpdated})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
