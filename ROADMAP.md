# Pixel Play — Roadmap

This file is read by the autonomous cron. Each fire ticks off the **first
unchecked item in any phase** (skipping `[SKIP-CRON]`) and logs to
`CRON-LOG.md`. When everything is checked, the cron exits early.

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

- [x] **NPC dialogue + speech bubble** — add an optional `dialogue?:
      string` field to `SceneItem`. In the side-panel for character/
      creature items, show a textarea below the patrol section. In Play
      mode, when the player walks within 32px of an NPC with non-empty
      dialogue, render a small white speech-bubble div above the NPC
      with the text. Hide on exit.

- [x] **Project import** — add a "📥 Import project" button to the
      ProjectSwitcher dropdown. Accept a `.zip` exported by the existing
      Export feature. Read `assets.index.json` + each asset PNG +
      `scene.manifest.json` files. Create a new project record with
      fresh ids, populate assets and scenes. Show success toast.

- [x] **Scene mini-map in Play mode** — in the bottom-right corner of
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

## Phase 7 — AI-native polish (Hermes-inspired)

After studying Nous Research's Hermes Agent, three patterns stood out:
**SKILL.md procedural memory** (auto-created from successful flows),
**MEMORY.md / USER.md frozen-into-system-prompt knowledge**, and
**self-improving prompts**. The items below adapt those patterns to
Pixel Play's creative-tool context.

### Foundation — Project Memory

- [x] **Project MEMORY blob — data layer** — add a `Project.memory?:
      string` field (markdown text, soft-cap ~2200 chars). Persists with
      the rest of the project state in IndexedDB. Add a `setProjectMemory(
      currentId: string, memory: string)` mutator. Don't surface in UI yet
      — just plumb the storage. Migration: undefined = use `projectStyle.
      text` as the seed value when first read.

- [x] **Project MEMORY UI — sidebar editor** — extend the existing
      ProjectStyleSection (the `🎨 Project style — Cozy ▸` collapsible)
      with a second textarea below the existing style input, labeled
      "🧠 Project memory" with placeholder "Things learned about this
      project — naming conventions, palette, recurring characters…
      Edit me or let Pixel Play update it after good generations." Bind
      to `setProjectMemory`. ~2200-char counter under the textarea.

- [x] **Project MEMORY injection into generation prompts** — both
      `extractScene` and `gptLayout` system prompts in the API routes,
      and the `slimPromptFor` / `fullPrompt` builders in `app/api/generate
      /route.ts`, take an optional `projectMemory: string` field via the
      request body. When present, append it as a `PROJECT MEMORY:\n<text>`
      block at the end of the system message. Same for `editAssetInline`.
      Pass `currentProject?.memory` from the client side.

### Recipes — procedural memory

- [x] **Recipe data model + persistence** — new `Project.recipes?:
      Record<string, Recipe>` where `Recipe = { id; name; description?;
      mode: GenMode; prompt: string; perspective; pose?; quality;
      variants; gridSize; styleOverride?; createdAt; usageCount }`. New
      mutators `saveRecipe(name, fromCurrentForm)`, `applyRecipe(id)` (sets
      every form field), `deleteRecipe(id)`. Bump `usageCount` on apply.
      Persist in same IndexedDB project record.

- [x] **Recipes tab — third right-tab** — add a "📋 Recipes" tab next
      to `📦 Assets` and `🎬 Scenes` in the right panel. List rows
      sorted by `usageCount DESC, createdAt DESC`. Each row shows name,
      mode emoji, prompt preview (first 60 chars), `usageCount × times`,
      and an "Apply" button that calls `applyRecipe(id)`. A "💾 Save current
      form as recipe" button sits in the FORGE form header next to the
      Type buttons; click → prompts for a recipe name → saves.

- [x] **Recipe import / export** — extend the existing project export to
      include `recipes` in the manifest, and the import path to reconstruct
      them. Stable cross-project format = the Recipe type minus `id` (re-
      allocated on import). Pure plumbing on top of the existing
      JSZip exporter / importer.

### User profile — across-projects defaults

