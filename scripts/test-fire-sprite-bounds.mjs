#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #1 — Sprite-bounds analysis.
 *
 * Imports the SAME pure function (analyzeBoundsFromRGBA) the browser
 * wrapper uses. Constructs a synthetic 100×100 RGBA buffer with fully
 * opaque content only in the rectangle (30,40)→(70,80) — i.e. a 40×40
 * red square offset from the canvas edges by varying transparent
 * padding on each side. Runs the analyzer and asserts the returned
 * fractional bounds match the expected bbox within a 1% tolerance.
 *
 * Why this matters: gpt-image-1 returns sprites with unpredictable
 * transparent padding — sometimes 5% on top, sometimes 30%. Without
 * the bounds field, the relation resolver assumes the sprite fills
 * the full image and snaps a "lamp on nightstand" to the IMAGE's top
 * edge instead of the actual nightstand's top edge. This test is the
 * unit-level proof that the analyzer correctly identifies the visible
 * region; the integration (asset has correct bounds after generation)
 * is verified by build + manual playtest.
 */
import { analyzeBoundsFromRGBA } from "../app/lib/spriteBounds.mjs";

const W = 100;
const H = 100;
// Content rectangle (inclusive of left/top, exclusive of right/bottom):
const X0 = 30;
const Y0 = 40;
const X1 = 70;
const Y1 = 80;

const data = new Uint8ClampedArray(W * H * 4);
for (let y = Y0; y < Y1; y++) {
  for (let x = X0; x < X1; x++) {
    const i = (y * W + x) * 4;
    data[i] = 255;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = 255; // fully opaque
  }
}

const bounds = analyzeBoundsFromRGBA(data, W, H);
const expected = { top: Y0 / H, bottom: Y1 / H, left: X0 / W, right: X1 / W };
const tol = 0.01;
const failures = [];
for (const k of ["top", "bottom", "left", "right"]) {
  const diff = Math.abs(bounds[k] - expected[k]);
  if (diff > tol) failures.push(`${k}: got ${bounds[k]}, expected ${expected[k]} (diff ${diff.toFixed(4)})`);
}

// Edge-case 1: fully transparent input → returns full canvas bounds.
const empty = new Uint8ClampedArray(W * H * 4);
const emptyBounds = analyzeBoundsFromRGBA(empty, W, H);
if (
  emptyBounds.top !== 0 ||
  emptyBounds.bottom !== 1 ||
  emptyBounds.left !== 0 ||
  emptyBounds.right !== 1
) {
  failures.push(`empty input expected {0,1,0,1}, got ${JSON.stringify(emptyBounds)}`);
}

// Edge-case 2: alpha threshold ignores low-alpha fringe.
const fringed = new Uint8ClampedArray(W * H * 4);
for (let y = Y0; y < Y1; y++) {
  for (let x = X0; x < X1; x++) {
    const i = (y * W + x) * 4;
    fringed[i] = 255;
    fringed[i + 3] = 255;
  }
}
// Add a 1-pixel ring of alpha=10 around the content (below default threshold of 16).
for (let y = Y0 - 1; y < Y1 + 1; y++) {
  for (let x = X0 - 1; x < X1 + 1; x++) {
    if (y >= Y0 && y < Y1 && x >= X0 && x < X1) continue;
    if (y < 0 || y >= H || x < 0 || x >= W) continue;
    const i = (y * W + x) * 4;
    fringed[i + 3] = 10;
  }
}
const fringedBounds = analyzeBoundsFromRGBA(fringed, W, H);
for (const k of ["top", "bottom", "left", "right"]) {
  const diff = Math.abs(fringedBounds[k] - expected[k]);
  if (diff > tol) failures.push(`fringed-${k}: got ${fringedBounds[k]}, expected ${expected[k]}`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS — bounds:", JSON.stringify(bounds));
