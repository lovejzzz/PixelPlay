# Pixel Play — Roadmap

This file is read by the autonomous cron. Each fire ticks off the next 1
unchecked item in **Phase 6** and logs to `CRON-LOG.md`. When everything
is checked, the cron exits early.

## Constraints for any cron-driven change

- **No API spend.** Don't generate images. Don't run `npm run dev`.
- **Type-check + build clean.** `npx tsc --noEmit` and `npx next build` must
  pass. If a change is too risky to land cleanly, leave it unchecked and pick
  another item.
- **Match existing style.** State + mutators in `app/page.tsx`; scene
  primitives in `app/components/SceneCanvas.tsx` / `ScenePlayer.tsx`; pure
  utility functions in `app/lib/*`.
- **Don't refactor adjacent code** unless the item explicitly asks. Keep the
  diff bounded to what each line item describes.
- **Persistence.** Asset/scene state lives in IndexedDB; small project-style
  preferences live in localStorage. Don't introduce new top-level storage
  keys without good reason.
- **Migrations.** Older `Asset` / `SceneItem` records may not have a new
  field — guard with optional-chaining and sane defaults.
- **Skip items marked `[SKIP-CRON]`** — they're too risky for autonomous
  work (large refactors, CI config, deploy changes). Leave them for the
  user to handle manually.

## Phase 2-5 — Editor power, world logic, atmosphere

All items below were completed in earlier autonomous runs.

- [x] Phase 2 — flip x/y, numeric x/y/scale, pan camera, multi-select, rubber-band, group move, undo/redo, rotation handle, snap-to-other-items
- [x] Phase 3 — pickable flag, pickup, inventory HUD, doors/portals, NPC patrol path + play behavior, trigger zones
- [x] Phase 4 — tile painting + eraser + multi-layer, prefab system + linked instances
- [x] Phase 5 — point lights, particle emitters, day/night tint, sound triggers

## Phase 6 — Polish & robustness

Found via deep audit on 2026-05-06. Roughly ordered by impact / payoff;
the cron walks the list top-down. Each item names the file(s) most likely
to need editing, but the cron should still grep before changing.

### High-impact

- [x] **Per-item perspective derived from scene context** — when split-items
      generates assets for a scene, currently every item uses the form's
      `perspective` setting. Update `app/api/generate/route.ts` to:
      interior context → all items "front-on / facing camera"; aerial
      context → all items "top-down"; exterior context → buildings front-on,
      ground props (rocks, trees, signs) top-down. Add a
      `perspectiveForItem(name, context)` helper. Test by inspecting prompt
      strings only — no actual image generation.

- [x] **Soft-delete assets with a session trash** — add a `trash:
      Record<string, Asset>` state in `app/page.tsx` (in-memory only, not
      persisted). `deleteAsset` moves the record into trash instead of
      removing. Surface a small "Trash (N)" link in the gallery footer
      that opens a modal listing recently-trashed assets with "Restore" /
      "Empty trash" actions. Don't break the existing scene-item refs —
      a trashed asset's id still resolves until trash is emptied.

- [x] **Failed-item retry badge on a composed scene** — when split-items
      returns `failures[]`, surface them on the resulting scene card as a
      "⚠ N items failed" badge. Clicking it shows the failed names with a
      "Retry" button. Retry is a stub for now (logs to console + shows a
      toast "feature coming"); just plumb the data and UI.

- [x] **Variety-check regenerate stub on AssetCard** — extend the existing
      `lowVariety` warning badge so clicking it surfaces a small "🔄 try
      again" button. The button is a stub (alert/toast "feature coming")
      until we have a re-roll flow; just plumb the UI.

- [x] **Settings "Test connection" button** — in the Settings modal, add a
      button that does `GET /v1/models` with the entered key (limit=1, low
      cost) and shows ✓ Connected / ✗ Invalid inline. The fetch goes
      direct to OpenAI from the browser using the user's key. Show a
      small loading spinner while in flight.

### Medium-impact

- [x] **Tile painter fill-rectangle and fill-all** — in the TilePaintBar
      panel, add two new buttons next to Paint/Erase: "▣ Fill rect" (drag
      from corner to corner, paints all cells in the rectangle on
      pointerup) and "⬛ Fill layer" (one click — paints every cell on the
      active layer with the current tile asset, with an `if (confirm)`
      first). Both should respect the active tile asset.

- [x] **Camera follows the player in Play mode** — in `ScenePlayer.tsx`,
      after each rAF tick, find the canvas-wrapper's scrollable parent and
      set `scrollLeft / scrollTop` so the player stays roughly centered
      (clamp to scene bounds, smooth via lerp factor 0.15). Skip if the
      scene fits entirely in the viewport.

