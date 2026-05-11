#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #4 — Room-type category whitelist.
 *
 * Verifies the data is well-formed against the live ROOM_TYPES and
 * CATEGORIES enums (catches drift if either is later extended without
 * updating the whitelist) and spot-checks the `isAcceptableInRoom`
 * predicate against intuitively correct cases.
 *
 * No API calls — pure data validation.
 */
import { ROOM_CATEGORIES, isAcceptableInRoom } from "../app/lib/roomCategories.mjs";
import { ROOM_TYPES } from "../app/lib/extractScene.mjs";
import { CATEGORIES } from "../app/lib/classify.mjs";

const failures = [];
const CATEGORY_SET = new Set(CATEGORIES);

// 1. Every room type has an entry in ROOM_CATEGORIES.
for (const t of ROOM_TYPES) {
  if (!Object.prototype.hasOwnProperty.call(ROOM_CATEGORIES, t)) {
    failures.push(`missing ROOM_CATEGORIES entry for room type "${t}"`);
  }
}

// 2. Every entry's category list refers to valid CATEGORIES.
for (const [room, cats] of Object.entries(ROOM_CATEGORIES)) {
  if (!Array.isArray(cats)) {
    failures.push(`ROOM_CATEGORIES["${room}"] is not an array`);
    continue;
  }
  for (const c of cats) {
    if (!CATEGORY_SET.has(c)) {
      failures.push(`unknown category "${c}" listed under room "${room}"`);
    }
  }
}

// 3. No orphan keys (room types not in ROOM_TYPES).
const ROOM_TYPE_SET = new Set(ROOM_TYPES);
for (const key of Object.keys(ROOM_CATEGORIES)) {
  if (!ROOM_TYPE_SET.has(key)) {
    failures.push(`orphan ROOM_CATEGORIES key "${key}" not in ROOM_TYPES`);
  }
}

// 4. "other" accepts every category (catch-all).
for (const c of CATEGORIES) {
  if (c === "other") continue;
  if (!ROOM_CATEGORIES.other.includes(c)) {
    failures.push(`"other" room missing category "${c}"`);
  }
}

// 5. Spot-check predicate matches intuition.
const POSITIVE = [
  ["bedding", "bedroom"],
  ["lighting", "bedroom"],
  ["kitchen", "kitchen"],
  ["food", "kitchen"],
  ["tool", "workshop"],
  ["weapon", "blacksmith-forge"],
  ["book", "wizard-study"],
  ["plant", "forest"],
  ["plant", "garden"],
  ["art", "graveyard"],
  ["weapon", "dungeon"],
  ["food", "tavern"],
  ["container", "potion-shop"],
];
for (const [c, r] of POSITIVE) {
  if (!isAcceptableInRoom(c, r)) {
    failures.push(`expected isAcceptableInRoom("${c}", "${r}") to be true`);
  }
}

const NEGATIVE = [
  ["bedding", "blacksmith-forge"],
  ["bedding", "kitchen"],
  ["kitchen", "wizard-study"],
  ["vehicle", "bathroom"],
  ["toy", "graveyard"],
];
for (const [c, r] of NEGATIVE) {
  if (isAcceptableInRoom(c, r)) {
    failures.push(`expected isAcceptableInRoom("${c}", "${r}") to be FALSE`);
  }
}

// 6. Defensive: unknown room or category returns true.
if (!isAcceptableInRoom("bedding", "made-up-room")) {
  failures.push("unknown roomType should default to acceptable");
}
if (!isAcceptableInRoom("", "bedroom")) {
  failures.push("empty category should default to acceptable");
}
if (!isAcceptableInRoom("bedding", "")) {
  failures.push("empty roomType should default to acceptable");
}
if (!isAcceptableInRoom("made-up-cat", "bedroom")) {
  failures.push("unknown category in known room: predicate should NOT flag as unusual when category itself is unknown — but our impl filters by list membership which says false. Adjust expectations if implementation differs.");
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
console.log(`(verified ${ROOM_TYPES.length} room types × ${CATEGORIES.length} categories)`);