- [x] **User profile in localStorage** — new key `pixelplay:user-profile:v1`
      with `{ preferredMode?: GenMode; preferredQuality?: Quality;
      preferredPreset?: StylePreset; preferredPerspective?: Perspective;
      verbosityHint?: "terse" | "verbose" }`. Read on hydration; auto-update
      after every successful FORGE (decay-weighted: a single FORGE doesn't
      override the saved value, but 5+ same-mode submissions in a row do).
      When a NEW project is created via `createProject`, seed its
      `projectStyle` and form defaults from the profile.

### Self-improving prompts

- [x] **Prompt-augmentation memory** — when a generation hits a moderation
      block or returns an error 2× in a row for similar prompts, append a
      one-line note to the project's MEMORY blob: e.g. `"Avoid the phrase
      'X' for asset Y — moderation blocks it."` Implementation: track the
      last 3 errors keyed by prompt-prefix; on the third matching error,
      stuff a synthesized note (gpt-4o-mini, ~30 tokens of input, 30 of
      output) into the project memory. Cron-able as plumbing only — the
      live error→memory loop will fire when users run the app.

### Auto-curation

- [x] **"Save as recipe?" toast after similar repeat FORGEs** — track the
      last 10 successful generations in session-only state. When 3+ have
      the same `genMode` and ≥60% prompt-token overlap, surface a small
      toast in the chat panel: `🪄 Save this pattern as a recipe?` with a
      "Save" button that opens the recipe-name prompt. Dismissible.

### Semantic asset memory

- [x] **Asset embeddings — generation-time** — when a new asset is created,
      fire one cheap `gpt-4o-mini` embeddings call with the asset's
      `name + prompt + tags` text, store the resulting vector on
      `Asset.embedding?: number[]`. Asset record grows by ~6 KB; well
      within IndexedDB budget. Plumb the call through `/api/embed` route
      (new); UI implications come in the next item.

- [x] **Semantic search in the gallery** — extend the existing search box
      to do vector cosine matching when the query has no exact substring
      hits in the standard fields. New helper `app/lib/cosineSearch.ts`.
      Falls back to substring match silently. UI: small "🧠 semantic"
      hint chip when the displayed results came from vector search.

### Items deferred from cron in this phase

- [SKIP-CRON] **Concierge agent mode** — multi-turn chat agent that drives
  the form via tool calls. Substantial — needs a `/api/agent` route, tool
  schema, conversation state, multi-turn UI redesign.

---

## Phase 8 — Polish & Ship

Make the project presentable and export-friendly for real game developers.

### Documentation & onboarding

