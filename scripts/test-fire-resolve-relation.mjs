#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #5 — Surface-aware relation resolver.
 *
 * Synthetic scene with a nightstand (host) and a lamp (child). The
 * nightstand has 20% transparent padding on its top (bounds.top = 0.2)
 * — emulating what gpt-image-1 frequently returns. We verify:
 *
 * 1. With bounds present, "on" relation lands the lamp at the host's
 *    ACTUAL visible top edge (not the image top).
 * 2. Without bounds, the resolver gracefully falls back to scale-based
 *    math (lamp at image top - matches the old server resolver).
 * 3. "beside" places the child at the host's visible side edge, same
 *    ground line.
 * 4. "above" floats the child clearly above the host.
 * 5. "in-front" puts the child slightly below the host's foot.
 *
 * No API calls — pure math.
 */
import { resolveRelation } from "../app/lib/resolveRelation.mjs";

const SCENE_W = 1024;
const SCENE_H = 1024;

// Nightstand host:
const host = {
  x: 512,
  y: 600,    // foot at y=600
  scale: 0.2, // image cell = 0.2 * 1024 = 204.8 px in scene units
  z: 5,
  anchor: "bottom",
};
const hostAssetWithBounds = {
  bounds: { top: 0.2, bottom: 1.0, left: 0.15, right: 0.85 },
  // visible_top_of_image = imageTop + 0.2 * 204.8 = (600-204.8) + 40.96 = 436.16
  // visible_height = (1 - 0.2) * 204.8 = 163.84
  // visible_left = host.x + ((0.15+0.85)/2 - 0.5) * 204.8 = 512 + 0 = 512
  // visible_right = 512 + 0.7*204.8/2 = 512 + 71.68 = 583.68
};
const hostAssetWithoutBounds = { bounds: undefined };

// Lamp child:
const child = {
  scale: 0.06, // 61.44 px
  z: 0,
  anchor: "bottom",
};
const childAssetWithBounds = {
  bounds: { top: 0.0, bottom: 1.0, left: 0.0, right: 1.0 }, // no padding
};

const failures = [];
function approx(a, b, tol = 1) {
  return Math.abs(a - b) <= tol;
}

// ─── 1. "on" with bounds ──────────────────────────────────────────────
{
  const out = resolveRelation(host, child, hostAssetWithBounds, childAssetWithBounds, "on", SCENE_W, SCENE_H);
  // Visible top of host = 600 - 204.8 + 40.96 = 436.16
  // small overlap = 0.05 * 163.84 = 8.19
  // child visible bottom = 436.16 + 8.19 = 444.35
  // child anchor y (foot) = 444.35 + 0 = 444.35
  // child anchor x = host.visibleCenterX = 512 - 0.06*1024*0 = 512 (no x offset since child bounds centered)
  if (!approx(out.x, 512)) failures.push(`on/bounds: x = ${out.x}, expected ~512`);
  if (!approx(out.y, 444.35, 1)) failures.push(`on/bounds: y = ${out.y}, expected ~444.35`);
  if (out.z !== 6) failures.push(`on/bounds: z = ${out.z}, expected 6`);
}

// ─── 2. "on" WITHOUT bounds (fallback to image-top) ──────────────────
{
  const out = resolveRelation(host, child, hostAssetWithoutBounds, hostAssetWithoutBounds, "on", SCENE_W, SCENE_H);
  // No bounds → FULL_BOUNDS for both → visible top of host = host.y - hCell = 600 - 204.8 = 395.2
  // small overlap = 0.05 * 204.8 = 10.24
  // child visible bottom = 395.2 + 10.24 = 405.44
  // child anchor y = 405.44 + 0 = 405.44
  if (!approx(out.x, 512)) failures.push(`on/noBounds: x = ${out.x}, expected 512`);
  if (!approx(out.y, 405.44, 1)) failures.push(`on/noBounds: y = ${out.y}, expected ~405.44`);
  if (out.z !== 6) failures.push(`on/noBounds: z = ${out.z}, expected 6`);
  // The fallback y (~405) is HIGHER (smaller y) than with-bounds y (~444).
  // That's expected: without bounds, the resolver thinks the host's top
  // is at image top, which is FURTHER from the foot than the actual
  // visible top. The visible difference is what bounds gives us.
  if (out.y >= 444) failures.push(`on/noBounds expected to differ from on/bounds — both at y=${out.y}`);
}