- [x] **Duplicate scene + rename scene** — add a "⎘" button next to each
      scene in the scene-switcher row that clones the active scene
      (`crypto.randomUUID()` for new id, "(copy)" appended to name, fresh
      ids for items but same assetIds). Add a "✎" button on the active
      scene name in the header that lets you inline-edit the name.

- [x] **⌘+Enter (Ctrl+Enter on Win) submits FORGE** — the textarea already
      submits on Enter. Add ⌘/Ctrl+Enter as a redundant shortcut so users
      with the modifier habit don't get a newline instead of a submit.
      Keep Shift+Enter for newlines (already works).

- [x] **Auto-open Settings on first FORGE without a key** — when the user
      clicks FORGE while `openaiKey` is empty, open the Settings modal
      instead of letting the request fail with a 401. After they save a
      key, retry the original submit automatically.

- [x] **Inline-edit textarea rotating placeholder** — the per-card ✏️
      panel's textarea is empty when opened. Cycle through 4-6 example
      phrasings as the placeholder ("with red overalls", "now broken",
      "in winter", "with a hat"). Pick one based on `asset.assetType`
      so a character gets character-y suggestions and a tile gets
      tile-y suggestions.

- [x] **Bulk asset operations** — add a "Select" toggle in the gallery
      header that turns on multi-select on AssetCards (add a checkbox
      in the corner). When 1+ are selected, show an action bar:
      "Delete N", "Tag…", "Add to scene N". Don't change single-click
      behavior outside of select mode.

- [x] **Storage usage indicator in header** — call
      `navigator.storage.estimate()` on hydration, show a tiny
      "💾 142 MB / 2 GB" line in the header. Re-fetch every 30 s. If
      `usage / quota > 0.8`, color the line yellow; > 0.95, red.

- [x] **Asset gallery sort options** — small dropdown next to the search
      box: "Newest" (default), "Oldest", "Name A-Z", "Type". Sort
      `recent[]` accordingly before rendering.

### Lower-impact

- [x] **Procedural default character sprite — better art** — replace the
      crude colored-rectangle drawing in `makeDefaultCharacterDataUrl()`
      with a 32×32 hand-drawn pixel character that matches the cozy
      preset. Same shape (head, body, legs, arms) but with anti-jagged
      pixel placement, brown overalls, beige skin, brown hair. Keep
      the procedural approach (canvas drawing, deterministic).

- [x] **Sound trigger preview button** — in the side-panel "🔊 Sound"
      block, add a "▶ Preview" button that plays the sound once at the
      configured volume without entering Play mode. Stop on a second
      click or when the audio ends.

- [ ] **NPC dialogue + speech bubble** — add an optional `dialogue?:
      string` field to `SceneItem`. In the side-panel for character/
      creature items, show a textarea below the patrol section. In Play
      mode, when the player walks within 32px of an NPC with non-empty
      dialogue, render a small white speech-bubble div above the NPC
      with the text. Hide on exit.

- [ ] **Project import** — add a "📥 Import project" button to the
      ProjectSwitcher dropdown. Accept a `.zip` exported by the existing
      Export feature. Read `assets.index.json` + each asset PNG +
      `scene.manifest.json` files. Create a new project record with
      fresh ids, populate assets and scenes. Show success toast.

- [ ] **Scene mini-map in Play mode** — in the bottom-right corner of
      the scene-player viewport, render a 120×120 div showing a
      downscaled view of the whole scene (background + items), with a
      small viewport-rectangle indicating where the camera is. Update
      every rAF tick. Hide when the scene fits in the viewport.

## Items deferred from cron (need user attention)

These came out of the audit but are too big/risky for autonomous work:

- [SKIP-CRON] **Split page.tsx into multiple files** — 5,400-line file,
  significant React refactor, easy to break cross-cutting state.
- [SKIP-CRON] **Bring back inpainting** — requires per-card UI design
  decisions and the MaskPainter integration into the inline edit panel.
- [SKIP-CRON] **CI / test suite** — needs GitHub Actions config + the
  user's call on what to test.
- [SKIP-CRON] **Drop the API-route proxy** — architectural change with
  CORS / security implications; user should decide.
- [SKIP-CRON] **Multi-character party** in Play mode.
- [SKIP-CRON] **Scripted scenes** (visual node graph or small DSL).
- [SKIP-CRON] **Animation editor** for sprite-sheet cell repair.

## When everything in Phase 6 is checked

- Append a "PHASE 6 COMPLETE" entry to `CRON-LOG.md` with the date.
- Don't add new items autonomously. Stop firing.
