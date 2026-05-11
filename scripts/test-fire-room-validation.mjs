#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #6 — Item-room validation badge.
 *
 * Builds a small mock scene + assets map and verifies the validator
 * flags items whose category doesn't belong in the scene's roomType,
 * AND doesn't flag the matching ones / missing-info items.
 */
import { getUnusualItemIds, getUnusualItemCount } from "../app/lib/sceneValidation.mjs";

const failures = [];

const bedroomScene = {
  roomType: "bedroom",
  items: [
    { id: "bed",        assetId: "ast-bed" },     // bedding — OK
    { id: "lamp",       assetId: "ast-lamp" },    // lighting — OK
    { id: "sword",      assetId: "ast-sword" },   // weapon — flag
    { id: "skillet",    assetId: "ast-skillet" }, // kitchen — flag
    { id: "book",       assetId: "ast-book" },    // book — OK
    { id: "no-asset",   assetId: "ast-missing" }, // unknown asset — skip
    { id: "no-cat-ast", assetId: "ast-nocat" },   // asset has no category — skip
    { id: "light-kind", kind: "light", light: { radius: 10, color: "#fff", intensity: 1 } }, // skip
    { id: "trigger",    kind: "trigger" },        // skip
  ],
};

const assets = {
  "ast-bed":     { category: "bedding" },
  "ast-lamp":    { category: "lighting" },
  "ast-sword":   { category: "weapon" },
  "ast-skillet": { category: "kitchen" },
  "ast-book":    { category: "book" },
  "ast-nocat":   {}, // no category set
  // ast-missing: not in the assets map at all
};

const ids = getUnusualItemIds(bedroomScene, assets);
const expected = new Set(["sword", "skillet"]);

if (ids.size !== expected.size) {
  failures.push(`expected ${expected.size} unusual items, got ${ids.size} (${[...ids].join(",")})`);
}
for (const id of expected) {
  if (!ids.has(id)) failures.push(`expected "${id}" to be flagged`);
}
for (const id of ids) {
  if (!expected.has(id)) failures.push(`unexpected flag on "${id}"`);
}
if (getUnusualItemCount(bedroomScene, assets) !== expected.size) {
  failures.push(`getUnusualItemCount mismatch`);
}

// Scene with no roomType — should never flag.
const legacyScene = {
  items: [{ id: "x", assetId: "ast-sword" }],
};
if (getUnusualItemIds(legacyScene, assets).size !== 0) {
  failures.push(`legacy scene without roomType should flag nothing`);
}

// Scene with unknown roomType — predicate is defensive → no flags.
const unknownRoomScene = {
  roomType: "made-up-room",
  items: [{ id: "x", assetId: "ast-sword" }],
};
if (getUnusualItemIds(unknownRoomScene, assets).size !== 0) {
  failures.push(`unknown roomType should flag nothing`);
}

// Empty scene.
if (getUnusualItemIds({ roomType: "bedroom", items: [] }, assets).size !== 0) {
  failures.push(`empty scene should flag nothing`);
}

// Kitchen scene — flips: kitchen item OK, bedding flagged.
const kitchenScene = {
  roomType: "kitchen",
  items: [
    { id: "skillet", assetId: "ast-skillet" }, // kitchen — OK
    { id: "bed",     assetId: "ast-bed" },     // bedding — flag
  ],
};
const kitchenFlags = getUnusualItemIds(kitchenScene, assets);
if (kitchenFlags.size !== 1 || !kitchenFlags.has("bed")) {
  failures.push(`kitchen: expected only "bed" flagged, got ${[...kitchenFlags].join(",")}`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