// ─── 3. "beside" with bounds (place right since host is at center) ─
{
  const out = resolveRelation(host, child, hostAssetWithBounds, childAssetWithBounds, "beside", SCENE_W, SCENE_H);
  // host.x = 512, SCENE_W/2 = 512 → placeRight = (host.x < 512) is false → placeLeft.
  // Actually our impl: `placeRight = hostItem.x < sceneW / 2` → 512 < 512 = false → placeLeft.
  // visibleLeftX = 512 - 143.36/2 = 512 - 71.68 = 440.32
  // child visible width = 0.06 * 1024 * 1 = 61.44; half = 30.72
  // visible center x = 440.32 - 30.72 = 409.60
  // child anchor x = 409.60 - 0 = 409.60
  // visible bottom Y = host visible bottom = 600 (bounds.bottom = 1)
  // child anchor y = 600
  if (!approx(out.x, 409.6, 1)) failures.push(`beside/left: x = ${out.x}, expected ~409.6`);
  if (!approx(out.y, 600, 1)) failures.push(`beside/left: y = ${out.y}, expected 600`);
  if (out.z !== 5) failures.push(`beside: z = ${out.z}, expected 5 (same as host)`);
}

// ─── 4. "beside" with host to the LEFT (place right) ──────────────────
{
  const leftHost = { ...host, x: 200 };
  const out = resolveRelation(leftHost, child, hostAssetWithBounds, childAssetWithBounds, "beside", SCENE_W, SCENE_H);
  // host.x=200, 200<512 → placeRight=true
  // visibleRightX = 200 + (0.7*204.8)/2 = 200 + 71.68 = 271.68
  // child visibleCenterX = 271.68 + 30.72 = 302.4
  if (!approx(out.x, 302.4, 1)) failures.push(`beside/right: x = ${out.x}, expected ~302.4`);
  if (!approx(out.y, 600, 1)) failures.push(`beside/right: y = ${out.y}, expected 600`);
}

// ─── 5. "above" with bounds ──────────────────────────────────────────
{
  const out = resolveRelation(host, child, hostAssetWithBounds, childAssetWithBounds, "above", SCENE_W, SCENE_H);
  // host visible top = 436.16
  // gap = 0.2 * 163.84 = 32.77
  // child visible bottom = 436.16 - 32.77 = 403.39
  // child anchor y (no bottom padding) = 403.39
  if (!approx(out.x, 512, 1)) failures.push(`above: x = ${out.x}, expected 512`);
  if (!approx(out.y, 403.39, 1)) failures.push(`above: y = ${out.y}, expected ~403.39`);
  if (out.z !== 6) failures.push(`above: z = ${out.z}, expected 6`);
}

// ─── 6. "in-front" with bounds ───────────────────────────────────────
{
  const out = resolveRelation(host, child, hostAssetWithBounds, childAssetWithBounds, "in-front", SCENE_W, SCENE_H);
  // host visible bottom = host.y - hCell*(1 - bounds.bottom) = 600 - 0 = 600
  // shift = 0.15 * 163.84 = 24.58
  // child visible bottom = 600 + 24.58 = 624.58 (clamped to 1024 in this case, fine)
  if (!approx(out.x, 512, 1)) failures.push(`in-front: x = ${out.x}, expected 512`);
  if (!approx(out.y, 624.58, 1)) failures.push(`in-front: y = ${out.y}, expected ~624.58`);
  if (out.z !== 6) failures.push(`in-front: z = ${out.z}, expected 6`);
}

// ─── 7. Bounds matter: with-bounds and without-bounds "on" differ. ────
{
  const withB = resolveRelation(host, child, hostAssetWithBounds, childAssetWithBounds, "on", SCENE_W, SCENE_H);
  const withoutB = resolveRelation(host, child, null, null, "on", SCENE_W, SCENE_H);
  if (approx(withB.y, withoutB.y, 5)) {
    failures.push(`bounds didn't change "on" y — withB=${withB.y}, withoutB=${withoutB.y}`);
  }
  // With bounds, the child should land LOWER (larger y, closer to host
  // foot) because the host has transparent padding making its real top
  // closer to its foot.
  if (withB.y <= withoutB.y) {
    failures.push(`with-bounds y (${withB.y}) should be > without-bounds y (${withoutB.y}) for an asset with top padding`);
  }
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
