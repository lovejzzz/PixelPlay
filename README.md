# Pixel Play

Pixel-art asset and scene studio powered by OpenAI. Describe what you want,
get back drop-in-ready game assets — characters, items, tiles, buildings,
creatures, UI icons, sprite sheets, animated walk cycles, and whole composed
scenes.

Five visual presets out of the box (cozy farming RPG, SNES JRPG, Game Boy,
NES, monochrome) plus color-palette enforcement, so it's not locked to one
aesthetic. Bring your own OpenAI key — Pixel Play stores it in your browser
and never sends it to any server other than OpenAI.

```
┌─────────────────────────────────────────────────────────────────┐
│  FORGE (left)        │  Canvas / Scenes (center)  │  Assets /   │
│  • prompt input      │  • drag-drop editor         │  Scenes /   │
│  • type / quality    │  • tile painter             │  Recipes    │
│  • style preset      │  • play mode                │  (right)    │
│  • project memory    │  • mini-map                 │             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Quick start

### Deploy to Vercel (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flovejzzz%2FPixelPlay&project-name=pixel-play&repository-name=pixel-play)

One click — Vercel imports the repo and gives you a public URL in under a
minute. No env vars required; every visitor sets their own OpenAI key in the
in-app Settings (stored in their browser only).

> **Vercel Hobby** caps serverless functions at 60 s — plenty for single
> assets, occasionally tight for big split-item scenes. If you hit timeouts,
> upgrade to Pro and raise `maxDuration` in `app/api/generate/route.ts`.

GitHub Pages won't work — Pages is static-only and Pixel Play has Next.js
API routes that proxy to OpenAI (CORS blocks direct browser → OpenAI calls).

### Run locally

```bash
git clone https://github.com/lovejzzz/PixelPlay.git
cd PixelPlay
npm install
npm run dev
```

Open `http://localhost:3000`, click **⚙ Settings** in the top-right, and paste
your OpenAI key.

