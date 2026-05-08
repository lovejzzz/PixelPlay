#!/usr/bin/env node
/**
 * Test-and-refine harness for Pixel Play.
 *
 * Picks a fresh scenario from a rotating list, runs the same extractScene +
 * scene-layout flow that /api/generate uses, and prints a JSON report
 * Claude can read to evaluate quality and pick one issue to fix.
 *
 * Cheap (~$0.001 per run, gpt-4o-mini text-only). No image generation —
 * the goal is to stress-test the prompt-engineering layer where most
 * scene-quality issues live.
 *
 * Usage: node scripts/test-refine.mjs > /tmp/test-refine-result.json
 */
import fs from "node:fs";
import path from "node:path";

// --- Read the API key from .env.local (don't depend on shell env). ---------
const envPath = path.join(process.cwd(), ".env.local");
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
}
const API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
if (!API_KEY) {
  console.error("FAIL: no OPENAI_API_KEY in .env.local or env");
  process.exit(2);
}

// --- Pick a scenario, avoiding any used in the last 8 entries of TEST-LOG. -
const SCENARIOS = [
  "a haunted graveyard at night",
  "a wizard's potion shop",
  "a cozy bedroom",
  "a cabin in the forest",
  "a pirate ship at sea",
  "an underwater coral reef",
  "a snowy mountain peak",
  "a desert oasis with palm trees",
  "a busy farmer's market square",
  "a medieval blacksmith's forge",
  "a futuristic spaceship cockpit",
  "a treehouse hideout",
  "a Japanese zen garden",
  "an abandoned subway tunnel",
  "a children's playroom with toys",
  "a tropical beach at sunset",
  "an alchemist's laboratory",
  "a viking longhouse interior",
  "a fairy mushroom village",
  "a top-down view of a small town",
  "a dragon's treasure cave",
  "a cyberpunk alley with neon signs",
  "a grandma's kitchen",
  "a haunted attic with old furniture",
  "a steampunk airship deck",
];

const logPath = path.join(process.cwd(), "TEST-LOG.md");
const recent = new Set();
if (fs.existsSync(logPath)) {
  const log = fs.readFileSync(logPath, "utf8");
  const matches = log.match(/^Scenario:\s+(.+)$/gm) || [];
  for (const line of matches.slice(-8)) {
    const m = line.match(/^Scenario:\s+(.+)$/);
    if (m) recent.add(m[1].trim());
  }
}
const fresh = SCENARIOS.filter((s) => !recent.has(s));
const pool = fresh.length > 0 ? fresh : SCENARIOS;
const scenePrompt = pool[Math.floor(Math.random() * pool.length)];

// --- Mirror the extractScene system prompt from app/api/generate/route.ts. -
const MAX_SPLIT_ITEMS = 8;
const sys =
  "You parse a short scene description into a list of distinct, individually-renderable 2D game-asset items.\n\n" +
  "RULE: every item must pass the COLLECTIBLE TEST — could a video-game character pick this up, walk around it, or place it in an inventory? A bed YES, a tombstone YES, a single skull YES, a treasure chest YES. The MOON no, FOG no, OCEAN WAVES no, SCATTERED BONES no (use 'a skull' instead), GROUND no (it IS the ground), SHADOW no, A SCHOOL OF FISH no (use 'one fish'), DIRT no, GRASS no (that's the background tile, not an item), SAND / SANDY BEACH no (the sand is the ground, like grass), WATER / RIVER / LAKE SURFACE no (the water is the ground/backdrop). Use 'a single seashell', 'one cactus', 'a wooden boat' instead.\n\n" +
  "RULE: NO COLLECTIVE NOUNS. 'A set of chairs' NO → 'a wooden chair'. 'A pair of boots' NO → 'one leather boot'. 'A bunch of carrots' borderline — only OK if drawn as one tied bunch. 'A pile of X' only OK if it visually reads as one mound (a pile of hay = ok, a pile of snowballs = no, just say 'a snowball').\n\n" +
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
  `Return JSON: { "context": "interior" | "exterior" | "aerial", "items": ["a short descriptor", ...] }.`;

// --- Call OpenAI Chat. -----------------------------------------------------
const t0 = Date.now();
const res = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: env.OPENAI_CHAT_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: scenePrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
  }),
});
const elapsedMs = Date.now() - t0;
if (!res.ok) {
  const txt = await res.text();
  console.log(JSON.stringify({ ok: false, error: `${res.status}: ${txt.slice(0, 300)}`, scenario: scenePrompt }));
  process.exit(1);
}
const data = await res.json();
const content = data?.choices?.[0]?.message?.content || "";
let parsed;
try {
  parsed = JSON.parse(content);
} catch {
  console.log(JSON.stringify({ ok: false, error: "non-JSON response", scenario: scenePrompt, raw: content.slice(0, 300) }));
  process.exit(1);
}

