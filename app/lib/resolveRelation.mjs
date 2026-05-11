import { pickAnchorFor } from "./proposeAnchors.mjs";

/**
 * Surface-aware relation resolver — computes the actual (x, y, z) of a
 * SceneItem that has a `relation` to a host, using the VISIBLE bounds
 * of each item's sprite (via Asset.bounds, set by analyzeBounds) AND
 * named anchor zones (via Asset.anchors, set by anchorAssets) instead
 * of the scale-based estimate the server-side resolver uses.
 *
 * Why this exists: gpt-image-1 returns sprites with unpredictable
 * transparent padding. The scale-based math (host.scale × longest)
 * assumes the visible content fills the image, so a lamp "on" a
 * nightstand whose top has 20% transparent padding ends up floating
 * 20% above the actual nightstand. Knowing the bounds fraction
 * (bounds.top = 0.20) lets the resolver snap the lamp to the real
 * surface.
 *
 * Pure mjs so the test can import it directly. Falls back to the
 * scale-based math when either asset's bounds is unset (legacy
 * assets, freshly-generated assets whose analyzeBounds hasn't
 * completed yet, etc.). In the no-bounds fallback, the output matches
 * the server-side resolver's behavior, so this layer is safe to apply
 * unconditionally.
 */

/**
 * @typedef {{top: number, bottom: number, left: number, right: number}} Bounds
 * @typedef {{ x: number; y: number; scale: number; z: number; anchor?: "bottom" | "center" }} HostItem
 * @typedef {{ scale: number; z: number; anchor?: "bottom" | "center" }} ChildItem
 * @typedef {{ bounds?: Bounds }} AssetWithBounds
 * @typedef {"on" | "above" | "beside" | "in-front"} RelationKind
 */

const FULL_BOUNDS = Object.freeze({ top: 0, bottom: 1, left: 0, right: 1 });

/**
 * Compute the resolved (x, y, z) for a child item snapping to a host.
 *
 * @param {HostItem} hostItem
 * @param {ChildItem} childItem
 * @param {AssetWithBounds | null | undefined} hostAsset
 * @param {AssetWithBounds | null | undefined} childAsset
 * @param {RelationKind} where
 * @param {number} sceneW
 * @param {number} sceneH
 * @returns {{ x: number; y: number; z: number }}
 */