- [x] **README overhaul** — rewrite README.md with feature list, environment
      variable reference (OPENAI_API_KEY, OPENAI_EMBED_MODEL, OPENAI_CHAT_MODEL),
      quick-start steps, and a "What's inside" section covering FORGE / Scene
      editor / Play mode / AI memory. No screenshots (can't generate); use
      ASCII art or text diagrams for structure.

- [x] **First-visit onboarding modal** — detect a `"onboarded"` localStorage
      flag on mount. If absent, show a 4-step modal: (1) FORGE to create assets,
      (2) drag to Scene, (3) Play mode walkthrough, (4) Settings for API key.
      Each step has a title + 2-sentence body + Next button; final step has a
      "Get started" button that sets the flag and closes. Dismissible at any
      step via ✕.

### Game-engine export

- [x] **Tiled JSON export** — add an "Export Tiled JSON" button in ScenesView
      (next to the existing Export PNG/ZIP). Serialises the active scene's tile
      grid layers into a Tiled 1.10-compatible `.tmj` file (JSON map format):
      `tiledversion`, `width`/`height` in tiles, `tilewidth`/`tileheight`,
      one `tilelayer` per tile grid layer with a flat `data` array, and one
      `objectgroup` layer listing each non-tile CanvasItem as a Tiled object
      with `x`, `y`, `width`, `height`, `name` (asset name), `type`
      (assetType). Triggers a JSON file download.

- [x] **Sprite atlas manifest in ZIP export** — when `exportProject` bundles
      the ZIP, also write an `atlas.json` at the root. Format: array of entries
      `{assetId, name, assetType, file, frameWidth, frameHeight, cols, rows,
      pivotX, pivotY}` where pivot defaults to bottom-center (0.5, 1.0) for
      characters and center (0.5, 0.5) for items/scenes. Unity's
      TexturePacker-compatible importer and Godot's AtlasTexture can both read
      this shape. No changes to existing ZIP structure — just an extra file.

---

## Phase 9 — Multi-model Image Generation

Let users choose a cheaper/faster image provider as an alternative to
gpt-image-1 (~$0.04/image). FAL.ai's Flux Schnell runs at ~$0.003/image.

- [x] **FAL.ai route** — new `app/api/generate-fal/route.ts`. Accepts the
      same body shape as `/api/generate` (prompt, size, quality, n). Calls
      the FAL REST API (`https://fal.run/fal-ai/flux/schnell`) with
      `x-fal-key` from header or env `FAL_API_KEY`. Returns `{urls: string[],
      cost: number}` in the same shape the client expects. No image editing
      or sprite-sheet support in v1 — single images only.

- [x] **Provider selector in Settings** — add an `imageProvider:
      "openai" | "fal"` field to localStorage prefs (default `"openai"`).
      SettingsModal gains a "Image model" radio group: "OpenAI gpt-image-1"
      and "FAL Flux Schnell (fast/cheap)". Showing FAL reveals a second API
      key input (`fal-key`) stored separately in localStorage. Both inputs
      get the same 👁 toggle + "Test" button pattern as the existing OpenAI
      key field.

- [x] **Client dispatcher** — in `app/page.tsx`, `handleSubmit` and
      `editAssetInline` read `imageProvider` from prefs and POST to either
      `/api/generate` or `/api/generate-fal` accordingly. Pass the FAL key
      via `x-fal-key` header (same as `x-openai-key` pattern). FAL route
      returns a single URL per image; the existing multi-image flow maps
      over `urls[]` identically. Cost tracking uses the returned `cost`
      field from whichever route fired.

---

## Phase 10 — Concierge Agent

Promote Concierge from SKIP-CRON to a fully cron-able multi-fire build.
Multi-turn chat agent that *drives* the FORGE form via tool calls — user
says "make me a cozy forest tileset" and the agent generates the assets.

- [x] **Agent tool schema** — define four tools the agent can call:
      `forge_asset` (prompt + mode + quality → triggers generation),
      `list_assets` (returns current asset names/types as context),
      `set_project_memory` (writes a string to project MEMORY blob),
      `apply_recipe` (by recipe name or id). Store the schema as
      `app/lib/agentTools.ts` exporting a `AGENT_TOOLS` constant
      (OpenAI function-calling format).

- [x] **/api/agent route** — `app/api/agent/route.ts`. Streaming SSE
      endpoint. Accepts `{messages: ChatMessage[], projectContext: string}`.
      Calls `gpt-4o` with the agent tool schema; streams back deltas.
      When a `tool_use` block arrives, returns it as a `data: {tool, args}`
      SSE event for the client to execute; client POSTs
      `tool_result` back in the next message turn. Capped at 8 turns to
      prevent runaway loops. Uses `x-openai-key` header.

- [x] **Agent chat panel UI** — collapsible drawer at the bottom of the
      left (FORGE) panel. Toggle with a "🤖 Agent" button in the panel
      header. Drawer shows a scrolling message list (user/assistant/tool
      chips) and a text input. Sends to `/api/agent`, streams response,
      renders tool-call chips ("⚙ forge_asset: warrior elf…") inline.
      No structural refactor of FORGE form — agent chips appear above it.

- [x] **Agent executes tools** — when the stream emits a `forge_asset`
      tool event, the client calls `handleSubmit` with the tool's prompt
      and mode. `list_assets` returns the current `allAssets` snapshot as
      a JSON string back to the agent. `set_project_memory` calls the
      existing `setProjectMemory` mutator. `apply_recipe` calls
      `applyRecipe`. Tool results are sent as the next user message to
      continue the conversation.

---

## Phase 11 — Share & Collaborate

Let users share projects via a link and (optionally) co-edit in real time.

- [x] **Project share link — upload** — new `/api/share/route.ts` that
      accepts a multipart ZIP body (same format as exportProject), stores
      it in Vercel Blob (`@vercel/blob`) with a random UUID key, and
      returns `{url, id}`. Button "🔗 Share link" appears next to
      "⬇ Export ZIP" in the project switcher — clicking exports the ZIP
      in-browser, POSTs it to `/api/share`, then copies the returned URL
      to clipboard and shows a toast "Link copied!".

- [x] **Project share link — import** — on page load, detect
      `?import=<id>` in `window.location.search`. If present, fetch the
      blob URL via `/api/share?id=<id>` (GET returns a redirect to the
      blob), pipe through the existing `importProject(file)` flow, and
      clear the query param after import. Shows a "Importing shared
      project…" spinner in the header during the fetch.

- [x] **Real-time scene sync** — add a `syncEnabled` toggle in project
      settings (off by default). When on, open a Supabase Realtime channel
      named `scene:<projectId>:<sceneId>`. Broadcast each `updateScene`
      call as a JSON patch; receive remote patches and apply via
      `updateScene(..., { record: false })` so remote edits don't pollute
      the undo stack. Show a green "● live" dot in the scene header when
      the channel is open. Requires `NEXT_PUBLIC_SUPABASE_URL` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.

---

## Phase 12 — UI/UX polish

Ten focused items to make the app feel more cohesive, discoverable, and
pleasant to use. Each is one cron-fire scoped — bound the diff tightly,
match existing `farm-ink` / `farm-grass` / `farm-parchment` color tokens
and pixel-art typography (no new font imports, no new color systems).

### Feedback & dialogs

- [x] **Toast notification system** — replace ad-hoc `alert()` calls
      across `app/page.tsx` with a styled toast queue. Component lives at
      `app/components/ToastHost.tsx` and renders a stacked column in the
      top-right corner. Each toast has a `kind: "info" | "success" |
      "error"`, optional emoji prefix, ~3.5s auto-dismiss, click-to-
      dismiss, fade-out animation. Expose a global `useToast()` hook (or
      a `toast()` function via a module-level event bus) so any component
      can fire one. Migrate the 6–10 existing `alert()` sites in
      `app/page.tsx` to use it. Don't change `confirm()` — that's the
      next item.

- [x] **Confirmation dialog component** — new `ConfirmDialog` modal
      component matching the existing Settings/Trash modal styling
      (centered, dark overlay, farm-wood border). Replaces browser
      `confirm()` calls in destructive flows: clearAll, emptyTrash,
      deleteProject, deleteScene, deleteRecipe. Supports `title`,
      `body`, `confirmLabel` (red for destructive), `cancelLabel`,
      and resolves a Promise. A `useConfirm()` hook wraps this so the
      call sites stay one-liners (`if (await confirm({...})) ...`).

### Discoverability

- [x] **Keyboard shortcuts help modal** — pressing `?` (Shift+/)
      anywhere outside an input opens a modal listing every shortcut,
      grouped by section: FORGE (Enter, ⌘+Enter, ↑/↓ history), Scene
      editor (⌘+Z, ⌘+Shift+Z, middle-click pan, shift-click multi-
      select), Play mode (WASD/arrows, E to interact). Also surfaces a
      "⌨ Shortcuts" link in the footer for mouse-users. Source the list
      from a single constant in `app/lib/shortcuts.ts` so the help text
      can't drift from the actual handlers.

- [x] **Tooltip system** — new `app/components/Tooltip.tsx` wrapper that
      shows a styled label after 600ms hover, positioned above/below the
      target with edge clamping. Replaces the inconsistent `title=""`
      attributes on icon buttons (the cost/storage indicators, scene
      controls, AssetCard buttons, hierarchy buttons). Aria-friendly
      (uses `aria-describedby`). Don't touch every `title` site — start
      with the scene controls bar + AssetCard action row + header
      indicators (~15 buttons total).

### Empty & loading states

- [x] **Empty state illustrations + CTAs** — when the asset gallery,
      scenes tab, or recipes tab is empty, show a friendly placeholder
      block: large pixel-art emoji (🎨 / 🎬 / 📋), a one-line headline
      ("No assets yet — type a prompt to create one"), and a sub-text
      pointing at the next action. Use the same pattern as the existing
      no-results state in the search bar but elevated (centered in the
      empty area, padded). Pure CSS/JSX — no new images.

- [x] **Loading skeletons during generation** — while `busy` is true and
      a generation is in flight, render 1–4 shimmer-placeholder cards
      at the top of the asset gallery (count from the form's `n`
      variants). CSS-only shimmer (animated linear-gradient over a
      farm-ink box). Removed when the new asset cards arrive. Keeps the
      gallery feeling alive instead of relying on the chat-bubble busy
      indicator alone.

### Affordances

- [x] **Right-click context menu on assets** — right-clicking an
      AssetCard opens a small menu (positioned at cursor, edge-clamped,
      dismisses on outside click or Escape) with: Edit, Duplicate, Add
      to scene (only if scene active), Tag…, Delete. Reuses existing
      mutators — `duplicateAsset` (new tiny helper if not present),
      `deleteAsset`, the prompt() flow for tags, etc. Matches the
      existing modal styling. Don't replace single-click behavior or
      the existing in-card buttons.

- [x] **Asset preview on hover** — hovering an AssetCard for 400ms
      pops up a 2.5× zoomed preview in a portal positioned next to the
      card (left/right based on viewport edge). Useful for inspecting
      tile or sprite-sheet detail without opening the asset. Dismisses
      on mouseleave; suppressed when in select mode or while dragging.
      Pure CSS scaling; no new image fetches.

### Polish

- [x] **Animated transitions** — add small CSS transitions in three
      places: (1) asset cards fade-in on mount (200ms opacity +
      transform: translateY(4px) → 0), (2) modals slide-in (200ms
      transform: translateY(-12px) → 0 with ease-out), (3) right-tab
      switches cross-fade (150ms). All via CSS only — Tailwind
      `transition-*` and a small `animate-fade-in` keyframe in the
      global stylesheet. No new dependencies. `prefers-reduced-motion`
      gates all of it.

- [x] **Asset gallery density toggle** — a small "▦ / ▤" button in the
      gallery header (next to the sort dropdown) toggles between
      "comfortable" (current 3-column layout, larger cards) and
      "compact" (4-column, smaller cards, smaller fonts). Persisted to
      localStorage as `pixelplay:gallery-density`. AssetCard accepts a
      `density` prop and adjusts its inner padding/font-size only —
      doesn't re-implement the layout. Defaults to comfortable.

---

## Phase 13 — Scene walker quality

Make Play mode feel like a polished pixel-forest / pixel-museum walk:
the scene composes correctly, the player has a real walking animation,
the art style stays consistent across an asset set. Each item below is
one cron-fire scoped — match the existing `farm-ink` palette, keep
diffs bounded, no new dependencies.

### Composition

- [x] **Auto-background tile per scene** — when a scene has no
      `tileGrid` (or a tile grid with zero painted cells), render a
      full-canvas single-color background tile picked from the scene's
      `context`: interior → light wood-plank, exterior →
      grass-green, aerial → sand-tan. Pure CSS background-color on
      the scene viewport (no new assets generated). Add a per-scene
      `autoBackgroundColor?: string` field auto-derived at scene
      creation time from the scene context returned by `extractScene`.
      `ScenePlayer.tsx` reads it and renders it as the bottom layer
      under any tile grid layers.

- [x] **Auto-solid for blocker items** — when split-items composes a
      scene, auto-set `solid: true` on items whose name matches a
      "blocks the player" keyword list (cabin, house, building,
      tower, statue, fountain, tree, pine, oak, fir, boulder, rock,
      stone wall, gravestone, tombstone, anvil, workbench, dresser,
      wardrobe, bookshelf, fireplace, cauldron). Add a
      `defaultSolidForName(name)` helper in `app/page.tsx` and call
      it from the split-items asset-create path. Don't override
      explicit user-set values.

- [x] **Y-sort player into the painter list** — `ScenePlayer.tsx`
      currently renders the player separately from `sortedItems`. Fold
      the player into the same painter pass (sorted by `y +
      spriteHeight`), so a tree behind the player draws first, in
      front draws over. Player keeps its own animation logic but
      contributes to the depth sort like any other item. NPCs already
      participate; align the player to the same scheme.

- [x] **Scale enforcement in scene-layout** — extend the
      `gptLayout` system prompt in `app/api/scene-layout/route.ts`
      with a strict scale rubric: trees / large buildings 0.25–0.40,
      characters 0.15–0.20, mid-size props 0.10–0.18, small ground
      props 0.06–0.10. Add a worked example showing the relative
      sizes. After parsing, clamp returned scales into [0.04, 0.5]
      defensively. The current rules mention scale but don't penalize
      a tree returned at 0.08.

### Walking animation

- [x] **Idle bobble** — when the player has been stationary for >250 ms,
      add a 1px vertical sine-wave bob (period 1200 ms) to the rendered
      Y position. Stops the moment movement input arrives. Pure
      `ScenePlayer.tsx` change in the rAF tick — no new state, just a
      `Math.sin(performance.now() * ...)` offset applied at render time.

- [x] **Player + NPC shadow ellipses** — render a soft dark ellipse
      under each character sprite (player, NPC, any character item
      while in Play mode). 60% sprite width, 14% sprite height, 28%
      black, slight blur via `radial-gradient` background. Renders
      just below the sprite as part of the same draw layer so it
      moves with the character. Adds depth without any new images.

- [x] **Walk-cycle slicing robustness** — `sliceSheet` in
      `app/lib/sprites.ts` currently assumes the LLM-returned sprite
      sheet is laid out exactly cols × rows. When the model returns a
      4-cell row in a 4×4 sheet (e.g. blank rows 2–4), the slice is
      garbage. Add a "non-empty cell" detection pass: count cells
      whose centre 50% has any non-transparent pixels; if the
      detected non-empty count is closer to a 1×4 layout, re-slice
      as 1×4. Fall back to original if ambiguous.

- [x] **Diagonal walk handling** — when both Up+Right (etc.) are held,
      the current direction logic in `ScenePlayer.tsx` may freeze the
      cycle or pick neither. Pick the axis with the larger absolute
      input as the dominant frame direction; tiebreak by previous
      direction (sticky). Pure logic change in the input-to-direction
      mapping.

### Art consistency

- [x] **Style reference threaded through every split-items call** —
      audit `composeSceneFromAssets` and the split-items branch of
      `app/api/generate/route.ts`: every per-item image-gen call
      should receive the project's `referenceUrls` (style ref + any
      scene-level reference). If any branch is missing it, plumb it
      through. Goal: every generated asset in a scene shares the same
      visual reference, eliminating the per-asset style drift.

