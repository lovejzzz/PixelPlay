/**
 * Item-room validation — flags scene items whose asset category doesn't
 * belong in the scene's room type. The check is intentionally
 * non-destructive: we never auto-drop items (the LLM may pick something
 * contextually meaningful), we just surface the mismatch in the
 * hierarchy panel so the user can fix it.
 *
 * Built on top of:
 *   - app/lib/extractScene.mjs  → ROOM_TYPES + roomType field on Scene
 *   - app/lib/classify.mjs       → CATEGORIES + category field on Asset
 *   - app/lib/roomCategories.mjs → ROOM_CATEGORIES whitelist
 *
 * Pure ESM so a Node test can import it directly.
 */
import { isAcceptableInRoom } from "./roomCategories.mjs";

/**
 * Walk a scene's items and return the set of item IDs whose asset
 * category isn't in the room's whitelist. Items without an `assetId`,
 * a known asset, or a category at all are NOT flagged (we can't decide
 * without information, and we'd rather miss-flag than false-flag).
 *
 * Same shape applies for `kind`-typed items (lights, triggers, sound,
 * emitter, character placeholders) — they have no real asset category
 * and skip validation.
 *
 * @param {{ roomType?: string; items: Array<{ id: string; assetId?: string; kind?: string }> }} scene
 * @param {Record<string, { category?: string }>} assets
 * @returns {Set<string>} ids of unusual items
 */
export function getUnusualItemIds(scene, assets) {
  const out = new Set();
  if (!scene || !Array.isArray(scene.items)) return out;
  const roomType = scene.roomType;
  if (!roomType) return out; // legacy scene without roomType — no validation
  for (const it of scene.items) {
    if (!it || !it.assetId) continue;
    if (it.kind) continue; // lights/triggers/sounds/emitters/character placeholders
    const a = assets[it.assetId];
    if (!a || typeof a.category !== "string" || !a.category) continue;
    if (!isAcceptableInRoom(a.category, roomType)) {
      out.add(it.id);
    }
  }
  return out;
}

/** Convenience wrapper — just the count, for the header badge. */
export function getUnusualItemCount(scene, assets) {
  return getUnusualItemIds(scene, assets).size;
}