// --- Local sanitizer (mirror of the route's sanitizeItemDescriptor). ------
const BACKDROPS = new Set([
  "sandy beach", "beach", "sand", "grass", "grassy field", "dirt",
  "dirt ground", "ground", "floor", "ocean", "sea", "ocean waves",
  "water", "river", "lake", "pond surface", "sky", "clouds",
  "fog", "mist", "creeping fog", "shadow", "sunlight", "moonlight",
  "full moon", "moon", "sun", "stars", "rain", "snowfall",
  // Water surfaces — drawn as ground tiles, not as sprite items.
  "pond", "small pond", "puddle", "puddle of water",
  "puddle of rainwater", "rain puddle", "stream", "creek",
  "brook", "waterfall", "fountain water", "well water",
]);
function isBackdrop(raw) {
  const stripped = raw.toLowerCase().replace(/^(a |an |the )/, "").trim();
  return BACKDROPS.has(stripped);
}
function startsWithArticleOrNumber(s) {
  return /^(a |an |\d+ |one |two |three |four |five )/i.test(s.trim());
}

// --- Heuristic evaluation. -------------------------------------------------
const items = Array.isArray(parsed.items) ? parsed.items : [];
const context = parsed.context;
const issues = [];
if (!["interior", "exterior", "aerial"].includes(context)) {
  issues.push(`bad context: ${JSON.stringify(context)}`);
}
if (items.length < 3) issues.push(`only ${items.length} items (expected 3+)`);
if (items.length > MAX_SPLIT_ITEMS) issues.push(`${items.length} items exceeds cap of ${MAX_SPLIT_ITEMS}`);
const dupes = items.filter((x, i) => items.indexOf(x) !== i);
if (dupes.length) issues.push(`duplicates: ${dupes.join(", ")}`);
const backdrops = items.filter((x) => typeof x === "string" && isBackdrop(x));
if (backdrops.length) issues.push(`backdrop slipped through: ${backdrops.join(", ")}`);
const nonArticle = items.filter((x) => typeof x === "string" && !startsWithArticleOrNumber(x));
if (nonArticle.length) issues.push(`bad article prefix: ${nonArticle.join(", ")}`);
const overlong = items.filter((x) => typeof x === "string" && x.split(/\s+/).length > 6);
if (overlong.length) issues.push(`item too long (>6 words): ${overlong.join(", ")}`);
// "bunch of X" is allowed as a single tied-bundle asset (carrots, keys,
// balloons, etc.) — only flag stricter collectives that mean "many objects".
const collectiveSuspects = items.filter((x) => /\b(set of|pair of|group of|cluster of|stack of|pile of)\b/i.test(x || ""));
if (collectiveSuspects.length) issues.push(`collective noun: ${collectiveSuspects.join(", ")}`);
// Only inspect the LAST word — the head noun. Earlier regex matched
// "brass" or "glass" mid-phrase ("a brass steering wheel") and falsely
// flagged the whole item as a plural suspect.
const plurals = items.filter((x) => {
  if (typeof x !== "string") return false;
  const s = x.trim();
  // Compound-descriptor patterns put the head BEFORE the connector and
  // a (often legitimately plural) modifier AFTER. Examples: "a bed with
  // blankets", "a chair covered in vines", "a basket of apples", "a bowl
  // full of fruit". The plural-looking last word is a modifier, not the
  // asset's head noun, so don't flag the item.
  if (/\s(with|covered in|covered with|full of|filled with|of)\s/i.test(s)) return false;
  const parts = s.split(/\s+/);
  const last = (parts[parts.length - 1] || "").toLowerCase();
  if (!/\w+s$/.test(last)) return false;
  // Words ending in -ss / -us / -is aren't plurals (matches the route's
  // singularize() skip rule): brass, grass, glass, moss, mass, class,
  // harness, virus, focus, cactus, axis, mantis, etc.
  if (/(ss|us|is)$/.test(last)) return false;
  // Plurale tantum: grammatically plural but semantically one item.
  if (/^(tongs|scissors|pliers|tweezers|shears|pincers|glasses|sunglasses|goggles|binoculars|pants|jeans|shorts|trousers|pajamas|headphones)$/.test(last)) return false;
  return true;
});

console.log(
  JSON.stringify(
    {
      ok: true,
      scenario: scenePrompt,
      elapsedMs,
      context,
      items,
      itemCount: items.length,
      issues,
      plural_suspects: plurals,
    },
    null,
    2
  )
);