export function resolveRelation(
  hostItem,
  childItem,
  hostAsset,
  childAsset,
  where,
  sceneW,
  sceneH,
  options = {}
) {
  const longest = Math.max(sceneW, sceneH);
  // We treat the image cell as square in scene coords: cellSide = scale * longest.
  // For sprite sheets this is the per-frame cell after slicing; for single
  // frames it's the full image. The bounds fractions apply per-cell.
  const hCell = hostItem.scale * longest;
  const cCell = childItem.scale * longest;

  const hb = (hostAsset && hostAsset.bounds) || FULL_BOUNDS;
  const cb = (childAsset && childAsset.bounds) || FULL_BOUNDS;

  // Visible extents in scene-pixels.
  const hVisH = hCell * (hb.bottom - hb.top);
  const hVisW = hCell * (hb.right - hb.left);
  const cVisH = cCell * (cb.bottom - cb.top);
  const cVisW = cCell * (cb.right - cb.left);

  // Host's visible top / bottom / center-x in scene coords. We treat the
  // host as bottom-anchored: its image foot is at hostItem.y, so the
  // image top is `hostItem.y - hCell`. The visible TOP edge is then
  // `imageTop + hb.top * hCell = hostItem.y - hCell * (1 - hb.top)`.
  const hImageTopY = hostItem.y - hCell;
  const hVisTopY = hImageTopY + hb.top * hCell;
  const hVisBottomY = hImageTopY + hb.bottom * hCell;

  // Image center x is hostItem.x (assuming the rendered translate is
  // -50% -100% for bottom-anchor). The visible-content's horizontal
  // center is offset by how much the bounds skew left/right:
  //   xCenterOffset = ((hb.left + hb.right) / 2 - 0.5) * hCell
  const hVisCenterX = hostItem.x + hCell * ((hb.left + hb.right) / 2 - 0.5);
  const hVisLeftX = hVisCenterX - hVisW / 2;
  const hVisRightX = hVisCenterX + hVisW / 2;

  // For the child, we need to convert "visible center X" → "anchor X" so
  // the sprite paints in the right spot. Same offset math, applied to
  // the child's cell.
  const childAnchorXForVisCenter = (visCenterX) =>
    visCenterX - cCell * ((cb.left + cb.right) / 2 - 0.5);
  // Similarly, "visible bottom Y" → "anchor Y (foot)" for a bottom-
  // anchored child. The child's image bottom = anchor y; the visible
  // content's bottom edge sits at `anchorY - (1 - cb.bottom) * cCell`.
  // So anchorY = visibleBottomY + (1 - cb.bottom) * cCell.
  const childAnchorYForVisBottom = (visBottomY) =>
    visBottomY + (1 - cb.bottom) * cCell;

  let x = hostItem.x;
  let y = hostItem.y;
  let z = hostItem.z;

  switch (where) {
    case "on": {
      // If the host has named anchor zones (set by anchorAssets for
      // surface-bearing categories), pick the appropriate zone for the
      // child's category and snap to its CENTER. Otherwise fall back to
      // the bounds-derived visible top + 5% overlap.
      const anchor = pickAnchorFor(
        hostAsset && hostAsset.anchors,
        options.childCategory
      );
      if (anchor) {
        // anchor coordinates are bbox fractions of the host's image.
        // Convert to scene coordinates: host image top = hImageTopY,
        // image left = hostItem.x - hCell/2.
        const imageLeftX = hostItem.x - hCell / 2;
        const anchorCenterX = imageLeftX + (anchor.x + anchor.w / 2) * hCell;
        // The anchor zone is a small horizontal strip; the child's foot
        // sits at the TOP of the zone (just inside the host's surface).
        const anchorTopY = hImageTopY + anchor.y * hCell;
        x = childAnchorXForVisCenter(anchorCenterX);
        y = childAnchorYForVisBottom(anchorTopY + anchor.h * hCell * 0.5);
        z = hostItem.z + 1;
        break;
      }
      // Bounds-derived fallback.
      const visCenterX = hVisCenterX;
      const visBottomY = hVisTopY + hVisH * 0.05;
      x = childAnchorXForVisCenter(visCenterX);
      y = childAnchorYForVisBottom(visBottomY);
      z = hostItem.z + 1;
      break;
    }
    case "above": {
      // Floats above the host with a clear gap (~20% of host's visible
      // height). Child's visible BOTTOM is `gap` above the host's
      // visible TOP.
      const gap = hVisH * 0.2;
      const visCenterX = hVisCenterX;
      const visBottomY = hVisTopY - gap;
      x = childAnchorXForVisCenter(visCenterX);
      y = childAnchorYForVisBottom(visBottomY);
      z = hostItem.z + 1;
      break;
    }
    case "beside": {
      // Touch the host along the same ground line. Pick the side with
      // more room — if the host is in the left half of the scene, place
      // RIGHT; else place LEFT.
      const placeRight = hostItem.x < sceneW / 2;
      const visCenterX = placeRight ? hVisRightX + cVisW / 2 : hVisLeftX - cVisW / 2;
      const visBottomY = hVisBottomY; // share host's foot line
      x = childAnchorXForVisCenter(visCenterX);
      y = childAnchorYForVisBottom(visBottomY);
      // Same depth as host — beside, not stacked.
      z = hostItem.z;
      break;
    }
    case "in-front": {
      // Step closer to the camera — same x, foot shifted DOWN by ~15%
      // of host's visible height. z bumps so we draw over the host.
      const visCenterX = hVisCenterX;
      const visBottomY = hVisBottomY + hVisH * 0.15;
      x = childAnchorXForVisCenter(visCenterX);
      y = childAnchorYForVisBottom(visBottomY);
      z = hostItem.z + 1;
      break;
    }
  }

  // Clamp to scene bounds defensively.
  return {
    x: Math.max(0, Math.min(sceneW, x)),
    y: Math.max(0, Math.min(sceneH, y)),
    z,
  };
}
