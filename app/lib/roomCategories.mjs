import { CATEGORIES } from "./classify.mjs";

/**
 * Whitelist mapping each ROOM_TYPE to the set of asset CATEGORIES that
 * naturally belong in it. Used by Phase 14's item-room validation pass:
 * a "weapon" category asset showing up in a "bedroom" room type is
 * flagged as unusual (it MIGHT be intentional — the LLM could be doing
 * something contextual — so we surface it rather than auto-drop).
 *
 * Sourced from the ROOM_TYPES enum in `app/lib/extractScene.mjs` and
 * the CATEGORIES enum in `app/lib/classify.mjs`. Pure data — no runtime
 * logic beyond the small `isAcceptableInRoom` helper at the bottom.
 *
 * Design notes:
 *  - Be generous, not restrictive. A "lighting" item is welcome almost
 *    everywhere because every room benefits from a light source.
 *  - The "other" room type accepts EVERY category (catch-all).
 *  - Unknown roomType / category at the boundary returns `true` from
 *    isAcceptableInRoom — defensive so we never false-flag based on a
 *    stale enum mismatch.
 */

/** @type {Record<string, ReadonlyArray<string>>} */
export const ROOM_CATEGORIES = Object.freeze({
  // ─── Interior rooms ──────────────────────────────────────────────
  bedroom: [
    "bedding", "seating", "table", "storage",
    "lighting", "decor", "clothing", "book",
    "electronics", "container", "art", "toy",
  ],
  kitchen: [
    "kitchen", "food", "container", "storage",
    "table", "seating", "lighting", "decor",
    "electronics", "tool",
  ],
  bathroom: [
    "container", "lighting", "decor", "clothing",
    "tool", "storage",
  ],
  "living-room": [
    "seating", "table", "lighting", "decor",
    "electronics", "art", "book", "container",
    "plant", "toy", "storage", "clothing",
  ],
  office: [
    "seating", "table", "lighting", "electronics",
    "book", "decor", "art", "container",
    "tool", "plant", "storage",
  ],
  workshop: [
    "tool", "table", "container", "storage",
    "lighting", "decor", "weapon", "clothing",
  ],
  shop: [
    "seating", "table", "container", "lighting",
    "decor", "art", "tool", "food",
    "clothing", "book", "weapon", "storage",
  ],
  tavern: [
    "seating", "table", "lighting", "decor",
    "kitchen", "food", "container", "art",
    "storage", "book",
  ],
  "potion-shop": [
    "container", "lighting", "book", "decor",
    "tool", "art", "plant", "kitchen",
    "storage", "table",
  ],
  "blacksmith-forge": [
    "tool", "table", "container", "lighting",
    "weapon", "storage", "kitchen", "decor",
  ],
  "wizard-study": [
    "book", "container", "lighting", "decor",
    "tool", "art", "seating", "table",
    "storage", "weapon",
  ],

  // ─── Exterior ────────────────────────────────────────────────────
  forest: [
    "plant", "container", "tool", "decor",
    "lighting", "art", "seating", "weapon",
    "food",
  ],
  meadow: [
    "plant", "decor", "art", "lighting",
    "seating",
  ],
  desert: [
    "plant", "container", "decor", "art",
    "tool", "lighting", "food",
  ],
  beach: [
    "container", "decor", "plant", "tool",
    "vehicle", "food", "lighting",
  ],
  mountain: [
    "plant", "decor", "art", "tool",
    "container", "lighting", "weapon",
  ],
  graveyard: [
    "art", "decor", "plant", "container",
    "lighting", "tool",
  ],
  village: [
    "vehicle", "plant", "decor", "container",
    "lighting", "art", "seating", "table",
    "food", "tool", "clothing", "storage",
  ],
  garden: [
    "plant", "decor", "art", "seating",
    "lighting", "container", "tool",
  ],
  underwater: [
    "plant", "decor", "container", "art",
    "food",
  ],

  // ─── Subterranean ────────────────────────────────────────────────
  dungeon: [
    "container", "lighting", "weapon", "tool",
    "decor", "art", "storage", "food",
    "book", "clothing",
  ],
  cave: [
    "plant", "container", "lighting", "tool",
    "decor", "food", "art",
  ],

  // ─── Catch-all ───────────────────────────────────────────────────
  other: [
    "bedding", "seating", "table", "storage",
    "kitchen", "electronics", "decor", "clothing",
    "tool", "book", "food", "plant",
    "container", "lighting", "art", "toy",
    "weapon", "vehicle",
  ],
});

const KNOWN_CATEGORIES = new Set(CATEGORIES);

/** Predicate: does the given category belong in the given room?
 *  Returns `true` defensively whenever an argument is unknown — we'd
 *  rather miss a flag than surface a false positive. Specifically:
 *   - empty / undefined args → true
 *   - unknown roomType → true
 *   - unknown category (not in CATEGORIES) → true
 *   - category === "other" → true (the catch-all category is always OK)
 *   - otherwise: true iff the category is in the room's whitelist. */
export function isAcceptableInRoom(category, roomType) {
  if (!category || !roomType) return true;
  if (!KNOWN_CATEGORIES.has(category)) return true; // unknown category → don't flag
  if (category === "other") return true;
  const list = ROOM_CATEGORIES[roomType];
  if (!list) return true; // unknown roomType → don't flag
  return list.includes(category);
}
