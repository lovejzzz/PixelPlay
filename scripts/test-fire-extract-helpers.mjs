#!/usr/bin/env node
/**
 * Phase 15 fire #6 — Extract pure helpers → app/lib/sceneHelpers.ts.
 *
 * Verifies:
 *  1. app/lib/sceneHelpers.ts exists.
 *  2. Every expected pure helper is `export`ed.
 *  3. page.tsx imports from "./lib/sceneHelpers".
 *  4. No top-level duplicate declarations remain in page.tsx.
 *  5. page.tsx shrunk vs the post-fire-#88 baseline of 9,400 lines.
 *
 * For the DOM-bound functions (canvas / Image), behavioral verification
 * is out of scope here — the build's success and the regression-gate
 * test-all.mjs both run them implicitly via the page render. The fire
 * test focuses on the extraction's STRUCTURE.
 */
import fs from "node:fs";
import path from "node:path";

const failures = [];

const helpersPath = path.join(process.cwd(), "app/lib/sceneHelpers.ts");
if (!fs.existsSync(helpersPath)) {
  console.error("FAIL: app/lib/sceneHelpers.ts does not exist");
  process.exit(1);
}
const helpersSrc = fs.readFileSync(helpersPath, "utf8");

const REQUIRED = [
  "gridLabel", "emptyStyle", "newProject",
  "defaultSolid", "defaultSolidForName",
  "makeGrassTileDataUrl", "makeWoodFloorTileDataUrl",
  "makeStoneFloorTileDataUrl", "makeDefaultCharacterDataUrl",
  "parseSize", "readFileAsDataUrl", "drawWithFlip", "loadImg",
  "dataUrlToBytes", "slugify", "downscaleImage",
  "promptTokens", "jaccardSim", "detectRecipePattern", "sharedPrefix",
  "autoBackgroundColorForContext",
];
for (const name of REQUIRED) {
  const reFn = new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`);
  if (!reFn.test(helpersSrc)) {
    failures.push(`missing "export function ${name}" in app/lib/sceneHelpers.ts`);
  }
}

const pagePath = path.join(process.cwd(), "app/page.tsx");
const pageSrc = fs.readFileSync(pagePath, "utf8");
if (!/import\s+\{[\s\S]*?\}\s+from\s+["']\.\/lib\/sceneHelpers["']/.test(pageSrc)) {
  failures.push(`app/page.tsx is missing import from "./lib/sceneHelpers"`);
}

const SHOULD_NOT_BE_LOCAL = REQUIRED;
for (const name of SHOULD_NOT_BE_LOCAL) {
  const re = new RegExp(`^(?:async\\s+)?function\\s+${name}\\b`, "m");
  if (re.test(pageSrc)) {
    failures.push(`"function ${name}" still declared at module scope in page.tsx`);
  }
}

const pageLines = pageSrc.split("\n").length;
const BASELINE = 9400;
const MIN_REDUCTION = 200;
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
console.log(`PASS — sceneHelpers.ts exports ${REQUIRED.length} helpers, page.tsx down to ${pageLines} lines (was ${BASELINE})`);