> Get a key at <https://platform.openai.com/api-keys>.  
> ChatGPT Plus / Pro subscriptions don't include API credits — billing is
> separate. Image generation requires
> [organization verification](https://platform.openai.com/settings/organization/general).

---

## What's inside

### FORGE — asset generation

The left panel is the main generation interface:

- **Six asset types** — character, item, tile, building, creature, UI icon
- **Two perspectives** — top-down or 2D side-view (auto-selected per item when
  composing a scene: interior → front-on, aerial → top-down, exterior → smart mix)
- **Character poses** — single frame, 4-direction sheet, 4-frame walk cycle,
  full 4×4 sprite sheet
- **Variants** — 1× / 2× / 4× in a single API call
- **Quality** — low / medium / high (cost trade-off)
- **Five style presets** — cozy farming RPG, SNES JRPG, Game Boy (4 greens),
  NES, monochrome
- **Project style anchor** — free-text descriptor + optional reference image
  appended to every generation so the whole project stays consistent
- **⌘+Enter / Ctrl+Enter** submits; Shift+Enter inserts newline
- **Prompt history** — up/down arrow on the textarea recalls last 30 prompts
- **Rotating placeholder** on the inline-edit textarea — cycles type-specific
  example phrasings every 2 s ("with red overalls", "in autumn colors", etc.)
- **Auto-open Settings** — if you click FORGE without a saved key, Settings
  opens and your prompt is queued for replay once you save a key

### Scene editor

The center canvas is a full scene editor:

- **Drag** any gallery asset onto the canvas to add it
- **Multi-select** with shift-click or rubber-band drag; group move
- **Undo / redo** — Cmd+Z / Cmd+Shift+Z (per-scene stack, depth 30)
- **Rotation handle** — blue dot above the selected item; drag to rotate
- **Snap-to-item guides** — green alignment line snaps item center to nearby
  item centers within 6 px
- **Flip X / Y** and numeric x/y/scale inputs in the side panel
- **Tile painting** — multiple z-ordered tile layers, per-layer tile-asset
  dropdown, ✏ Paint / 🧽 Erase / ▣ Fill rect / ⬛ Fill layer tools
- **Background tile** — fill the scene background with any tile asset
- **Point lights** — radial-gradient screen-blend overlay in play mode
- **Particle emitters** — sparkle / smoke CSS animations
- **Day/night tint** — slider lerps a 5-stop palette (midnight → noon → dusk)
- **Sound triggers** — play audio on player entry with configurable URL, volume,
  loop; preview button in the side panel
- **Trigger zones** — AABB message zones; fires a message log on player entry
- **NPC dialogue** — speech bubble appears above an NPC when the player walks
  within 32 px
- **Duplicate scene** (⎘) and **rename scene** (✎) buttons
- **Export** — composite PNG + scene manifest JSON + referenced assets as ZIP

```
Scene layout (1024 × 1024 default, tile size configurable)

  z=0  Tile layers (ground, decoration, …)
  z=1  Trigger zones + sound triggers (invisible in play mode)
  z=2  Scene items (buildings, props, characters, NPCs)
  z=3  Point-light overlay (mix-blend: screen)
  z=4  Particle emitters
  z=5  Day/night tint overlay (mix-blend: multiply)
  z=6  Player character
```

### Play mode

Press **▶ Play** to walk the scene:

- **WASD / arrow keys** move the player character (sprite-sheet directional
  walk animation when a 4×4 sheet is detected)
- **Camera follow** — smooth lerp (factor 0.15) keeps the player centred;
  clamped to scene bounds; skips when the scene fits the viewport
- **Item pickup** — walk over any item with the Pickup flag set; appears in the
  inventory HUD (top-right)
- **Doors / portals** — walk into a portal to switch to the linked scene
- **NPC patrol** — NPCs walk between waypoints at configurable speed, support
  loop and ping-pong; NPCs animate directionally from their sprite sheet
- **Mini-map** — 120×120 overlay in the bottom-right corner showing the full
  scene with a camera-rectangle indicator; hidden when the scene fits the viewport

### AI memory

Pixel Play keeps project context across sessions and uses it to improve
every generation:

- **Project MEMORY blob** — a ~2 200-char markdown note stored per project in
  IndexedDB. Edit it in the Project style collapsible (🧠 Project memory
  textarea). It's appended as a `PROJECT MEMORY:` block to every image-gen,
  scene-parse, and layout system prompt.
- **Recipes** — save any FORGE form state as a named recipe (📋 Recipes tab,
  right panel). Recipes record mode, prompt, quality, perspective, style
  override, etc. Apply them in one click; usage count is tracked. Recipes are
  included in project ZIP exports and can be re-imported.
- **User profile** — `localStorage` key `pixelplay:user-profile:v1` remembers
  your preferred mode, quality, perspective, and preset across projects.
  Decay-weighted: 5+ consistent submissions in a row update the profile;
  new projects are seeded from it.
- **"Save as recipe?" toast** — when 3+ recent generations share the same mode
  and ≥ 60% prompt-token overlap, a 🪄 toast offers to name and save the pattern.
- **Prompt-augmentation memory** — when a generation fails 3× with similar
  prompts (shared 12-char prefix), a `gpt-4o-mini` call synthesises a one-line
  note ("Avoid 'X' — moderation blocks it") and appends it to the project MEMORY
  blob automatically.
- **Asset embeddings** — each new asset gets a `text-embedding-3-small` vector
  stored on the record (`Asset.embedding`). The gallery uses cosine similarity
  for semantic search when the text query has no substring hits.

### Gallery & organization

- **Soft-delete trash** — deleting an asset moves it to a session trash (not
  persisted). The 🗑 Trash (N) footer link opens a modal with Restore / Empty
  trash. Scene items continue to resolve trashed assets until trash is emptied.
- **Bulk operations** — "☐ Select" mode in the gallery header: select multiple
  assets, then Delete N / Tag… / Add to scene N.
- **Sort** — Newest (default) / Oldest / Name A-Z / Type dropdown next to the
  search box.
- **Semantic search** — type a query; if no substring match is found the gallery
  queries `/api/embed` and ranks by cosine similarity. A "🧠 semantic" chip
  indicates the fallback is active.
- **Storage indicator** — 💾 usage / quota in the header; yellow at > 80%, red
  at > 95%. Polled every 30 s.
- **Multiple projects** — each with its own assets, scenes, prefabs, recipes,
  memory, and style anchor. Import / export as ZIP.
- **Prefabs** — save a multi-selection as a reusable group; drop instances
  anywhere; syncing the master propagates non-position fields to every instance.

### Export formats

| Output | Contents |
|---|---|
| Asset PNG | Raw PNG (1024² or 1024×1536 depending on orientation) |
| Sprite sheet ZIP | Composite sheet + individual frames + Phaser/TexturePacker JSON atlas + Tiled TSX |
| Scene ZIP | Composite PNG + scene JSON manifest + referenced asset PNGs |
| Project ZIP | All assets + all scenes + atlas.json skeleton + recipes.json |

---

## Environment variables

The Settings modal (⚙, top-right) is the recommended setup. To hard-code keys
on the server for a private deployment, copy `.env.local.example` to
`.env.local`:

```env
# Required for image generation, scene parsing, and embeddings
OPENAI_API_KEY=sk-proj-...

# Override the image model (default: gpt-image-1)
OPENAI_MODEL=gpt-image-1

# Override the chat model used for scene layout + split-items (default: gpt-4o-mini)
OPENAI_CHAT_MODEL=gpt-4o-mini

# Override the embedding model used for semantic asset search (default: text-embedding-3-small)
OPENAI_EMBED_MODEL=text-embedding-3-small
```

A user-supplied key entered in the Settings modal wins over the server env var
on every request.

### Alternative image provider (Replicate)

```env
PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
# REPLICATE_MODEL=stability-ai/sdxl-lightning-4step:...
```

SDXL-Lightning costs ~$0.003/image. Scene layout, split-items parsing, and
inline editing all still require an OpenAI key.

---

## API routes

| Route | Purpose |
|---|---|
| `POST /api/generate` | Image generation + inline editing + split-items scene parsing |
| `POST /api/scene-layout` | GPT scene layout (item x/y/scale/z placement) |
| `POST /api/embed` | Batch text → embedding vectors (text-embedding-3-small) |
| `GET  /api/test-key` | Validate an OpenAI key via `/v1/models` (used by Settings "Test" button) |
| `POST /api/synthesize-note` | Generate a one-line memory note from recent generation errors |

---

## File layout

```
app/
  page.tsx                  Main UI — state, mutators, FORGE, gallery, project
  layout.tsx                Root layout + global metadata
  globals.css               Pixel-art CSS (checkerboard, .pixelated, keyframes)

  api/
    generate/route.ts       Image gen (generations, edits, split-items)
    scene-layout/route.ts   GPT scene layout (item placement)
    embed/route.ts          Batch text → embedding vectors
    test-key/route.ts       OpenAI key validator (proxies /v1/models)
    synthesize-note/route.ts  Error → memory-note synthesizer (gpt-4o-mini)

  components/
    SceneCanvas.tsx         Drag/drop/tile-paint/light/trigger scene canvas
    ScenePlayer.tsx         Play-mode runtime (walk, NPCs, portals, mini-map)
    MaskPainter.tsx         Inpainting brush canvas overlay

  lib/
    cost.ts                 Session + lifetime spend tracker
    cosineSearch.ts         Cosine similarity + top-K asset ranker
    palette.ts              Built-in palettes + color-snap algorithm
    pixelate.ts             Pixel-snap downscale + nearest-neighbor upscale
    seamless.ts             Offset+blend seamless-tile post-process
    sprites.ts              Sheet slicing, Phaser atlas JSON, Tiled TSX, ZIP builder
    storage.ts              Tiny IndexedDB wrapper
    trimAlpha.ts            Auto-crop transparent border from PNGs
    userProfile.ts          Cross-project defaults in localStorage
    varietyCheck.ts         Multi-frame sheet duplicate-cell detector
```

---

## Pricing rough guide

OpenAI image generation, per image:

| Quality | 1024×1024 | 1024×1536 / 1536×1024 |
|---|---|---|
| Low | ~$0.011 | ~$0.016 |
| Medium | ~$0.042 | ~$0.063 |
| High | ~$0.167 | ~$0.250 |

Scene layout and split-items each add one `gpt-4o-mini` chat call (~$0.0002).
Semantic search embeds the query text via `text-embedding-3-small` (~$0.00002).

---

## Notes & limits

- **OpenAI moderation** — some prompts get blocked. Pixel Play passes
  `moderation: "low"` and avoids named real people in prompts. Repeated
  failures are logged to project MEMORY automatically.
- **Multi-frame layouts** — `gpt-image-1` is best-effort on grid layouts.
  The variety check flags sheets with near-identical cells; regenerate or use
  the inline edit flow.
- **Rate limits** — split-items scenes fire up to 8 parallel generation
  requests. Failures come back per-item; the rest succeed. Failed items show
  a ⚠ badge on the scene card.
- **Scenes are 1024×1024** by default. Item scale defaults to 0.2 (≈ 204 px
  on the longest edge). Tile size is configurable per scene.
- **Storage** — assets live in IndexedDB (typically gigabytes available).
  The storage indicator in the header shows current usage vs quota.
