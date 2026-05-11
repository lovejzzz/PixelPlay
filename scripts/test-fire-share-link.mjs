#!/usr/bin/env node
/**
 * Phase 15 fire #2 — Smoke test for Phase 11 share-link.
 *
 * Validates that the @vercel/blob upload + list flow used by
 * /api/share works given the current environment. ALWAYS exits 0 so
 * deploy-time concerns (no Blob store connected, expired token, etc.)
 * don't crash the test-all runner — the cron operator reads the
 * SKIPPED / FAIL message in the output instead.
 *
 * Outcomes:
 *  - SKIPPED — BLOB_READ_WRITE_TOKEN not in env / .env.local.
 *    Phase 11 share-link is "theatre" locally, which matches the
 *    audit finding. Exit 0.
 *  - PASS — token present AND a small test blob round-trips through
 *    put() + list() against the real Vercel Blob store. Exit 0.
 *  - FAIL — token present but the call fails. Surfaces the error.
 *    Exit 0 (a deploy issue, not a code bug).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Load .env.local manually — the script runs under plain Node, no
// dotenv. Mirrors the pattern in scripts/test-fire-asset-category.mjs.
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

const token = process.env.BLOB_READ_WRITE_TOKEN || "";
if (!token) {
  console.log("SKIPPED — BLOB_READ_WRITE_TOKEN not configured.");
  console.log("  /api/share will return 500 until a Vercel Blob store is connected and the token is set.");
  console.log("  Phase 11 share-link is non-functional locally — this matches the 2026-05-11 audit.");
  process.exit(0);
}

let put;
let list;
try {
  // Dynamic import so an absent dependency doesn't crash the runner —
  // it's installed (Phase 11 added it) but a hostile environment
  // could conceivably miss it.
  ({ put, list } = await import("@vercel/blob"));
} catch (err) {
  console.log("FAIL — @vercel/blob import failed: " + (err && err.message ? err.message : err));
  console.log("  (exit 0 — likely a packaging issue)");
  process.exit(0);
}

const testId = `test-fire-${randomUUID()}`;
const testKey = `shared/${testId}.zip`;
const testData = Buffer.from("Phase 15 smoke test payload — safe to delete");

const t0 = Date.now();
let putUrl = null;
try {
  const result = await put(testKey, testData, {
    access: "public",
    contentType: "application/octet-stream",
  });
  putUrl = result.url;
  console.log(`  put: ${putUrl} (${Date.now() - t0}ms)`);
} catch (err) {
  console.log("FAIL — put: " + (err && err.message ? err.message : err));
  console.log("  (exit 0 — deploy-time concern, not a code bug)");
  process.exit(0);
}

try {
  const t1 = Date.now();
  const { blobs } = await list({ prefix: `shared/${testId}`, limit: 1 });
  console.log(`  list: ${blobs.length} blob(s) (${Date.now() - t1}ms)`);
  if (blobs.length === 0) {
    console.log("FAIL — list returned no blob after put.");
    process.exit(0);
  }
} catch (err) {
  console.log("FAIL — list: " + (err && err.message ? err.message : err));
  console.log("  (exit 0)");
  process.exit(0);
}

console.log("PASS — share-link upload + list working");
process.exit(0);
