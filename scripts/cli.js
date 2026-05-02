#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cmd = process.argv[2];

if (cmd === "build") {
  await import(path.join(here, "build-snapshot.js"));
} else if (cmd === "check") {
  await import(path.join(here, "check-snapshot.js"));
} else {
  console.error("Usage: dev-plans-snapshot <build|check> [--skip-grep]");
  console.error("");
  console.error("  build  Fetch plan issues and write manifests/production.snapshot.json");
  console.error("  check  Validate snapshot against remote + verify code 'if_flag!(\"name#sha\")' refs");
  process.exit(2);
}
