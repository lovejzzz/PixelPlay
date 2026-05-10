/**
 * Pure scene-extractor used by /api/generate's split-items branch.
 * Calls gpt-4o-mini once with a focused system prompt and returns
 * { items: string[], context, roomType }. `items` are RAW (unsanitized) —
 * the route applies the existing `sanitizeItemDescriptor` after we
 * return. Lives in .mjs so a standalone Node test can import it.
 *
 * Phase 14 fire #78 added the `roomType` field — a more granular label
 * than the existing `context` enum, used by Phase 14 item-room
 * validation. Each room type has a category whitelist defined in
 * app/lib/roomCategories.ts (next fire).
 */

/** Coarse "where is this scene set" — drives layout rules + perspective. */
export const CONTEXTS = ["interior", "exterior", "aerial"];

/** Granular room/place type — drives per-room item validation. */
export const ROOM_TYPES = [
  // Interiors
  "bedroom",
  "kitchen",
  "bathroom",
  "living-room",
  "office",
  "workshop",
  "shop",
  "tavern",
  "potion-shop",
  "blacksmith-forge",
  "wizard-study",
  // Exteriors
  "forest",
  "meadow",
  "desert",
  "beach",
  "mountain",
  "graveyard",
  "village",
  "garden",
  "underwater",
  // Subterranean
  "dungeon",
  "cave",
  // Catch-all
  "other",
];

const CONTEXT_SET = new Set(CONTEXTS);
const ROOM_TYPE_SET = new Set(ROOM_TYPES);
const MAX_SPLIT_ITEMS_DEFAULT = 8;

/** Heuristic fallback when no API key is available. Picks the room
 *  type via keyword scan of the scene prompt. Conservative — defaults
 *  to "other" so downstream code doesn't make false assumptions. */
export function heuristicRoomType(scenePrompt) {
  const s = (scenePrompt || "").toLowerCase();
  if (!s) return "other";
  const RULES = [
    [/\b(bedroom|cozy bed|nursery)\b/, "bedroom"],
    [/\b(kitchen|pantry|breakfast nook)\b/, "kitchen"],
    [/\b(bathroom|washroom|powder room)\b/, "bathroom"],
    [/\b(living[- ]room|lounge|sitting room|den)\b/, "living-room"],
    [/\b(office|study|library)\b/, "office"],
    [/\b(workshop|carpenter|garage)\b/, "workshop"],
    [/\b(blacksmith|forge|anvil)\b/, "blacksmith-forge"],
    [/\b(potion|alchemist|apothecary)\b/, "potion-shop"],
    [/\b(wizard|sorcerer|mage|spell)\b/, "wizard-study"],
    [/\b(shop|store|market|stall|bazaar|boutique)\b/, "shop"],
    [/\b(tavern|inn|pub|bar)\b/, "tavern"],
    [/\b(graveyard|cemetery|tombstone)\b/, "graveyard"],
    [/\b(village|town square|hamlet)\b/, "village"],
    [/\b(garden|zen garden|courtyard)\b/, "garden"],
    [/\b(underwater|coral reef|seabed|ocean floor)\b/, "underwater"],
    [/\b(dungeon|crypt|catacomb|sewer)\b/, "dungeon"],
    [/\b(cave|cavern|grotto)\b/, "cave"],
    [/\b(forest|woodland|grove|jungle)\b/, "forest"],
    [/\b(meadow|prairie|grassland|field|pasture)\b/, "meadow"],
    [/\b(desert|dunes|oasis)\b/, "desert"],
    [/\b(beach|seashore|coast|coastline)\b/, "beach"],
    [/\b(mountain|peak|summit|cliff)\b/, "mountain"],
  ];
  for (const [re, t] of RULES) {
    if (re.test(s)) return t;
  }
  return "other";
}

/** Run the combined LLM call and return parsed result. Items are RAW
 *  (the caller is expected to apply sanitization). Returns `null` only
 *  on a true upstream failure — empty-key / parse-fail still return
 *  a structured object using the heuristic fallback. */
export async function extractSceneRaw(apiKey, scenePrompt, projectMemory = "", options = {}) {
  const maxItems = options.maxItems || MAX_SPLIT_ITEMS_DEFAULT;
  const model = options.model || "gpt-4o-mini";
  if (!apiKey) {
    return { items: [], context: "exterior", roomType: heuristicRoomType(scenePrompt) };
  }
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
    "STEP 2 — pick exactly one ROOM TYPE (more granular than context, used for item-room validation):\n" +
    " • Interior types: bedroom, kitchen, bathroom, living-room, office, workshop, shop, tavern, potion-shop, blacksmith-forge, wizard-study\n" +
    " • Exterior types: forest, meadow, desert, beach, mountain, graveyard, village, garden, underwater\n" +
    " • Subterranean: dungeon, cave\n" +
    " • Catch-all: other (use only when nothing else fits)\n" +
    "The room type must be consistent with the context — interior types only when context=interior, etc. (dungeon/cave are interior). Worked roomType examples:\n" +
    " • 'a cozy bedroom' → context: interior, roomType: bedroom\n" +
    " • 'a cabin in the forest' → context: exterior, roomType: forest\n" +
    " • 'a wizard's potion shop' → context: interior, roomType: potion-shop\n" +
    " • 'a haunted graveyard at night' → context: exterior, roomType: graveyard\n" +
    " • 'a medieval blacksmith forge' → context: interior, roomType: blacksmith-forge\n" +
    " • 'a top-down view of a small town' → context: aerial, roomType: village\n" +
    " • 'a desert oasis' → context: exterior, roomType: desert\n" +
    " • 'a snowy mountain peak' → context: exterior, roomType: mountain\n" +
    " • 'an underwater coral reef' → context: exterior, roomType: underwater\n" +
    " • 'a steampunk airship deck' → context: exterior, roomType: other (no perfect match)\n\n" +
    "STEP 3 — list 3-" + maxItems + " items, each 2-6 words, each starting with 'a' or 'an' or a number. Singular nouns only. Each must pass the collectible test. No item should overlap visually with another item in the list.\n\n" +
    `Return JSON: { "context": "interior" | "exterior" | "aerial", "roomType": "<one of the room types above>", "items": ["a short descriptor", ...] }.` +
    memorySuffix;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
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
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    return { items: [], context: "exterior", roomType: heuristicRoomType(scenePrompt) };
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { items: [], context: "exterior", roomType: heuristicRoomType(scenePrompt) };
  }
  const items = Array.isArray(parsed?.items)
    ? parsed.items.filter((x) => typeof x === "string").slice(0, maxItems)
    : [];
  const context = CONTEXT_SET.has(parsed?.context) ? parsed.context : "exterior";
  const roomType = ROOM_TYPE_SET.has(parsed?.roomType)
    ? parsed.roomType
    : heuristicRoomType(scenePrompt);
  return { items, context, roomType };
}
