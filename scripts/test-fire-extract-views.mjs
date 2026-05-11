#!/usr/bin/env node
/**
 * Phase 15 fire #7 — Extract scene/asset views → app/components/views/.
 *
 * Bounded version of the original roadmap item: pulled 4 of the 6
 * named components (ProjectSwitcher, RecipesView, ProjectStyleSection,
 * PrefabLibrary). SceneHierarchy + AssetCard deferred to a follow-up
 * fire because each is 200+ lines with many callback props — risky to
 * extract in a single fire's budget.
 *
 * Verifies:
 *  1. 4 view files exist in app/components/views/.
 *  2. Each exports a function with the expected name.
 *  3. page.tsx imports each from its new location.
 *  4. No top-level `function <Name>(` declarations remain in page.tsx
 *     for any of the four.
 *  5. page.tsx shrunk vs the post-fire-#90 baseline of 8,351 lines.
 */
import fs from "node:fs";
import path from "node:path";

const failures = [];
const viewsDir = path.join(process.cwd(), "app/components/views");

const VIEWS = [
  "ProjectSwitcher",
  "RecipesView",
  "ProjectStyleSection",
  "PrefabLibrary",
];

for (const name of VIEWS) {
  const p = path.join(viewsDir, `${name}.tsx`);
  if (!fs.existsSync(p)) {
    failures.push(`missing file: app/components/views/${name}.tsx`);
    continue;
  }
  const src = fs.readFileSync(p, "utf8");
  if (!new RegExp(`export\\s+function\\s+${name}\\b`).test(src)) {
    failures.push(`missing "export function ${name}" in ${name}.tsx`);
  }
}

const pagePath = path.join(process.cwd(), "app/page.tsx");
const pageSrc = fs.readFileSync(pagePath, "utf8");

for (const name of VIEWS) {
  const importRe = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s+from\\s+["']\\./components/views/${name}["']`);
  if (!importRe.test(pageSrc)) {
    failures.push(`page.tsx missing import { ${name} } from "./components/views/${name}"`);
  }
  const localRe = new RegExp(`^function\\s+${name}\\(`, "m");
  if (localRe.test(pageSrc)) {
    failures.push(`"function ${name}(" still declared at module scope in page.tsx`);
  }
}

const pageLines = pageSrc.split("\n").length;
const BASELINE = 8351;
const MIN_REDUCTION = 300;
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
console.log(`PASS — ${VIEWS.length} views extracted, page.tsx down to ${pageLines} lines (was ${BASELINE})`);
