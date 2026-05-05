# Pixel World Factory — Roadmap

This file is read by the autonomous cron. Each fire ticks off the next 3
unchecked items and logs to `CRON-LOG.md`. When everything is checked, the
cron stops working (it'll still fire but exit early).

## Constraints for any cron-driven change

- **No API spend.** Don't generate images. Don't run `npm run dev`.
- **Type-check + build clean.** `npx tsc --noEmit` and `npx next build` must
  pass. If a change is too risky to land cleanly, leave it unchecked and pick
  another item.
- **Match existing style.** Look at how prior features were implemented:
  - State and mutators live in `app/page.tsx`
  - Scene editor primitives live in `app/components/SceneCanvas.tsx` /
    `app/components/ScenePlayer.tsx`
  - Pure utility functions live in `app/lib/*`
- **Don't refactor adjacent code** unless the item explicitly asks. Keep the
  diff bounded to what each line item describes.
- **Persistence.** Asset/scene state lives in IndexedDB; project-style
  preferences live in localStorage. Don't introduce new top-level storage
  keys without good reason.
- **Migrations.** Older `Asset` and `SceneItem` records may not have the
  fields a new feature uses — guard with optional-chaining and sane defaults.

## Phase 2 — editor power

Closes the gap with real scene editors (Godot / Unity 2D / Aseprite scene).

- [x] **Flip horizontal toggle on selected scene item** — add `flipX?: boolean` to `SceneItem`; render via `transform: scaleX(-1)` in `SceneCanvas` and `ScenePlayer`. Toggle button in the side panel (▶◀ icon) and in `SceneHierarchy` row. Persist in scene/manifest exports.
- [x] **Flip vertical toggle on selected scene item** — same pattern, `flipY` + `scaleY(-1)`.
- [x] **Numeric x/y inputs in the scene side panel** — replace the read-only "z=N" text with editable `<input type="number">` for x, y, and scale (current scale already has a slider — keep slider AND add numeric box that shows percent and accepts typed values).
- [x] **Pan camera with middle-click drag** — in `SceneCanvas`, on middle-button pointerdown, store starting pointer + scroll offset; on pointermove translate the canvas via CSS transform (or scroll the wrapper). Restore default cursor / leave cursor as `grab` while panning.
- [x] **Shift-click multi-select in the scene canvas** — change `selectedSceneItemId: string | null` to a `selectedSceneItemIds: string[]`. Shift-click toggles membership; plain click replaces the selection. Side panel hides when >1 selected (or shows a multi-select summary).
- [x] **Drag-rectangle multi-select on empty canvas** — pointerdown on empty canvas starts a rubber-band rectangle; on pointerup, all items whose center falls inside become selected.
- [x] **Group move with multi-select** — when multiple items are selected, dragging any one of them moves the whole group by the same delta.
- [x] **Undo/redo (Cmd+Z / Cmd+Shift+Z) with history of last 30 scene mutations** — wrap scene mutations through a tiny `useUndoableScene` hook that stores past/future stacks per scene. Trigger from `keydown` (avoid editable targets — same `isEditableTarget` helper as the existing keyboard shortcut effect). Limit to 30 entries.
- [x] **Rotation handle on selected item** — add `rotation?: number` (degrees) to `SceneItem`. Render an extra handle above the bounding box. Pointer drag updates rotation by the angle from item center to handle. Render via `transform: rotate(Xdeg)`. Update `SceneCanvas` and `ScenePlayer` to apply it. Persist in exports.
- [x] **Snap-to-other-items alignment guides while dragging** — during item drag in `SceneCanvas`, if the dragged center is within ~6 px (in scene coords) of any other item's center on either axis, draw a thin green line across the canvas at that axis and snap the position.

## Phase 3 — world logic

Turns "scene editor" into "tiny game."

- [x] **`pickable` flag on `SceneItem`** — small data field with a side-panel toggle (🛒). No play-mode behavior yet.
- [x] **Pickup behavior in play mode** — when the player walks within ~16 px of a pickable item, remove it from the scene (or set `picked: true`) and add to a runtime inventory list inside `ScenePlayer`. Show a brief toast.
- [x] **Inventory HUD in play mode** — corner overlay listing picked items as small thumbnails with names. Visible only in play mode.
- [x] **Door/portal item flag (`linkSceneId`)** — drop-down in the side panel that lets you pick another scene from the same project. When the player walks onto a door, switch the active scene to the linked one and place the player at the door's position in the new scene.
- [x] **NPC patrol path** — `SceneItem.patrol?: { points: { x: number; y: number }[]; loop: boolean; speed: number }`. Side-panel UI to add/remove waypoints (click on canvas in "patrol edit" sub-mode).
- [x] **NPC patrol play behavior** — non-player characters with a patrol path walk between waypoints in play mode using the same animation logic as the player (directional walk-cycle frames).
- [x] **Trigger zone item type (invisible AABB)** — special `SceneItem` with no asset (or a placeholder UI sprite that's only visible in edit mode). Has a `triggerMessage: string`. In play mode, when the player enters its bbox, fire the message into a play-mode log overlay.

## Phase 4 — map building

- [x] **Tile painting tool — click+drag to paint a tile asset onto a grid layer** — new "tile layer" concept on Scene: a separate `tileGrid?: { tileSize: number; layers: { tileAssetId: string; cells: Array<{ x: number; y: number }> }[] }`. New "Paint" mode in the scene controls. While painting, click+drag stamps the active tile asset at grid-snapped cells. Render below items.
- [x] **Eraser for tile layers** — same as paint, removes cells under the cursor.
- [x] **Multiple tile layers (ground / decor / overlay)** — add/remove/reorder named layers in the side panel; each layer renders at its own z range so decor draws over ground but under items.
- [x] **Prefab system — save a group of selected items as a reusable unit** — at the project level, `prefabs: Record<string, { name: string; items: SceneItem[] }>`. UI: "Save selection as prefab" button when multi-selected. Library row in the right tab listing prefabs; drag a prefab onto the canvas to instantiate.
- [x] **Linked instances** — items spawned from a prefab keep a `prefabId` reference. Editing the prefab's master items propagates to all instances (asset, scale, flip, rotation). Position is per-instance.

## Phase 5 — atmosphere

- [x] **Point-light item type** — special asset-less item with `light: { radius: number; color: string; intensity: number }`. In play mode, render a radial-gradient overlay at the position. Edit mode shows a sun-icon placeholder.
- [x] **Particle emitter item — looping sparkles** — same shape: special item with `emitter: { kind: "sparkle" | "smoke"; rate: number; lifetime: number }`. In play mode, render a small canvas-based particle loop at the item's position.
- [x] **Day/night tint slider on the scene** — `scene.daytime: number` (0 = midnight, 0.5 = noon, 1 = midnight again). Apply a `mix-blend-mode: multiply` color overlay to the canvas based on time. Slider in the scene controls bar.
- [x] **Sound-trigger placeholder item type** — item with `sound: { url: string; volume: number; loop: boolean }`. In play mode, plays the audio when player enters the bbox. (Stubbed if no real audio asset; just record the trigger.)

## When everything is checked

- Append a "ROADMAP COMPLETE" entry to `CRON-LOG.md` with the date.
- Don't add new items autonomously — the user decides what's next after the
  list is done. Just stop.
