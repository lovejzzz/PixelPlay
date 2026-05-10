#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #3 — Room-type detection in extractScene.
 *
 * Imports `extractSceneRaw` directly from the pure mjs module the route
 * uses. Runs against 5 sample prompts with a real gpt-4o-mini call
 * (~$0.001 total). Asserts:
 *   1. ROOM_TYPES enum has all 22 expected entries
 *   2. heuristicRoomType() correctly handles obvious keyword cases
 *   3. extractSceneRaw with no key returns heuristic roomType + empty items
 *   4. extractSceneRaw with a real key returns:
 *      - context in the valid enum
 *      - roomType in the valid enum
 *      - roomType is plausible for the given prompt
 *      - items array is non-empty (the LLM also picks items)
 */
import fs from "node:fs";
import path from "node:path";
import { extractSceneRaw, heuristicRoomType, ROOM_TYPES, CONTEXTS } from "../app/lib/extractScene.mjs";

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

// Test 1: ROOM_TYPES enum integrity.
const expectedRoomTypes = [
  "bedroom", "kitchen", "bathroom", "living-room", "office", "workshop",
  "shop", "tavern", "potion-shop", "blacksmith-forge", "wizard-study",
  "forest", "meadow", "desert", "beach", "mountain", "graveyard",
  "village", "garden", "underwater", "dungeon", "cave", "other",
];
if (ROOM_TYPES.length !== expectedRoomTypes.length) {
  failures.push(`ROOM_TYPES length ${ROOM_TYPES.length}, expected ${expectedRoomTypes.length}`);
}
for (const t of expectedRoomTypes) {
  if (!ROOM_TYPES.includes(t)) failures.push(`missing room type: ${t}`);
}
if (!CONTEXTS.includes("interior") || !CONTEXTS.includes("exterior") || !CONTEXTS.includes("aerial")) {
  failures.push(`CONTEXTS missing one of interior/exterior/aerial`);
}

// Test 2: heuristic on obvious cases.
const HEURISTIC_CASES = [
  ["a cozy bedroom", "bedroom"],
  ["a wizard's potion shop", "potion-shop"],
  ["a cabin in the forest", "forest"],
  ["a desert oasis with palm trees", "desert"],
  ["a snowy mountain peak", "mountain"],
  ["a haunted graveyard at night", "graveyard"],
  ["a medieval blacksmith forge", "blacksmith-forge"],
  ["a dungeon entrance", "dungeon"],
];
for (const [input, expected] of HEURISTIC_CASES) {
  const got = heuristicRoomType(input);
  if (got !== expected) {
    failures.push(`heuristicRoomType("${input}") = "${got}", expected "${expected}"`);
  }
}

// Test 3: extractSceneRaw with no key — returns heuristic roomType + empty items.
{
  const got = await extractSceneRaw("", "a cozy bedroom");
  if (got.roomType !== "bedroom") {
    failures.push(`no-key extractSceneRaw roomType = "${got.roomType}", expected "bedroom"`);
  }
  if (got.items.length !== 0) {
    failures.push(`no-key extractSceneRaw items not empty: ${JSON.stringify(got.items)}`);
  }
}

// Test 4: extractSceneRaw with real key — plausible for 5 sample prompts.
const SAMPLES = [
  { prompt: "a cozy bedroom", expectedRoom: new Set(["bedroom"]), expectedContext: "interior" },
  { prompt: "a wizard's potion shop", expectedRoom: new Set(["potion-shop", "wizard-study"]), expectedContext: "interior" },
  { prompt: "a cabin in the forest", expectedRoom: new Set(["forest"]), expectedContext: "exterior" },
  { prompt: "a desert oasis", expectedRoom: new Set(["desert"]), expectedContext: "exterior" },
  { prompt: "a top-down view of a small town", expectedRoom: new Set(["village", "other"]), expectedContext: "aerial" },
];
if (!API_KEY) {
  console.log("(skip real-key test — no OPENAI_API_KEY)");
} else {
  for (const s of SAMPLES) {
    const t0 = Date.now();
    let got;
    try {
      got = await extractSceneRaw(API_KEY, s.prompt);
    } catch (err) {
      failures.push(`real-key "${s.prompt}" threw: ${err.message}`);
      continue;
    }
    const elapsed = Date.now() - t0;
    if (!CONTEXTS.includes(got.context)) {
      failures.push(`real-key "${s.prompt}" context "${got.context}" out of enum`);
    }
    if (!ROOM_TYPES.includes(got.roomType)) {
      failures.push(`real-key "${s.prompt}" roomType "${got.roomType}" out of enum`);
    }
    if (!s.expectedRoom.has(got.roomType)) {
      failures.push(`real-key "${s.prompt}" roomType "${got.roomType}" implausible (expected one of ${[...s.expectedRoom].join("|")})`);
    }
    if (got.context !== s.expectedContext) {
      failures.push(`real-key "${s.prompt}" context "${got.context}" vs expected "${s.expectedContext}"`);
    }
    if (got.items.length === 0) {
      failures.push(`real-key "${s.prompt}" returned no items`);
    }
    console.log(`  "${s.prompt}" → context=${got.context}, roomType=${got.roomType}, items=${got.items.length} (${elapsed}ms)`);
  }
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
