# 🎮 Pixel Play

Pixel-art asset & scene studio. Describe what you want, get back drop-in-ready
game assets — characters, items, tiles, buildings, creatures, UI icons,
sprite sheets, animated walk cycles, and whole composed scenes.

Five visual presets out of the box (cozy farming RPG, SNES JRPG, Game Boy,
NES, monochrome) plus color-palette enforcement, so it's not locked to one
aesthetic. Bring your own OpenAI key — Pixel Play stores it in your browser
and never sees it server-side.

## Quick start

### Deploy to the cloud (recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flovejzzz%2FPixelPlay&project-name=pixel-play&repository-name=pixel-play)

One click → Vercel imports the repo and gives you a public URL in under a
minute. No env vars needed; everyone who visits sets their own OpenAI key in
the in-app ⚙ Settings (stored in their browser).

> Heads up: Vercel's **Hobby** plan caps serverless functions at 60 s, which
> is plenty for single-asset generations and tight for split-items scenes.
> If you hit timeouts on big scenes, upgrade to Pro and bump
> `maxDuration` in `app/api/generate/route.ts` up to 300.

GitHub Pages won't work — Pages is static-only and Pixel Play has Next.js
API routes that proxy to OpenAI (CORS blocks direct browser→OpenAI calls).

### Run locally

```bash
git clone https://github.com/lovejzzz/PixelPlay.git
cd PixelPlay
npm install
npm run dev
```

Open http://localhost:3000, click **⚙ Settings** in the top-right, and paste
your OpenAI key. That's it.