### Atmosphere

- [x] **Ambient context particles** — when Play mode is active,
      render 6–10 drifting CSS-only particles tied to the scene's
      context: interior → soft dust motes (warm white, 3px, slow
      Brownian); exterior → green/yellow leaves (3–4px, gentle
      diagonal drift); aerial → small white clouds drifting east
      across the camera. New `app/components/AmbientLayer.tsx`,
      mounted inside `ScenePlayer.tsx` above tiles and below items.
      Particles loop seamlessly. `prefers-reduced-motion` disables.
      No new images — use small CSS shapes.

---

## Phase 14 — Unpacking-level composition

Driven by the May 10 playtest: scene composition doesn't deeply
understand the visible bounds and category of generated items. The
relation system from playtest fire #aa87ca5 lays positions logically
but uses `scale × longest` to estimate host height — which is wrong
when gpt-image-1 returns a sprite with transparent padding (lamp
floats above the actual nightstand top edge).

Target: rooms that LOOK like a hand-composed Unpacking room — items
on real surfaces, categorically appropriate, no floaters. We won't
match Witch Beam's hand-tuned aesthetic, but we can close the gap on
positioning correctness.

Strategy: six sub-systems. Each item is one cron fire, bounded diff.

### Bounds & categories — foundation

- [x] **Sprite-bounds analysis** — after a successful image generation,
      run a small canvas pixel-analysis to find the bounding box of
      the non-transparent content. Store as `Asset.bounds = { top,
      bottom, left, right }` (fractions 0–1 of the image dimensions).
      Plumb the analysis through `app/lib/sprites.ts` (new helper
      `analyzeBounds(dataUrl)`) and call it in the image-arrives
      handlers in `app/page.tsx` (handleSubmit + editAssetInline +
      composeSceneFromAssets paths). Persist on Asset (already in
      IDB) + include in project export's `assets.index.json`. No UI
      change. Build clean.

