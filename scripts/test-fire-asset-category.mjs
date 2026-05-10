#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #2 — Asset category labeling.
 *
 * Imports the SAME pure classifier (classifyTexts) the API route uses,
 * runs it with both the heuristic fallback AND a real gpt-4o-mini call
 * (cost ~$0.0003 for the batch), and asserts:
 *   1. CATEGORIES enum is intact
 *   2. heuristicCategory() classifies obvious cases correctly
 *   3. classifyTexts() with NO key returns heuristic labels
 *   4. classifyTexts() with a real key returns valid-enum labels
 *      for 5 sample descriptors AND the labels are plausible
 *
 * Reads OPENAI_API_KEY from .env.local for the real-key test. If the
 * key is missing, the real-key test is skipped (heuristic-only is
 * still validated).
 */
import fs from "node:fs";
import path from "node:path";
import { classifyTexts, heuristicCategory, CATEGORIES } from "../app/lib/classify.mjs";

// --- Env load ---------------------------------------------------------------
const envPath = path.join(process.cwd(), ".env.local");
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";

const failures = [];

// --- Test 1: CATEGORIES integrity ------------------------------------------
const expectedEnum = [
  "bedding", "seating", "table", "storage", "kitchen", "electronics",
  "decor", "clothing", "tool", "book", "food", "plant", "container",
  "lighting", "art", "toy", "weapon", "vehicle", "other",
];
if (CATEGORIES.length !== expectedEnum.length) {
  failures.push(`CATEGORIES length ${CATEGORIES.length}, expected ${expectedEnum.length}`);
}
for (const c of expectedEnum) {
  if (!CATEGORIES.includes(c)) failures.push(`missing category: ${c}`);
}

// --- Test 2: heuristic classification --------------------------------------
const HEURISTIC_CASES = [
  ["a cozy bed with blankets", "bedding"],
  ["a wooden chair", "seating"],
  ["an oak tree", "plant"],
  ["a glowing lamp", "lighting"],
  ["a spell book", "book"],
  ["a metal cauldron", "kitchen"],
  ["a wooden barrel", "container"],
  ["a long sword", "weapon"],
];
for (const [input, expected] of HEURISTIC_CASES) {
  const got = heuristicCategory(input);
  if (got !== expected) {
    failures.push(`heuristic("${input}") = "${got}", expected "${expected}"`);
  }
}

// --- Test 3: classifyTexts with NO key -> heuristic ------------------------
{
  const inputs = HEURISTIC_CASES.map((c) => c[0]);
  const got = await classifyTexts("", inputs);
  if (got.length !== inputs.length) {
    failures.push(`no-key: length mismatch ${got.length} vs ${inputs.length}`);
  }
  for (let i = 0; i < HEURISTIC_CASES.length; i++) {
    if (got[i] !== HEURISTIC_CASES[i][1]) {
      failures.push(`no-key: classifyTexts("${HEURISTIC_CASES[i][0]}") = "${got[i]}", expected "${HEURISTIC_CASES[i][1]}"`);
    }
  }
}

// --- Test 4: classifyTexts with real key -> plausible labels --------------
const SAMPLES = [
  "a cozy bed",
  "a metal fork",
  "a wooden chair",
  "a glowing lantern",
  "an oak tree",
];
const PLAUSIBLE = {
  "a cozy bed": new Set(["bedding"]),
  "a metal fork": new Set(["kitchen", "tool"]),
  "a wooden chair": new Set(["seating"]),
  "a glowing lantern": new Set(["lighting", "electronics"]),
  "an oak tree": new Set(["plant"]),
};
if (!API_KEY) {
  console.log("(skip real-key test — no OPENAI_API_KEY in .env.local)");
} else {
  const t0 = Date.now();
  const got = await classifyTexts(API_KEY, SAMPLES);
  const elapsed = Date.now() - t0;
  if (got.length !== SAMPLES.length) {
    failures.push(`real-key: length mismatch ${got.length} vs ${SAMPLES.length}`);
  }
  for (let i = 0; i < SAMPLES.length; i++) {
    if (!CATEGORIES.includes(got[i])) {
      failures.push(`real-key: out-of-enum "${got[i]}" for "${SAMPLES[i]}"`);
      continue;
    }
    if (!PLAUSIBLE[SAMPLES[i]].has(got[i])) {
      failures.push(`real-key: implausible "${got[i]}" for "${SAMPLES[i]}" (expected one of ${[...PLAUSIBLE[SAMPLES[i]]].join("|")})`);
    }
  }
  console.log(`(real-key call: ${elapsed}ms, returned [${got.join(", ")}])`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
