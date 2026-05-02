import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const DEFAULTS = {
  owner: "ippoan",
  repo: "ippoan-dev-plans",
  scopeLabels: null,
  grepPatterns: [],
  sourceDirs: ["src", "app", "crates", "server", "components", "composables", "pages"],
};

export function repoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return process.cwd();
  }
}

export async function loadConfig() {
  const root = repoRoot();
  const candidates = [
    path.join(root, "dev-plans.config.js"),
    path.join(root, "dev-plans.config.mjs"),
  ];

  let userConfig = {};
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const mod = await import(pathToFileURL(p).href);
      userConfig = mod.default ?? mod;
      break;
    }
  }

  if (process.env.SCOPE_LABELS) {
    userConfig = {
      ...userConfig,
      scopeLabels: process.env.SCOPE_LABELS.split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }
  if (process.env.PLANS_OWNER) userConfig = { ...userConfig, owner: process.env.PLANS_OWNER };
  if (process.env.PLANS_REPO) userConfig = { ...userConfig, repo: process.env.PLANS_REPO };

  const merged = { ...DEFAULTS, ...userConfig };
  merged.grepPatterns = (merged.grepPatterns ?? []).map((p) =>
    p instanceof RegExp ? p : new RegExp(p, "g"),
  );
  return merged;
}
