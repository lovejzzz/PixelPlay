#!/usr/bin/env node
/**
 * Phase 15 fire #5 — Extract constants → app/constants.ts.
 *
 * Pure-data extraction. Verifies:
 *  1. app/constants.ts exists.
 *  2. It exports every name the roadmap called out.
 *  3. page.tsx imports them from "./constants".
 *  4. The duplicate declarations are gone from page.tsx.
 *  5. page.tsx shrunk vs the post-fire-#87 baseline of 9,505 lines.
 */
import fs from "node:fs";
import path from "node:path";

const failures = [];

const cPath = path.join(process.cwd(), "app/constants.ts");
if (!fs.existsSync(cPath)) {
  console.error("FAIL: app/constants.ts does not exist");
  process.exit(1);
}
const cSrc = fs.readFileSync(cPath, "utf8");

// 2. Required exports.
const REQUIRED = [
  "GEN_MODES", "PERSPECTIVES", "POSES", "QUALITIES", "STYLE_PRESETS",
  "VARIANT_OPTIONS", "GRID_PRESETS",
  "EDIT_EXAMPLES",
  "PROJECTS_IDB_KEY", "CURRENT_ID_IDB_KEY", "SCENE_UI_IDB_KEY",
  "LEGACY_ASSETS_LS_KEY", "LEGACY_ASSETS_IDB_KEY", "LEGACY_STYLE_LS_KEY",
  "HISTORY_KEY",
  "PROJECT_MEMORY_CAP", "MAX_HISTORY",
  "BLOCKER_KEYWORDS", "FLOATING_KEYWORDS",
  "ONBOARDING_STEPS",
];
for (const name of REQUIRED) {
  const re = new RegExp(`export\\s+const\\s+${name}\\b`);
  if (!re.test(cSrc)) failures.push(`missing "export const ${name}" in app/constants.ts`);
}

// 3. page.tsx imports them.
const pagePath = path.join(process.cwd(), "app/page.tsx");
const pageSrc = fs.readFileSync(pagePath, "utf8");
if (!/import\s+\{[\s\S]*?\}\s+from\s+["']\.\/constants["']/.test(pageSrc)) {
  failures.push(`app/page.tsx is missing import from "./constants"`);
}

// 4. No duplicate top-level declarations remain in page.tsx for the
//    big-list constants we moved. (Local function-scope const declarations
//    with the same names would be safer to leave alone, so we only check
//    explicit `^const NAME = ` patterns.)
const SHOULD_NOT_BE_LOCAL = [
  "GEN_MODES", "PERSPECTIVES", "POSES", "QUALITIES", "STYLE_PRESETS",
  "VARIANT_OPTIONS", "GRID_PRESETS",
  "EDIT_EXAMPLES",
  "PROJECTS_IDB_KEY", "CURRENT_ID_IDB_KEY", "SCENE_UI_IDB_KEY",
  "LEGACY_ASSETS_LS_KEY", "LEGACY_ASSETS_IDB_KEY", "LEGACY_STYLE_LS_KEY",
  "PROJECT_MEMORY_CAP",
  "BLOCKER_KEYWORDS",
  "ONBOARDING_STEPS",
];
for (const name of SHOULD_NOT_BE_LOCAL) {
  // ^const NAME with leading whitespace = 0 (top-level)
  const re = new RegExp(`^const\\s+${name}(\\s|:|=)`, "m");
  if (re.test(pageSrc)) {
    failures.push(`"const ${name}" still declared at module scope in page.tsx`);
  }
}

// 5. page.tsx shrunk.
const pageLines = pageSrc.split("\n").length;
const BASELINE = 9505;
const MIN_REDUCTION = 60;
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
console.log(`PASS — app/constants.ts exports ${REQUIRED.length} consts, page.tsx down to ${pageLines} lines (was ${BASELINE})`);
