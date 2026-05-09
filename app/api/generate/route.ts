import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// 60s is Vercel Hobby's hard cap. Pro/Enterprise can raise this to 300s.
// Single-asset generations finish in ~20-40s; split-items with the style-lock
// chain pushes to ~50-60s, so we sit right at the limit by default.
export const maxDuration = 60;

type AssetType = "character" | "item" | "tile" | "building" | "creature" | "ui";
type Perspective = "top-down" | "side-view";
type Pose = "single" | "directions" | "walk-cycle" | "full-sheet";
type Quality = "low" | "medium" | "high";
type Size = "1024x1024" | "1024x1536" | "1536x1024";
type StylePreset = "cozy" | "snes-jrpg" | "gameboy" | "nes" | "monochrome";

const STYLE_PREFIXES: Record<StylePreset, string> = {
  cozy:
    "16-bit pixel art game asset in the cozy farming RPG style, " +
    "hand-drawn pixels, warm pastel color palette, " +
    "crisp sharp pixels, no anti-aliasing, clean silhouette, ",
  "snes-jrpg":
    "16-bit SNES JRPG pixel art, vibrant saturated colors, " +
    "dramatic outlined silhouettes, classic 1990s console game aesthetic, " +
    "crisp sharp pixels, no anti-aliasing, ",
  gameboy:
    "1989 Game Boy pixel art, strict 4-shade green monochrome palette " +
    "(very dark green, dark green, light green, lightest green), " +
    "low-resolution chunky pixels, no color, no anti-aliasing, ",
  nes:
    "8-bit NES pixel art, authentic NES color palette with limited colors per sprite, " +
    "blocky chunky pixels, simple flat shading, no gradients, no anti-aliasing, ",
  monochrome:
    "high-contrast black-and-white pixel art, atmospheric ink-like style, " +
    "no color, crisp sharp pixels, no anti-aliasing, ",
};

type Body = {
  prompt: string;
  assetType?: AssetType;
  perspective?: Perspective;
  pose?: Pose;
  quality?: Quality;
  variants?: number; // 1..4
  /** Data URLs (or http URLs) the model should use as visual references. */
  referenceUrls?: string[];
  /** Project-level style guidance — appended to the prompt. */
  projectStyle?: string;
  /** Visual style preset. Default: "cozy". */
  stylePreset?: StylePreset;
  /** Optional inpainting mask — same dimensions as the first reference image. */
  maskUrl?: string;
  /** If true, parse the prompt as a scene and generate each item separately. */
  splitItems?: boolean;
  /** Project MEMORY blob — frozen-into-system-prompt knowledge about this
   *  project (naming conventions, palette, recurring characters). Appended
   *  to every prompt-builder so the model learns the project's quirks. */
  projectMemory?: string;
};

const MAX_SPLIT_ITEMS = 8;

type Layout = {
  cols: number;
  rows: number;
  size: Size;
  hint: string;
};

function perspectiveHint(p: Perspective | undefined, assetType?: AssetType) {
  if (p === "side-view") return "viewed from the side, ";
  if (assetType === "building") return "three-quarter top-down view, ";
  if (assetType === "tile") return "strict top-down orthographic view, ";
  return "top-down view, ";
}

/** Per-item perspective for split-items scenes. Derived from the parser's
 *  scene context so a "cabin in the forest" gets a front-on cabin and
 *  top-down trees / rocks / signs, while a "cozy bedroom" gets all items
 *  drawn front-on (the way furniture reads in a top-down room view).
 *
 *  When `context` is undefined we fall back to the user's form-level
 *  `perspective` setting, preserving prior behavior. */
