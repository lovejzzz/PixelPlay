#!/usr/bin/env node
/**
 * Phase 15 fire #3 — Fix stale-closure in enrichers.
 *
 * Imports the same `freshAsset(closure, override, id)` helper that the
 * React enrichers (embedAssets, classifyAssets, analyzeBoundsForAssets,
 * anchorAssets) now use to resolve asset records. Reproduces the
 * stale-closure scenario with simple JS objects and asserts:
 *
 * 1. Override wins for keys it owns (the fix).
 * 2. Closure used for keys not in override (degenerate cases).
 * 3. No override → closure-only lookup (legacy editAssetInline path).
 * 4. Empty override → degenerates to closure read (defensive).
 * 5. Missing key in both → undefined (no phantom values).
 * 6. Falsy id (empty string, null) → undefined (input validation).
 *
 * The 4 React enrichers' samples-building loops use this helper as
 * their first call, so verifying its precedence is functionally
 * equivalent to verifying the bug fix at the source of the bug.
 */
import { freshAsset } from "../app/lib/freshAsset.mjs";

const failures = [];

// Setup: a stale closure (mimicking the pre-setAssets React state)
// and a fresh override (mimicking the `updates` parameter).
const staleClosure = {
  "asset-old-1": { id: "asset-old-1", name: "OldAlpha", prompt: "old alpha" },
  "asset-old-2": { id: "asset-old-2", name: "OldBeta",  prompt: "old beta"  },
};
const freshOverride = {
  "asset-new-1": { id: "asset-new-1", name: "NewGamma", prompt: "new gamma" },
  "asset-old-1": { id: "asset-old-1", name: "OldAlphaUPDATED", prompt: "old alpha updated" },
};

// 1. Override wins for keys it owns.
{
  const got = freshAsset(staleClosure, freshOverride, "asset-new-1");
  if (!got || got.name !== "NewGamma") {
    failures.push(`1: expected NewGamma, got ${JSON.stringify(got)}`);
  }
}
{
  // Key in BOTH: override wins.
  const got = freshAsset(staleClosure, freshOverride, "asset-old-1");
  if (!got || got.name !== "OldAlphaUPDATED") {
    failures.push(`1b: expected OldAlphaUPDATED, got ${JSON.stringify(got)}`);
  }
}

// 2. Closure used when key is only in closure.
{
  const got = freshAsset(staleClosure, freshOverride, "asset-old-2");
  if (!got || got.name !== "OldBeta") {
    failures.push(`2: expected OldBeta from closure, got ${JSON.stringify(got)}`);
  }
}

// 3. No override → pure closure read (legacy editAssetInline path).
{
  const got = freshAsset(staleClosure, undefined, "asset-old-2");
  if (!got || got.name !== "OldBeta") {
    failures.push(`3: no-override expected OldBeta, got ${JSON.stringify(got)}`);
  }
}
{
  // And the stale closure misses fresh ids — this IS the bug repro.
  const got = freshAsset(staleClosure, undefined, "asset-new-1");
  if (got !== undefined) {
    failures.push(`3b: stale closure should miss new id, got ${JSON.stringify(got)}`);
  }
}

// 4. Empty override → falls through to closure.
{
  const got = freshAsset(staleClosure, {}, "asset-old-1");
  if (!got || got.name !== "OldAlpha") {
    failures.push(`4: empty-override expected OldAlpha from closure, got ${JSON.stringify(got)}`);
  }
}

// 5. Missing key in both → undefined.
{
  const got = freshAsset(staleClosure, freshOverride, "asset-missing");
  if (got !== undefined) {
    failures.push(`5: missing key expected undefined, got ${JSON.stringify(got)}`);
  }
}

// 6. Falsy id → undefined.
{
  if (freshAsset(staleClosure, freshOverride, "") !== undefined) failures.push(`6a: empty id`);
  if (freshAsset(staleClosure, freshOverride, null) !== undefined) failures.push(`6b: null id`);
  if (freshAsset(staleClosure, freshOverride, undefined) !== undefined) failures.push(`6c: undefined id`);
}

// 7. Defensive: works when closure is null/undefined too.
{
  const got = freshAsset(null, freshOverride, "asset-new-1");
  if (!got || got.name !== "NewGamma") {
    failures.push(`7: null closure + override should still work, got ${JSON.stringify(got)}`);
  }
}

// 8. Bug reproduction: without override, the bulk-creation samples-
//    builder pattern silently skips new ids. With override, every
//    new id makes it into the samples array.
{
  const newIds = ["asset-new-1", "asset-old-2"];

  // Buggy (closure-only) — only old-2 makes it.
  const buggySamples = newIds
    .map((id) => freshAsset(staleClosure, undefined, id))
    .filter(Boolean);
  if (buggySamples.length !== 1) failures.push(`8a: buggy expected 1 sample, got ${buggySamples.length}`);

  // Fixed (with override) — both make it.
  const fixedSamples = newIds
    .map((id) => freshAsset(staleClosure, freshOverride, id))
    .filter(Boolean);
  if (fixedSamples.length !== 2) failures.push(`8b: fixed expected 2 samples, got ${fixedSamples.length}`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS — freshAsset precedence + bug-repro all correct");
