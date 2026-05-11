#!/usr/bin/env node
/**
 * Phase 15 fire #7 — Extract modal components → app/components/modals/.
 *
 * Verifies the structural-cleanup preconditions for the modal
 * extraction:
 *  1. The five modal files exist in app/components/modals/.
 *  2. Each exports a function with the expected name.
 *  3. page.tsx imports each from its new location.
 *  4. No top-level `function <Name>Modal(` declarations remain in
 *     page.tsx for any of the five.
 *  5. page.tsx shrunk vs the post-fire-#89 baseline of 9,013 lines.
 *
 * Behavioral verification is out of scope (React rendering can't be
 * unit-tested from Node without a heavier setup); the regression
 * gate (test-all.mjs) + tsc + next build cover the integration side.
 */
import fs from "node:fs";
import path from "node:path";

const failures = [];
const modalsDir = path.join(process.cwd(), "app/components/modals");

const MODALS = [
  "OnboardingModal",
  "ShortcutsModal",
  "TrashModal",
  "PaletteModal",
  "SettingsModal",
];

for (const name of MODALS) {
  const p = path.join(modalsDir, `${name}.tsx`);
  if (!fs.existsSync(p)) {
    failures.push(`missing file: app/components/modals/${name}.tsx`);
    continue;
  }
  const src = fs.readFileSync(p, "utf8");
  if (!new RegExp(`export\\s+function\\s+${name}\\b`).test(src)) {
    failures.push(`missing "export function ${name}" in ${name}.tsx`);
  }
}

const pagePath = path.join(process.cwd(), "app/page.tsx");
const pageSrc = fs.readFileSync(pagePath, "utf8");

for (const name of MODALS) {
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']\\./components/modals/${name}["']`);
  if (!importRe.test(pageSrc)) {
    failures.push(`page.tsx missing import { ${name} } from "./components/modals/${name}"`);
  }
  const localRe = new RegExp(`^function\\s+${name}\\(`, "m");
  if (localRe.test(pageSrc)) {
    failures.push(`"function ${name}(" still declared at module scope in page.tsx`);
  }
}

const pageLines = pageSrc.split("\n").length;
const BASELINE = 9013;
const MIN_REDUCTION = 500;
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
console.log(`PASS — ${MODALS.length} modals extracted, page.tsx down to ${pageLines} lines (was ${BASELINE})`);
