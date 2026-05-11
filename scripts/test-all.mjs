#!/usr/bin/env node
/**
 * Pixel Play — all-tests runner (Phase 15 fire #1).
 *
 * Discovers every `scripts/test-fire-*.mjs` file, runs each in
 * sequence in its own Node subprocess, captures exit code + duration
 * + stderr, and prints a green/red summary. Exits non-zero on any
 * failure so the cron prompt's "before commit" gate can rely on a
 * single command to confirm the whole suite still passes.
 *
 * What's deliberately NOT included:
 *  - `scripts/test-refine.mjs` — legacy continuous-probe that picks
 *    random scenarios and pings real OpenAI. Different invariants
 *    (it's allowed to fail), separate purpose. Don't lump it in.
 *  - Tests that don't follow the `test-fire-*` naming convention
 *    are ignored — keeps the runner honest and avoids surprises.
 *
 * Usage:
 *   node scripts/test-all.mjs
 *   node scripts/test-all.mjs --quiet     # only summary, no per-line
 *   node scripts/test-all.mjs --filter X  # only files containing X
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const filterIdx = args.indexOf("--filter");
const filter = filterIdx >= 0 ? args[filterIdx + 1] || "" : "";

const SCRIPTS_DIR = path.join(process.cwd(), "scripts");
if (!fs.existsSync(SCRIPTS_DIR)) {
  console.error(`FAIL: scripts directory not found at ${SCRIPTS_DIR}`);
  process.exit(2);
}

let files = fs
  .readdirSync(SCRIPTS_DIR)
  .filter((f) => f.startsWith("test-fire-") && f.endsWith(".mjs"));
if (filter) files = files.filter((f) => f.includes(filter));
files.sort();

if (files.length === 0) {
  console.log("No test-fire-*.mjs files found" + (filter ? ` matching "${filter}"` : "") + ".");
  process.exit(0);
}

if (!quiet) {
  console.log(`Running ${files.length} test${files.length === 1 ? "" : "s"}...\n`);
}

const totalStart = Date.now();
const results = [];
for (const file of files) {
  const full = path.join(SCRIPTS_DIR, file);
  const t0 = Date.now();
  const r = await runTest(full);
  const elapsed = Date.now() - t0;
  results.push({ file, code: r.code, elapsed, stdout: r.stdout, stderr: r.stderr });
  if (!quiet) {
    const status = r.code === 0 ? "✓ PASS" : "✗ FAIL";
    process.stdout.write(`${status}  ${file.padEnd(40)}  ${elapsed}ms\n`);
  }
}
const totalElapsed = Date.now() - totalStart;

const passed = results.filter((r) => r.code === 0).length;
const failed = results.length - passed;

if (failed > 0) {
  // Print stderr / last lines of stdout for each failure so the cron
  // operator can see what went wrong without a separate re-run.
  console.log("");
  for (const r of results) {
    if (r.code === 0) continue;
    console.log(`--- ${r.file} (exit ${r.code}) ---`);
    const lines = (r.stderr.trim() || r.stdout.trim()).split("\n").slice(-12);
    for (const line of lines) console.log("  " + line);
  }
}

const summary = `\n${passed}/${results.length} PASS${failed > 0 ? `, ${failed} FAIL` : ""} in ${totalElapsed}ms`;
console.log(summary);
process.exit(failed > 0 ? 1 : 0);

/** Run a single test file in its own Node subprocess. Captures stdout
 *  + stderr so the parent can surface details on failure. */
function runTest(filePath) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("node", [filePath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on("error", () => resolve({ code: 1, stdout, stderr }));
  });
}