- [x] **Asset category labeling** — extend the existing /api/embed
      pipeline (or add a sibling `/api/classify` route) to also
      return a category for each generated asset: one of
      `bedding | seating | table | storage | kitchen | electronics |
      decor | clothing | tool | book | food | plant | container |
      lighting | art | toy | weapon | vehicle | other`. Run as one
      cheap gpt-4o-mini chat completion per batch (so the bulk
      generation of 5 items is one chat call, ~$0.0003). Store as
      `Asset.category?: string`. Fall back gracefully when the API
      key is absent. Persist + export.

### Room-type schema

- [x] **Room-type detection in extractScene** — extend `extractScene`
      in `app/api/generate/route.ts` to return a `roomType` field
      alongside the existing `context`: one of `bedroom | kitchen |
      bathroom | living-room | office | workshop | shop | tavern |
      potion-shop | blacksmith-forge | wizard-study | forest |
      meadow | desert | beach | mountain | dungeon | cave | other`.
      Add worked examples teaching the model to pick the type.
      Pipe roomType back through the response and persist on the
      created Scene record (new `Scene.roomType?: string` field).

- [x] **Room-type category whitelist** — new `app/lib/roomCategories.ts`
      exports `ROOM_CATEGORIES: Record<RoomType, Category[]>` defining
      which item categories naturally belong in which room types
      (bedroom → bedding/lighting/decor/clothing/book/electronics;
      kitchen → kitchen/food/container/lighting/storage; etc.).
      Pure data, no runtime logic yet — used by the validation pass
      below.

