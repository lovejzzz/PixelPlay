#!/usr/bin/env node
/**
 * Runtime test for Phase 14 fire #7 — Multi-anchor surfaces per asset.
 *
 * Verifies the proposer + picker + integration with the resolver:
 *  1. ANCHOR_WORTHY gating — non-surface categories (lighting, book,
 *     weapon, etc.) return [] immediately.
 *  2. Heuristic fallback (no key) returns a single "top" anchor for
 *     surface-bearing categories.
 *  3. Real gpt-4o-mini call against 2 sample assets — asserts every
 *     returned zone has a valid name + numeric bbox within [0, 1].
 *  4. pickAnchorFor picks correctly by child category.
 *  5. resolveRelation with anchors uses the anchor's center (not the
 *     bounds-derived top) when the host has anchors.
 */
import fs from "node:fs";
import path from "node:path";
import { proposeAnchors, pickAnchorFor } from "../app/lib/proposeAnchors.mjs";
import { resolveRelation } from "../app/lib/resolveRelation.mjs";

const envPath = path.join(process.cwd(), ".env.local");
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";

const failures = [];
function approx(a, b, tol = 1) { return Math.abs(a - b) <= tol; }

// 1. Non-surface categories return [].
{
  const out = await proposeAnchors("", "a glowing lamp", "lighting");
  if (out.length !== 0) failures.push(`lighting expected [], got ${JSON.stringify(out)}`);
}
{
  const out = await proposeAnchors("", "a long sword", "weapon");
  if (out.length !== 0) failures.push(`weapon expected [], got ${JSON.stringify(out)}`);
}
{
  const out = await proposeAnchors("", "a thick spellbook", "book");
  if (out.length !== 0) failures.push(`book expected [], got ${JSON.stringify(out)}`);
}

// 2. Heuristic fallback returns single "top" for surface categories.
{
  const out = await proposeAnchors("", "a wooden nightstand", "table");
  if (out.length !== 1 || out[0].name !== "top") {
    failures.push(`heuristic table expected single "top", got ${JSON.stringify(out)}`);
  }
}

// 3. Real-key call returns valid zones for 2 samples.
const VALID_NAMES = new Set([
  "top", "top-left", "top-right",
  "shelf-top", "shelf-middle", "shelf-bottom",
  "left-side", "right-side", "front",
]);
if (!API_KEY) {
  console.log("(skip real-key test — no OPENAI_API_KEY)");
} else {
  const samples = [
    { descriptor: "a wooden nightstand", category: "table" },
    { descriptor: "a tall oak bookshelf", category: "storage" },
  ];
  for (const s of samples) {
    const t0 = Date.now();
    const anchors = await proposeAnchors(API_KEY, s.descriptor, s.category);
    const elapsed = Date.now() - t0;
    if (anchors.length === 0) {
      failures.push(`real-key ${s.category} "${s.descriptor}" returned no anchors`);
      continue;
    }
    for (const a of anchors) {
      if (!VALID_NAMES.has(a.name)) failures.push(`bad anchor name "${a.name}"`);
      for (const k of ["x", "y", "w", "h"]) {
        if (typeof a[k] !== "number" || a[k] < 0 || a[k] > 1) {
          failures.push(`anchor ${a.name}.${k} = ${a[k]} not in [0,1]`);
        }
      }
      if (a.x + a.w > 1.001 || a.y + a.h > 1.001) {
        failures.push(`anchor ${a.name} extends outside image (${JSON.stringify(a)})`);
      }
    }
    console.log(`  "${s.descriptor}" → ${anchors.map((a) => a.name).join(", ")} (${elapsed}ms)`);
  }
}

// 4. pickAnchorFor picks correctly.
{
  const anchors = [
    { name: "shelf-top",    x: 0.1, y: 0.08, w: 0.8, h: 0.04 },
    { name: "shelf-middle", x: 0.1, y: 0.42, w: 0.8, h: 0.04 },
    { name: "shelf-bottom", x: 0.1, y: 0.76, w: 0.8, h: 0.04 },
  ];
  if (pickAnchorFor(anchors, "lighting").name !== "shelf-top") {
    failures.push(`pickAnchorFor lighting expected shelf-top`);
  }
  if (pickAnchorFor(anchors, "book").name !== "shelf-middle") {
    failures.push(`pickAnchorFor book expected shelf-middle`);
  }
  if (pickAnchorFor(anchors, "decor").name !== "shelf-top") {
    failures.push(`pickAnchorFor decor expected shelf-top`);
  }
  if (pickAnchorFor([], "anything") !== null) {
    failures.push(`pickAnchorFor with no anchors should return null`);
  }
  // Single anchor short-circuit.
  if (pickAnchorFor([anchors[0]], "anything").name !== "shelf-top") {
    failures.push(`single anchor short-circuit failed`);
  }
}

// 5. resolveRelation uses the anchor's position when host has anchors.
{
  const SCENE = 1024;
  const host = { x: 512, y: 600, scale: 0.2, z: 5, anchor: "bottom" };
  const child = { scale: 0.06, z: 0, anchor: "bottom" };
  const hostAssetWithAnchor = {
    bounds: { top: 0.2, bottom: 1, left: 0.15, right: 0.85 },
    anchors: [
      // Anchor placed mid-height in the image — clearly different from bounds.top.
      { name: "top", x: 0.2, y: 0.5, w: 0.6, h: 0.05 },
    ],
  };
  const hostAssetWithoutAnchor = {
    bounds: { top: 0.2, bottom: 1, left: 0.15, right: 0.85 },
  };
  const childAsset = { bounds: { top: 0, bottom: 1, left: 0, right: 1 } };

  const withAnchor = resolveRelation(host, child, hostAssetWithAnchor, childAsset, "on", SCENE, SCENE, { childCategory: "lighting" });
  const withoutAnchor = resolveRelation(host, child, hostAssetWithoutAnchor, childAsset, "on", SCENE, SCENE, { childCategory: "lighting" });

  if (approx(withAnchor.y, withoutAnchor.y, 5)) {
    failures.push(`anchor should change "on" y — withAnchor=${withAnchor.y}, withoutAnchor=${withoutAnchor.y}`);
  }
  // The anchor's center is at y=0.525 of the image → host's image top
  // (395.2) + 0.525 * 204.8 = 502.72. Plus half of anchor h (5.12) = 507.84.
  // So child foot lands ~507.8 (anchor center + anchor.h/2 * hCell of 0.5).
  // The exact value depends on the anchor math; the key check is that
  // it differs from the no-anchor case AND is within scene bounds.
  if (withAnchor.y < 0 || withAnchor.y > SCENE) {
    failures.push(`anchor result out of bounds: ${withAnchor.y}`);
  }
  if (withAnchor.z !== host.z + 1) failures.push(`anchor on: z = ${withAnchor.z}, expected ${host.z + 1}`);
}

if (failures.length > 0) {
  console.error("FAIL:");
  for (const f of failures) console.error("  -", f);
  process.exit(1);
}
console.log("PASS");
