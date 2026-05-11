/**
 * Snap-target finder for edit-mode drag. Given a dragged item's
 * current scene position, walks every OTHER item in the scene that
 * has anchor zones (Phase 14 fire #82) and returns the nearest zone
 * within `threshold` scene-pixels — used by SceneCanvas to render a
 * green outline overlay during drag, hinting where the item will
 * snap if released.
 *
 * Pure helper so it can be unit-tested without a DOM. Returns null
 * when nothing is close enough. The actual snap-on-release and the
 * relationTo creation are left to the caller; this just identifies
 * the candidate.
 */

/**
 * @typedef {{ name: string; x: number; y: number; w: number; h: number }} Anchor
 * @typedef {{ id: string; x: number; y: number; scale: number; assetId: string; kind?: string }} SceneItem
 * @typedef {{ anchors?: ReadonlyArray<Anchor> }} AssetWithAnchors
 * @typedef {{
 *   hostId: string;
 *   anchorName: string;
 *   snapX: number;
 *   snapY: number;
 *   zoneCenterX: number;
 *   zoneCenterY: number;
 *   zoneW: number;
 *   zoneH: number;
 *   dist: number;
 * }} SnapTarget
 *
 * @param {string} draggedId
 * @param {number} dragX  current drag-position x (item foot center, scene px)
 * @param {number} dragY  current drag-position y (item foot, scene px)
 * @param {ReadonlyArray<SceneItem>} sceneItems
 * @param {Record<string, AssetWithAnchors>} assetsMap
 * @param {number} threshold  scene-pixel radius
 * @param {number} sceneW
 * @param {number} sceneH
 * @returns {SnapTarget | null}
 */
export function findSnapTarget(
  draggedId,
  dragX,
  dragY,
  sceneItems,
  assetsMap,
  threshold,
  sceneW,
  sceneH
) {
  const longest = Math.max(sceneW, sceneH);
  /** @type {SnapTarget | null} */
  let best = null;
  for (const other of sceneItems) {
    if (!other || other.id === draggedId) continue;
    if (other.kind) continue; // skip lights / triggers / sounds / emitters
    const otherAsset = assetsMap[other.assetId];
    if (!otherAsset || !Array.isArray(otherAsset.anchors) || otherAsset.anchors.length === 0) continue;

    const otherCell = other.scale * longest;
    const imageLeftX = other.x - otherCell / 2;
    const imageTopY = other.y - otherCell;

    for (const anchor of otherAsset.anchors) {
      if (!anchor || typeof anchor.x !== "number" || typeof anchor.y !== "number") continue;
      const zoneW = anchor.w * otherCell;
      const zoneH = anchor.h * otherCell;
      const zoneCenterX = imageLeftX + (anchor.x + anchor.w / 2) * otherCell;
      const zoneTopY = imageTopY + anchor.y * otherCell;
      const zoneCenterY = zoneTopY + zoneH / 2;
      // Compare the dragged item's FOOT (dragX, dragY) against the zone
      // center. For surfaces (top of a nightstand), the foot lands on
      // the top of the zone — using the zone's center is a generous
      // measure that picks the zone even if the foot drifts slightly
      // off the literal top edge.
      const dx = dragX - zoneCenterX;
      const dy = dragY - zoneCenterY;
      const dist = Math.hypot(dx, dy);
      if (dist > threshold) continue;
      if (!best || dist < best.dist) {
        best = {
          hostId: other.id,
          anchorName: anchor.name,
          snapX: zoneCenterX,
          // Snap foot to the top of the zone (matches the "on" relation
          // resolver's anchor-aware path in resolveRelation.mjs).
          snapY: zoneTopY + zoneH * 0.5,
          zoneCenterX,
          zoneCenterY,
          zoneW,
          zoneH,
          dist,
        };
      }
    }
  }
  return best;
}