### Surface-aware placement

- [x] **Surface-aware relation resolver (client-side rewrite)** — move
      the relation-resolution logic from `/api/scene-layout/route.ts`
      to a new client-side helper `app/lib/resolveRelation.ts` that
      can access `Asset.bounds`. Server still parses + validates the
      `relation` field and returns it alongside raw (x, y, z). Client,
      in `composeSceneFromAssets`, calls `resolveRelation(item,
      hostItem, hostAsset, childAsset)` to compute the actual snap
      position using both items' bounds. For "on": child's foot lands
      at `host.y - (host.height_via_bounds) + small_overlap`. For
      "beside": child's center is offset by `(host.width_via_bounds +
      child.width_via_bounds) / 2`. Defensive fallback to the
      scale-based math when bounds are missing (legacy assets).

### Validation

- [x] **Item-room validation badge** — after `composeSceneFromAssets`
      creates a scene, walk its items and check each asset's category
      against the scene's roomType whitelist. Items that don't match
      get a yellow "⚠ unusual for this room" badge in the hierarchy
      panel. Doesn't auto-drop them (the LLM may know something
      contextual), just surfaces the mismatch so users can fix.
      Track count in `Scene.unusualItemCount` (recomputed each time
      items change).

### Polish

- [x] **Multi-anchor surfaces per asset (stretch)** — for assets in
      categories that conceptually have multiple usable surfaces
      (storage / seating / table / counter), add a one-time second
      chat call after generation: "looking at this descriptor, list
      the named placement zones a player could put items on, as
      bbox fractions of the image." Returns `Asset.anchors?: Array<{
      name: string; x: number; y: number; w: number; h: number }>`.
      The resolver picks the most-appropriate anchor when applying
      "on" relations based on the child's category (lamp → top
      surface, book → top surface, drawer-pull → side surface).
      Defensive: empty anchors fall back to the bounds-derived top.

- [ ] **Snap-feedback in edit mode** — when the user drags an item in
      `SceneCanvas` and hovers near another item's known surface
      (using its bounds), show a thin green outline on the snap
      zone. On pointerup-near-zone, the item's position is adjusted
      to the snap position (and a `relationTo` link is auto-created
      between the dragged item and its host). Small sound effect
      via the existing audio infrastructure. Pure UX layer over the
      bounds + categories systems above — depends on them landing
      first.

---

## When everything in every phase is checked

- Append a "ALL PHASES COMPLETE" entry to `CRON-LOG.md` with the date.
- Don't add new items autonomously. Stop firing.
