#!/usr/bin/env node
/**
 * Phase 15 fire #4 — Extract types → app/types.ts.
 *
 * TypeScript types are erased at runtime, so a Node test can't import
 * them. Instead, this test verifies the structural-cleanup
 * preconditions:
 *  1. The new app/types.ts file exists.
 *  2. It declares `export type X` for each name the roadmap called out.
 *  3. app/page.tsx imports the extracted types from "./types" (not
 *     re-declares them).
 *  4. The total line count of page.tsx went DOWN by at least 100 lines
 *     vs the pre-extraction baseline of 9,697 — a sanity check that
 *     the extraction actually happened.
 *
 * Build-time verification is delegated to `npx tsc --noEmit` and the
 * all-tests suite (run by the cron after this script).
 */
import fs from "node:fs";
import path from "node:path";

const failures = [];

// 1. The new file exists.
const typesPath = path.join(process.cwd(), "app/types.ts");
if (!fs.existsSync(typesPath)) {
  console.error("FAIL: app/types.ts does not exist");
  process.exit(1);
}
const typesSrc = fs.readFileSync(typesPath, "utf8");

// 2. Required exports.
const REQUIRED = [
  "AssetType", "Perspective", "Pose", "Quality", "Mode", "StylePreset", "GenMode",
  "Asset", "ProjectStyle", "Recipe",
  "SceneItem", "TileLayer", "TileGrid", "Scene",
  "Prefab", "Project",
];
for (const name of REQUIRED) {
  const re = new RegExp(`export\\s+type\\s+${name}\\b`);
  if (!re.test(typesSrc)) {
    failures.push(`missing "export type ${name}" in app/types.ts`);
  }
}

// 3. page.tsx imports from ./types.
const pagePath = path.join(process.cwd(), "app/page.tsx");
const pageSrc = fs.readFileSync(pagePath, "utf8");
if (!/import\s+type\s+\{[\s\S]*?\}\s+from\s+["']\.\/types["']/.test(pageSrc)) {
  failures.push(`app/page.tsx is missing the import-type block from "./types"`);
}

// 3b. None of the extracted types are STILL declared locally in page.tsx.
const SHOULD_NOT_BE_LOCAL = ["Asset", "Scene", "SceneItem", "Project", "Prefab", "TileLayer", "TileGrid", "Recipe", "ProjectStyle"];
for (const name of SHOULD_NOT_BE_LOCAL) {
  const re = new RegExp(`^type\\s+${name}\\s*=`, "m");
  if (re.test(pageSrc)) {
    failures.push(`"type ${name} = ..." still declared locally in page.tsx`);
  }
}

// 4. page.tsx got smaller.
const pageLines = pageSrc.split("\n").length;
const BASELINE = 9697;
const MIN_REDUCTION = 100;
if (pageLines > BASELINE - MIN_REDUCTION) {
  failures.push(
    `page.tsx is ${pageLines} lines, expected ≤ ${BASELINE - MIN_REDUCTION} (baseline ${BASELINE} - reduction ${MIN_REDUCTION})`
  );
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log(`PASS — app/types.ts exports ${REQUIRED.length} types, page.tsx down to ${pageLines} lines (was ${BASELINE})`);