const FRONT_ON_KEYWORDS = [
  "cabin", "house", "cottage", "shop", "tavern", "tower", "castle",
  "barn", "shed", "hut", "tent", "lighthouse", "windmill", "stall",
  "dock", "bridge", "well", "fountain", "statue", "tombstone",
  "gravestone", "fence", "gate", "signpost", "sign", "lamp post",
  "lamppost", "fire hydrant", "tree", "pine", "fir", "oak", "cactus",
  "person", "character", "wizard", "knight", "farmer", "villager",
  "creature", "monster", "animal", "boat", "ship", "cart", "wagon",
  "barrel", "crate", "chest",
];
function perspectiveForItem(
  itemName: string,
  context: SceneContext | undefined,
  formPerspective: Perspective | undefined
): string {
  if (formPerspective === "side-view") return "viewed from the side, ";
  if (context === "interior") return "front-facing pixel-art view, ";
  if (context === "aerial") return "strict top-down orthographic view, ";
  if (context === "exterior") {
    const lower = itemName.toLowerCase();
    const isFrontOn = FRONT_ON_KEYWORDS.some((kw) => lower.includes(kw));
    return isFrontOn
      ? "front-facing pixel-art view, "
      : "top-down view, ";
  }
  return "top-down view, ";
}

function typeHint(t?: AssetType) {
  switch (t) {
    case "character": return "character sprite, full body, ";
    case "item":      return "single inventory item, centered, ";
    case "tile":      return "ground texture covering the entire frame edge to edge with the pattern, no border, no decoration, ";
    case "building":  return "small building, complete and centered, ";
    case "creature":  return "one cute small creature, full body, centered, ";
    case "ui":        return "single UI icon, flat with subtle shading, ";
    default:          return "";
  }
}

