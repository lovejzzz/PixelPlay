#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #8 — Snap-feedback in edit mode.
 *
 * Verifies the pure findSnapTarget() helper with a synthetic scene:
 *  - a nightstand (host) with a single "top" anchor
 *  - a bookshelf (host) with three shelf anchors
 *  - a lamp being dragged at various positions
 *
 * Asserts:
 *  1. Dragging the lamp NEAR the nightstand's top finds that anchor.
 *  2. Dragging the lamp FAR from any host returns null.
 *  3. Dragging the lamp near the bookshelf finds the CLOSEST shelf.
 *  4. Items without anchors are not returned even if nearby.
 *  5. The dragged item itself isn't returned as a host.
 *  6. kind-typed items (lights / triggers) are skipped as hosts.
 */
import { findSnapTarget } from "../app/lib/findSnapTarget.mjs";

const failures = [];
const SCENE = 1024;
const longest = SCENE;
const T = 60; // 60 scene-px threshold

const scene = [
  // Nightstand at (300, 600). scale 0.2 → cell 204.8. Image spans
  // x = [300 - 102.4, 300 + 102.4], y = [600 - 204.8, 600].
  {
    id: "nightstand",
    assetId: "ast-nightstand",
    x: 300,
    y: 600,
    scale: 0.2,
  },
  // Bookshelf at (700, 700). scale 0.35 → cell 358.4. Image y spans
  // [700 - 358.4, 700] = [341.6, 700]. Shelves at y fractions 0.1, 0.42, 0.74.
  {
    id: "bookshelf",
    assetId: "ast-bookshelf",
    x: 700,
    y: 700,
    scale: 0.35,
  },
  // Rug at (200, 800) with NO anchors — must not be returned.
  {
    id: "rug",
    assetId: "ast-rug",
    x: 200,
    y: 800,
    scale: 0.18,
  },
  // A "light" kind item — must be skipped even if it has anchors.
  {
    id: "torch-light",
    kind: "light",
    x: 500,
    y: 500,
    scale: 0.1,
    assetId: "ast-torch",
  },
];

const assetsMap = {
  "ast-nightstand": {
    anchors: [{ name: "top", x: 0.1, y: 0.08, w: 0.8, h: 0.05 }],
  },
  "ast-bookshelf": {
    anchors: [
      { name: "shelf-top",    x: 0.1, y: 0.1, w: 0.8, h: 0.05 },
      { name: "shelf-middle", x: 0.1, y: 0.42, w: 0.8, h: 0.05 },
      { name: "shelf-bottom", x: 0.1, y: 0.74, w: 0.8, h: 0.05 },
    ],
  },
  "ast-rug": {},
  "ast-torch": {
    anchors: [{ name: "top", x: 0.3, y: 0.3, w: 0.4, h: 0.05 }],
  },
};

// Helper to compute zone center for assertions.
function zoneCenter(item, anchor) {
  const cell = item.scale * longest;
  const left = item.x - cell / 2;
  const top = item.y - cell;
  return {
    cx: left + (anchor.x + anchor.w / 2) * cell,
    cy: top + (anchor.y + anchor.h / 2) * cell,
  };
}

// 1. Drag lamp near nightstand's top zone.
{
  const ns = scene[0];
  const a = assetsMap["ast-nightstand"].anchors[0];
  const zc = zoneCenter(ns, a);
  // zc ≈ (300, 600 - 204.8 + (0.08 + 0.025)*204.8) = (300, 600 - 204.8 + 21.5) = (300, 416.7)
  const dragX = zc.cx + 5;
  const dragY = zc.cy + 5;
  const out = findSnapTarget("lamp-id", dragX, dragY, scene, assetsMap, T, SCENE, SCENE);
  if (!out) failures.push(`near nightstand should snap (got null)`);
  else if (out.hostId !== "nightstand") failures.push(`expected nightstand, got ${out.hostId}`);
  else if (out.anchorName !== "top") failures.push(`expected anchor "top", got "${out.anchorName}"`);
}

// 2. Drag lamp FAR from any host — expect null.
{
  const out = findSnapTarget("lamp-id", 0, 0, scene, assetsMap, T, SCENE, SCENE);
  if (out !== null) failures.push(`far drag should return null, got ${JSON.stringify(out)}`);
}

// 3. Drag lamp near bookshelf's MIDDLE shelf — expect shelf-middle.
{
  const bs = scene[1];
  const a = assetsMap["ast-bookshelf"].anchors[1]; // shelf-middle
  const zc = zoneCenter(bs, a);
  const out = findSnapTarget("lamp-id", zc.cx, zc.cy, scene, assetsMap, T, SCENE, SCENE);
  if (!out) failures.push(`near bookshelf-middle should snap`);
  else if (out.hostId !== "bookshelf") failures.push(`expected bookshelf, got ${out.hostId}`);
  else if (out.anchorName !== "shelf-middle") failures.push(`expected shelf-middle, got ${out.anchorName}`);
}

// 4. Rug has no anchors — drag near rug shouldn't find anything for it.
{
  const rug = scene[2];
  // Right at the rug's center. The rug has no anchors so we shouldn't
  // get the rug. We also need to be far from the other hosts to make
  // sure rug-skipping is what's tested.
  const out = findSnapTarget("lamp-id", rug.x, rug.y, scene, assetsMap, T, SCENE, SCENE);
  if (out && out.hostId === "rug") failures.push(`rug has no anchors but was returned`);
}

// 5. Dragged item's own id excluded — even if it has anchors.
{
  const out = findSnapTarget("nightstand", 300, 416, scene, assetsMap, T, SCENE, SCENE);
  if (out && out.hostId === "nightstand") failures.push(`dragged item returned as host`);
}

// 6. kind-typed items (light) skipped — even if they have anchors.
{
  const torch = scene[3];
  const a = assetsMap["ast-torch"].anchors[0];
  const zc = zoneCenter(torch, a);
  const out = findSnapTarget("lamp-id", zc.cx, zc.cy, scene, assetsMap, T, SCENE, SCENE);
  if (out && out.hostId === "torch-light") failures.push(`kind="light" host should be skipped`);
}

// 7. Threshold gating — drag just outside threshold returns null.
{
  const ns = scene[0];
  const a = assetsMap["ast-nightstand"].anchors[0];
  const zc = zoneCenter(ns, a);
  // 80px away on x — well outside the 60px threshold.
  const out = findSnapTarget("lamp-id", zc.cx + 80, zc.cy, scene, assetsMap, T, SCENE, SCENE);
  if (out !== null) failures.push(`outside threshold should return null, got ${JSON.stringify(out)}`);
}

// 8. When two zones are equidistant, the picker returns the nearer one
//    (tie-broken by iteration order — first match wins).
{
  const bs = scene[1];
  const tA = assetsMap["ast-bookshelf"].anchors[0]; // shelf-top
  const tB = assetsMap["ast-bookshelf"].anchors[1]; // shelf-middle
  const zcA = zoneCenter(bs, tA);
  const zcB = zoneCenter(bs, tB);
  // Drag at the midpoint between two shelves → equidistant. Expect one
  // of them; cap is that it must be deterministic by distance, not random.
  const out = findSnapTarget("lamp-id", (zcA.cx + zcB.cx) / 2, (zcA.cy + zcB.cy) / 2, scene, assetsMap, T, SCENE, SCENE);
  // Just verify a host is picked and it's the bookshelf.
  if (!out) {
    failures.push(`midpoint between shelves returned null`);
  } else if (out.hostId !== "bookshelf") {
    failures.push(`midpoint expected bookshelf, got ${out.hostId}`);
  }
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