> Get a key at <https://platform.openai.com/api-keys>. The key lives in your
> browser's `localStorage` and is sent to your local server only as a
> per-request header. ChatGPT Plus/Pro subscriptions don't include API
> credits — API billing is separate. Image generation requires
> [organization verification](https://platform.openai.com/settings/organization/general).

## What it can do

### Generate
- **Six asset types**: character, item, tile, building, creature, UI icon
- **Two perspectives**: top-down or 2D side-view
- **Character poses**: single, 4-direction sheet, 4-frame walk cycle, full 4×4 sprite sheet
- **Variants**: 1× / 2× / 4× in a single API call
- **Quality**: low / medium / high (cost trade-off)
- **Five style presets**: cozy farming RPG, SNES JRPG, Game Boy (4 greens), NES, monochrome
- **Variety check** — multi-frame sheets are scanned for near-identical cells and flagged

### Edit
- Pick any asset → change anything via prompt; OpenAI's `images.edits` keeps the
  original identity intact (windows in the same place, etc.)
- **Inpainting** — brush over a region with the mask painter, prompt only that area
- **Variants** of an edit in one shot

### Compose
- **🪄 Split items** — type a scene ("a wizard's potion shop with magical items"),
  GPT parses 3-8 individual items, generates each in parallel
- **🎨 Style-lock** — the first item becomes a reference for every subsequent
  item, so the whole scene snaps to one aesthetic
- **🎬 Auto-compose** — items land on a 1024² scene canvas already laid out
  (GPT proposes x/y/scale/z; heuristic fallback)
- **Drag** any gallery asset onto the canvas to add it
- **Replace** a placed item with a new prompt; project style is preserved
- **Animate** multi-frame items in place (walk cycles loop at 8 fps)
- **Snap-to-grid** while dragging (Off / 8 / 16 / 32 px)
- **Background tile** — pick a tile asset to fill the scene's background

### Game-engine features
- **Multi-select**, group move, undo/redo, rotation handle, alignment guides
- **Tile painting** with multiple z-ordered layers, eraser, visibility toggle
- **Prefabs** — save selection as a reusable group, drop instances anywhere; edits to the master propagate
- **Play mode** — walk a character, pick up items, walk through portals between scenes, NPCs patrol along waypoints, trigger zones fire messages
- **Atmosphere** — point lights, sparkle/smoke particle emitters, day/night tint, sound triggers

### Organize
- **Multiple projects** — each with its own assets, scenes, prefabs, and style anchor
- **Search** by name, prompt, tag, or type
- **Inline rename** + comma-separated **tags** with a global filter bar
- **Cost tracker** — session + project lifetime spend visible in the header

### Export
- **PNG** — every asset
- **Sprite sheet zip** for any multi-frame asset:
  - Composite sheet PNG
  - Each frame as a separate PNG (`frames/walk_0.png`, etc.)
  - **Phaser / TexturePacker** JSON Hash atlas (`*.atlas.json`)
  - **Tiled** tileset XML (`*.tsx`)
- **Scene zip** — composite PNG + scene JSON manifest + every referenced asset
- **Project zip** — entire project (every asset, scene, prefab) in one file

### Polish
- **Color-palette enforcement** — snap any asset to NES, Game Boy, Pico-8, B&W, or a custom palette extracted from any image
- **Seamless tiles** — offset+blend post-process for tiles
- **Pixel-snap** post-process — downscale to 64/96/128 grid + nearest-neighbor upscale
- **Project style anchor** — text descriptor + reference image applied to every generation
- **Prompt history** — up/down arrow on the textarea recalls last 30 prompts

### Storage
- **IndexedDB** for assets (much higher quota than localStorage)
- API key + small project-style data live in localStorage
- One-time auto-migration from older versions

## Pricing rough guide

OpenAI image generation, per image:

| Quality | 1024×1024 | 1024×1536 / 1536×1024 |
|---|---|---|
| Low | ~$0.011 | ~$0.016 |
| Medium | ~$0.042 | ~$0.063 |
| High | ~$0.167 | ~$0.250 |

Scene parsing + scene layout add a tiny `gpt-4o-mini` chat call (~$0.0002 each).

## Optional: server-side env vars

The Settings modal is the recommended setup. If you'd rather hard-code a key
on the server (say, for a private deployment), copy `.env.local.example` to
`.env.local` and set `OPENAI_API_KEY`. A user-supplied key in the Settings
modal still wins per-request.

```
OPENAI_API_KEY=sk-proj-...
# OPENAI_MODEL=gpt-image-1
# OPENAI_CHAT_MODEL=gpt-4o-mini
```

### Replicate (alternative provider)

```
PROVIDER=replicate
REPLICATE_API_TOKEN=r8_...
```

SDXL-Lightning is ~$0.003/image. Override the model with `REPLICATE_MODEL`.
Edit mode, scene layout, and scene split all require OpenAI.

## File layout

```
app/
  page.tsx                  Main UI (chat + gallery + scenes panel)
  layout.tsx                Root layout
  globals.css               Pixel-art tweaks (checkerboard, .pixelated, fonts)
  api/
    generate/route.ts       Image gen (generations + edits + scene split)
    scene-layout/route.ts   GPT scene layout (item placement)
  components/
    SceneCanvas.tsx         Drag/drop/animate scene canvas
    ScenePlayer.tsx         Play-mode runtime (walk, NPCs, portals, etc.)
    MaskPainter.tsx         Inpainting brush canvas
  lib/
    pixelate.ts             Pixel-snap downscale + upscale
    sprites.ts              Slice sheets, build atlas + .tsx, zip
    seamless.ts             Offset+blend tile post-process
    palette.ts              Built-in palettes + color-snap algorithm
    varietyCheck.ts         Multi-frame sheet duplicate-cell detector
    cost.ts                 Spend tracker
    storage.ts              Tiny IndexedDB wrapper
```

## Notes & limits

- **OpenAI moderation** — some prompts get blocked. Pixel Play passes
  `moderation: "low"` and avoids named real people in prompts.
- **Multi-frame layouts** — `gpt-image-1` is best-effort on grid layouts.
  The variety check flags sheets with near-identical cells; just regenerate.
- **Rate limits** — 8 parallel generations may exceed Tier 1 quota.
  Failures come back per-item; the rest still succeed.
- **Scenes are 1024×1024** by default. Items are scaled fractions of the
  longest edge (default 0.2 = ~204 px).