function computeLayout(pose: Pose | undefined, perspective: Perspective | undefined): Layout {
  const sideView = perspective === "side-view";
  const facingOrder = sideView
    ? "facing right, then facing left"
    : "facing south (toward camera), facing north (away from camera), facing west, facing east";

  switch (pose) {
    case "directions":
      return sideView
        ? {
            cols: 2,
            rows: 1,
            size: "1536x1024",
            hint:
              "sprite sheet layout: 2 poses arranged in a single horizontal row (cell 1: facing right, cell 2: facing left), evenly spaced with consistent character size, transparent gaps between cells, no grid lines, no labels, no border",
          }
        : {
            cols: 4,
            rows: 1,
            size: "1536x1024",
            hint:
              `sprite sheet layout: 4 poses arranged in a single horizontal row, each pose showing the character ${facingOrder} respectively, evenly spaced with consistent character size, transparent gaps between cells, no grid lines, no labels, no border`,
          };
    case "walk-cycle":
      return {
        cols: 4,
        rows: 1,
        size: "1536x1024",
        hint:
          "sprite sheet layout: 4 successive walk-cycle frames in a single horizontal row, viewed from the same direction, evenly spaced with consistent character size, transparent gaps between cells, no grid lines, no labels, no border",
      };
    case "full-sheet":
      return sideView
        ? {
            cols: 4,
            rows: 2,
            size: "1536x1024",
            hint:
              "sprite sheet layout: 2 rows × 4 columns. Top row: 4-frame walk-cycle facing right. Bottom row: 4-frame walk-cycle facing left. Cells evenly spaced with consistent character size, transparent gaps, no grid lines, no labels, no border",
          }
        : {
            cols: 4,
            rows: 4,
            size: "1024x1536",
            hint:
              `sprite sheet layout: 4 rows × 4 columns. Each row is the same character ${facingOrder} respectively. Each column is one frame of the walk-cycle. Cells evenly spaced with consistent character size, transparent gaps, no grid lines, no labels, no border`,
          };
    case "single":
    default:
      return { cols: 1, rows: 1, size: "1024x1024", hint: "" };
  }
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }

  // Prefer a user-supplied key (Settings modal) over the server-side env var.
  // This lets the deployed app be used by anyone with their own OpenAI key.
  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "No OpenAI API key. Open ⚙ Settings and paste your key, or set OPENAI_API_KEY on the server." },
      { status: 401 }
    );
  }

  const perspective: Perspective = body.perspective || "top-down";
  const pose: Pose = body.assetType === "character" ? body.pose || "single" : "single";
  const quality: Quality = body.quality || "medium";
  const variants = Math.min(4, Math.max(1, body.variants ?? 1));
  const layout = computeLayout(pose, perspective);
  const opaqueBg = body.assetType === "tile";
  const bgHint = opaqueBg
    ? ""
    : "fully transparent background, no scenery, no floor, no ground, no shadow on the ground, ";

  const styleSuffix = body.projectStyle?.trim() ? `. Project style: ${body.projectStyle.trim()}` : "";
  const presetPrefix = STYLE_PREFIXES[body.stylePreset || "cozy"] || STYLE_PREFIXES.cozy;
  // Project MEMORY block — Hermes-style frozen-into-prompt knowledge.
  // Appended at the end (after style suffix) so it's the LAST thing the
  // image model sees; concrete details there outweigh upstream framing.
  // Trimmed to a hard cap so a runaway memory blob doesn't blow the
  // image-prompt budget.
  const memorySuffix = body.projectMemory?.trim()
    ? ` PROJECT MEMORY: ${body.projectMemory.trim().slice(0, 1500)}.`
    : "";

  const fullPrompt =
    presetPrefix +
    perspectiveHint(perspective, body.assetType) +
    typeHint(body.assetType) +
    bgHint +
    body.prompt +
    (layout.hint ? ". " + layout.hint : "") +
    styleSuffix +
    memorySuffix;

  const provider = (process.env.PROVIDER || "openai").toLowerCase();

  try {
    // Scene → individual items. Calls a chat model to parse the prompt into
    // 2-8 items, then generates each as its own asset in parallel. Single-pose
    // only — multi-frame poses + scene-split would multiply cost catastrophically.
    if (body.splitItems) {
      if (provider !== "openai") {
        return NextResponse.json(
          { error: "Split items requires PROVIDER=openai" },
          { status: 400 }
        );
      }
      const { items, context: sceneContext } = await extractScene(
        apiKey,
        body.prompt,
        body.projectMemory
      );
      if (items.length === 0) {
        return NextResponse.json(
          { error: "Could not parse the scene into items. Try a different prompt." },
          { status: 400 }
        );
      }
      // Slim prompt for split items — drops assetType-specific framing
      // (irrelevant when each item could be anything), keeps perspective +
      // preset + project style + transparency. Per-item perspective is
      // derived from the scene's context: interior → all items front-on,
      // aerial → all top-down, exterior → buildings front-on, ground props
      // top-down. Falls back to the form's `perspective` field if context
      // doesn't dictate.
      const slimPromptFor = (itemName: string) =>
        presetPrefix +
        perspectiveForItem(itemName, sceneContext, perspective) +
        bgHint +
        "single " +
        itemName +
        ", centered, isolated game asset" +
        styleSuffix +
        memorySuffix;

      // Style-lock: generate the FIRST item synchronously to establish the
      // scene's visual aesthetic, then use it as a reference image for every
      // subsequent item (chained in parallel). This costs the same number of
      // image-gens but trades ~20s of wall-clock for visually consistent
      // assets across the scene.
      const fulfilled: Array<{ name: string; url: string }> = [];
      const failures: Array<{ name: string; error: string }> = [];
      const baseRefs = body.referenceUrls || [];
      let styleAnchorUrl: string | null = null;
      try {
        const firstUrls = await generateOpenAI(apiKey, {
          prompt: slimPromptFor(items[0]),
          size: "1024x1024",
          opaqueBg: false,
          quality,
          variants: 1,
          referenceUrls: baseRefs,
        });
        styleAnchorUrl = firstUrls[0];
        fulfilled.push({ name: items[0], url: styleAnchorUrl });
      } catch (err) {
        failures.push({
          name: items[0],
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Now generate items 2..N in parallel with the style-anchor reference
      // chained in front of any pre-existing project-style refs.
      const restRefs = styleAnchorUrl ? [styleAnchorUrl, ...baseRefs] : baseRefs;
      const restResults = await Promise.allSettled(
        items.slice(1).map((name) =>
          generateOpenAI(apiKey, {
            prompt: slimPromptFor(name),
            size: "1024x1024",
            opaqueBg: false,
            quality,
            variants: 1,
            referenceUrls: restRefs,
          }).then((urls) => ({ name, url: urls[0] }))
        )
      );
      for (let i = 0; i < restResults.length; i++) {
        const r = restResults[i];
        if (r.status === "fulfilled") fulfilled.push(r.value);
        else
          failures.push({
            name: items[i + 1],
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
      }

      if (fulfilled.length === 0) {
        return NextResponse.json(
          { error: "All item generations failed", failures },
          { status: 502 }
        );
      }

      return NextResponse.json({
        items: fulfilled,
        itemNames: items,
        context: sceneContext,
        failures: failures.length > 0 ? failures : undefined,
        size: "1024x1024",
        cols: 1,
        rows: 1,
      });
    }

    let dataUrls: string[];
    if (provider === "openai") {
      dataUrls = await generateOpenAI(apiKey, {
        prompt: fullPrompt,
        size: layout.size,
        opaqueBg,
        quality,
        variants,
        referenceUrls: body.referenceUrls || [],
        maskUrl: body.maskUrl,
      });
    } else if (provider === "replicate") {
      const single = await generateReplicate(fullPrompt);
      dataUrls = [single];
    } else {
      return NextResponse.json({ error: `Unknown PROVIDER: ${provider}` }, { status: 500 });
    }
    return NextResponse.json({
      urls: dataUrls,
      prompt: fullPrompt,
      size: layout.size,
      cols: layout.cols,
      rows: layout.rows,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ------------------------------------------------------------- Scene split

type SceneContext = "interior" | "exterior" | "aerial";
type ExtractedScene = { items: string[]; context: SceneContext };

async function extractScene(
  key: string,
  scenePrompt: string,
  projectMemory?: string
): Promise<ExtractedScene> {
  const memorySuffix =
    projectMemory && projectMemory.trim()
      ? `\n\nPROJECT MEMORY (the user's notes about this project — naming conventions, recurring characters, palette, etc. Treat as soft constraints when picking items):\n${projectMemory.trim().slice(0, 1500)}`
      : "";
  const sys =
    "You parse a short scene description into a list of distinct, individually-renderable 2D game-asset items.\n\n" +
    "RULE: every item must pass the COLLECTIBLE TEST — could a video-game character pick this up, walk around it, or place it in an inventory? A bed YES, a tombstone YES, a single skull YES, a treasure chest YES. The MOON no, FOG no, OCEAN WAVES no, SCATTERED BONES no (use 'a skull' instead), GROUND no (it IS the ground), SHADOW no, A SCHOOL OF FISH no (use 'one fish'), DIRT no, GRASS no (that's the background tile, not an item), SAND / SANDY BEACH no (the sand is the ground, like grass), WATER / RIVER / LAKE SURFACE no (the water is the ground/backdrop). Use 'a single seashell', 'one cactus', 'a wooden boat' instead.\n\n" +
    "RULE: NO COLLECTIVE NOUNS for distinct objects. 'A set of chairs' NO → 'a wooden chair'. 'A pair of boots' NO → 'one leather boot'. 'A flock of birds' NO → 'one sparrow'. EXCEPTION: tied-bundle phrases that read as ONE physical asset are fine — 'a bunch of carrots' (one bundle), 'a bunch of keys' (one keyring), 'a basket of apples' (one basket), 'a crate of bottles' (one crate). 'A pile of X' only OK if it visually reads as one mound (a pile of hay = ok, a pile of snowballs = no, just say 'a snowball').\n\n" +
    "STEP 1 — pick exactly one CONTEXT:\n" +
    " • interior — INSIDE a room/building. Items are furniture and props.\n" +
    " • exterior — OUTSIDE in a landscape/streetscape. Items are buildings, trees, rocks, signs, ground props.\n" +
    " • aerial — top-down map view. Items are roof-tops, paths, ponds, small ground-level objects.\n\n" +
    "If the prompt is ambiguous, pick the most evocative reading. Worked examples:\n" +
    " • 'a cabin in the forest' → exterior {a wooden cabin, a pine tree, a fir tree, a rocky boulder, a wooden signpost} — NOT a bed, NOT a fireplace, NOT a chair.\n" +
    " • 'a cozy bedroom' → interior {a bed with blankets, a nightstand, a reading lamp, a plush rug, a wooden wardrobe} — NOT the cabin's outside, NOT the front door from the street.\n" +
    " • 'a wizard's potion shop' → interior {a bubbling cauldron, a potion shelf, a spell book, a crystal ball, a magic wand}.\n" +
    " • 'a haunted graveyard at night' → exterior {a weathered tombstone, a rusty iron gate, a gnarled dead tree, a single skull, a stone statue, a wilted flower} — NOT 'scattered bones' (say 'a skull'), NOT 'full moon' (it's in the sky, not on the ground), NOT 'creeping fog'.\n" +
    " • 'a pirate ship at sea' → exterior {a wooden pirate ship, a tattered jolly-roger flag, an iron cannon, a treasure chest, a wooden barrel, a rope coil} — NOT 'ocean waves' (waves are the background), NOT 'island silhouette'.\n" +
    " • 'an underwater coral reef' → exterior {a coral fan, a single fish, a sea turtle, a starfish, a seashell, a clump of seaweed} — NOT 'school of fish'.\n\n" +
    "STEP 2 — list 3-" + MAX_SPLIT_ITEMS + " items, each 2-6 words, each starting with 'a' or 'an' or a number. Singular nouns only. Each must pass the collectible test. No item should overlap visually with another item in the list.\n\n" +
    `Return JSON: { "context": "interior" | "exterior" | "aerial", "items": ["a short descriptor", ...] }.` +
    memorySuffix;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: scenePrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return { items: [], context: "exterior" };
  try {
    const parsed = JSON.parse(content) as { items?: unknown; context?: unknown };
    if (!Array.isArray(parsed.items)) return { items: [], context: "exterior" };
    const items = parsed.items
      .filter((x): x is string => typeof x === "string")
      .map((s) => sanitizeItemDescriptor(s))
      .filter((s): s is string => !!s)
      .slice(0, MAX_SPLIT_ITEMS);
    const context: SceneContext =
      parsed.context === "interior" || parsed.context === "aerial"
        ? parsed.context
        : "exterior";
    return { items, context };
  } catch {
    return { items: [], context: "exterior" };
  }
}

/** Code-level guard against the failure modes the LLM keeps slipping on:
 *  collective nouns, environmental backdrops, atmospheric phenomena.
 *  Returns null to drop the item entirely; otherwise a cleaned descriptor. */
function sanitizeItemDescriptor(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 100) return null;
  const lower = s.toLowerCase();

  // Drop pure environmental backdrops — these aren't sprites, they're tiles
  // or sky boxes. Whole-string match (after stripping articles).
  const stripped = lower.replace(/^(a |an |the )/, "").trim();
  const BACKDROPS = [
    "sandy beach", "beach", "sand", "grass", "grassy field", "dirt",
    "dirt ground", "ground", "floor", "ocean", "sea", "ocean waves",
    "water", "river", "lake", "pond surface", "sky", "clouds",
    "fog", "mist", "creeping fog", "shadow", "sunlight", "moonlight",
    "full moon", "moon", "sun", "stars", "rain", "snowfall",
    "misty ground", "snow",
    // Water surfaces — drawn as ground tiles, not as sprite items.
    "pond", "small pond", "puddle", "puddle of water",
    "puddle of rainwater", "rain puddle", "stream", "creek",
    "brook", "waterfall", "fountain water", "well water",
    // Ground / surface phrases dressed up as items. The "raked gravel"
    // family came up in a zen-garden scene where the LLM tried to make
    // the iconic floor texture an item. These are tiles, not sprites.
    "gravel", "raked gravel", "gravel area", "raked gravel area",
    "raked sand", "raked sand area", "pebbles", "cobblestones",
    "moss patch", "grass patch", "leaf litter",
    // Architectural surfaces (room walls / floors / ceilings). When the
    // scene IS a room/tunnel/alley, its walls/floors are the container,
    // not items. Caught by 3 fires across the cron history (cracked
    // concrete wall, brick wall, crumbling brick wall). Bare "wall" is
    // intentionally NOT here — "a stone wall" can be a freestanding
    // garden barrier prop. Only multi-word architectural phrases.
    "brick wall", "concrete wall", "cracked concrete wall",
    "crumbling brick wall", "crumbling wall", "cracked wall",
    "tiled wall", "tiled bathroom wall",
    "wood floor", "wooden floor", "concrete floor", "tiled floor",
    "ceiling tile",
  ];
  if (BACKDROPS.includes(stripped)) return null;

  // Strip leading collective-noun phrases. After stripping, also try to
  // singularize the head noun — "a pair of snowshoes" → "snowshoes" →
  // "snowshoe" — because in practice gpt-image-1 still tends to draw a
  // pair when the plural is fed in, even with a "single" prefix. Use a
  // small irregular-plural map first; fall back to a conservative "drop
  // trailing s" rule.
  // "bunch" is intentionally NOT in the strip list. "A bunch of carrots" or
  // "a bunch of keys" reads as ONE asset (a tied bundle / a keyring) and the
  // image-gen prompt's "single " prefix yields a clean "single bunch of
  // carrots" — which renders as one cluster, not as separate carrots.
  const COLLECTIVE_RE = /^(a |an )?(set|pair|group|school|flock|herd|cluster) of (.+)$/i;
  const m = s.match(COLLECTIVE_RE);
  if (m) {
    s = singularize(m[3]);
  }
  s = s.replace(/^scattered\s+/i, "single ");
  return s;
}

/** Best-effort plural→singular for the head noun of a stripped collective.
 *  Handles common irregulars; otherwise drops a trailing "s" only when
 *  doing so leaves a plausible word (skips "grass", "glass", "moss", etc.). */
function singularize(s: string): string {
  const trimmed = s.trim();
  // Operate on the LAST whitespace-separated word, since the head is usually
  // last ("leather boots" → singularize "boots" only).
  const parts = trimmed.split(/\s+/);
  const head = parts[parts.length - 1];
  const lower = head.toLowerCase();

  const IRREGULAR: Record<string, string> = {
    knives: "knife",
    leaves: "leaf",
    wolves: "wolf",
    elves: "elf",
    loaves: "loaf",
    mice: "mouse",
    men: "man",
    women: "woman",
    children: "child",
    feet: "foot",
    teeth: "tooth",
    geese: "goose",
    oxen: "ox",
    cacti: "cactus",
    fungi: "fungus",
    fish: "fish",
    sheep: "sheep",
    deer: "deer",
    // Plurale tantum: grammatically plural but semantically ONE item. The
    // tool/garment IS the pair; "a tong" / "a scissor" / "a pant" are wrong.
    // Map them to themselves so "a set of tongs" → strip → "tongs" → "tongs".
    tongs: "tongs",
    scissors: "scissors",
    pliers: "pliers",
    tweezers: "tweezers",
    shears: "shears",
    pincers: "pincers",
    glasses: "glasses",
    sunglasses: "sunglasses",
    goggles: "goggles",
    binoculars: "binoculars",
    pants: "pants",
    jeans: "jeans",
    shorts: "shorts",
    trousers: "trousers",
    pajamas: "pajamas",
    headphones: "headphones",
  };
  if (IRREGULAR[lower]) {
    parts[parts.length - 1] = matchCase(head, IRREGULAR[lower]);
    return parts.join(" ");
  }
  // Words ending in -ss/-us/-is don't get pluralized by trimming s.
  if (/(ss|us|is)$/i.test(head)) return trimmed;
  // "berries" → "berry"
  if (/[^aeiou]ies$/i.test(head)) {
    parts[parts.length - 1] = matchCase(head, head.slice(0, -3) + "y");
    return parts.join(" ");
  }
  // "boxes" / "bushes" / "watches" → drop "es"
  if (/(xes|shes|ches|sses|zzes)$/i.test(head)) {
    parts[parts.length - 1] = matchCase(head, head.slice(0, -2));
    return parts.join(" ");
  }
  // Generic: ends in 's' and isn't already in our skip list. Drop the s.
  if (/s$/i.test(head) && head.length > 2) {
    parts[parts.length - 1] = matchCase(head, head.slice(0, -1));
    return parts.join(" ");
  }
  return trimmed;
}

function matchCase(original: string, replacement: string): string {
  if (/^[A-Z]/.test(original)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// ------------------------------------------------------------- OpenAI

type OpenAIInput = {
  prompt: string;
  size: Size;
  opaqueBg: boolean;
  quality: Quality;
  variants: number;
  referenceUrls: string[];
  maskUrl?: string;
};

async function generateOpenAI(key: string, input: OpenAIInput): Promise<string[]> {
  const model = process.env.OPENAI_MODEL || "gpt-image-1";
  const hasRefs = input.referenceUrls.length > 0;

  // With references, we use the edits endpoint (multipart). Without refs,
  // we use the simpler generations endpoint (JSON).
  return hasRefs
    ? await callOpenAIEdits(key, model, input)
    : await callOpenAIGenerations(key, model, input);
}

async function callOpenAIGenerations(key: string, model: string, input: OpenAIInput) {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: input.prompt,
      n: input.variants,
      size: input.size,
      quality: input.quality,
      output_format: "png",
      background: input.opaqueBg ? "opaque" : "transparent",
      moderation: "low",
    }),
  });
  return await parseImageResponse(res);
}

async function callOpenAIEdits(key: string, model: string, input: OpenAIInput) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", input.prompt);
  form.append("n", String(input.variants));
  form.append("size", input.size);
  form.append("quality", input.quality);
  form.append("output_format", "png");
  form.append("background", input.opaqueBg ? "opaque" : "transparent");
  // Note: edits endpoint also accepts `moderation` per docs.
  form.append("moderation", "low");

  for (let i = 0; i < input.referenceUrls.length; i++) {
    const blob = await fetchAsBlob(input.referenceUrls[i]);
    form.append("image[]", blob, `ref-${i}.png`);
  }
  if (input.maskUrl) {
    const maskBlob = await fetchAsBlob(input.maskUrl);
    form.append("mask", maskBlob, "mask.png");
  }

  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  return await parseImageResponse(res);
}

async function parseImageResponse(res: Response): Promise<string[]> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const items = json.data || [];
  if (items.length === 0) throw new Error("OpenAI returned no image data");

  const out: string[] = [];
  for (const item of items) {
    if (item.b64_json) {
      out.push(`data:image/png;base64,${item.b64_json}`);
    } else if (item.url) {
      out.push(await urlToDataUrl(item.url));
    }
  }
  if (out.length === 0) throw new Error("OpenAI items had neither b64_json nor url");
  return out;
}

async function fetchAsBlob(url: string): Promise<Blob> {
  if (url.startsWith("data:")) {
    const [meta, b64] = url.split(",");
    const mime = /data:([^;]+)/.exec(meta)?.[1] || "image/png";
    const bin = Buffer.from(b64, "base64");
    return new Blob([bin], { type: mime });
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch reference: HTTP ${res.status}`);
  return await res.blob();
}

// ------------------------------------------------------------- Replicate

async function generateReplicate(prompt: string): Promise<string> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error("REPLICATE_API_TOKEN not set. See README.");

  const { default: Replicate } = await import("replicate");
  const replicate = new Replicate({ auth: token });
  const model = (process.env.REPLICATE_MODEL ||
    "bytedance/sdxl-lightning-4step") as `${string}/${string}`;

  const output = await replicate.run(model, {
    input: {
      prompt,
      width: 1024,
      height: 1024,
      num_inference_steps: 4,
      guidance_scale: 0,
      scheduler: "K_EULER",
      num_outputs: 1,
    },
  });

  const url = await normalizeReplicateOutput(output);
  if (!url) throw new Error("Replicate returned no image");
  return await urlToDataUrl(url);
}

async function normalizeReplicateOutput(output: unknown): Promise<string | null> {
  if (!output) return null;
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") return first;
    if (first && typeof (first as { url?: () => URL }).url === "function") {
      return (first as { url: () => URL }).url().toString();
    }
  }
  if (typeof (output as { url?: () => URL }).url === "function") {
    return (output as { url: () => URL }).url().toString();
  }
  return null;
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
