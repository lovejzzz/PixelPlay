/**
 * Asset category classifier — labels 2D game-asset descriptors into a
 * fixed enum used by Phase 14 (room-type whitelist, surface-aware
 * placement). Pure ESM so both the /api/classify route handler and a
 * standalone Node test can import the same function.
 *
 * One batched gpt-4o-mini chat call per call site (~$0.0003 for 5
 * items). Falls back to a keyword heuristic when no API key is supplied
 * so the feature degrades gracefully.
 */

/** Frozen enum of category labels. ANY value returned by the LLM that
 *  isn't in this set is remapped to "other" before being surfaced. */
export const CATEGORIES = [
  "bedding",
  "seating",
  "table",
  "storage",
  "kitchen",
  "electronics",
  "decor",
  "clothing",
  "tool",
  "book",
  "food",
  "plant",
  "container",
  "lighting",
  "art",
  "toy",
  "weapon",
  "vehicle",
  "other",
];

const CATEGORY_SET = new Set(CATEGORIES);

/** Classify an array of texts in one batched call. Returns an array of
 *  category strings aligned by index. Always returns the same length as
 *  `texts`. Falls back to the heuristic when `apiKey` is empty or the
 *  upstream call fails.
 *
 *  @param {string} apiKey — OpenAI API key (empty string allowed).
 *  @param {string[]} texts — descriptors to classify.
 *  @param {{ model?: string }} [opts]
 *  @returns {Promise<string[]>}
 */
export async function classifyTexts(apiKey, texts, opts = {}) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const trimmed = texts.map((t) => (typeof t === "string" ? t.slice(0, 200) : ""));
  if (!apiKey) return trimmed.map(heuristicCategory);

  const model = opts.model || "gpt-4o-mini";
  const sys =
    "You classify short 2D game-asset descriptors into ONE category each. " +
    "Return STRICT JSON: {\"categories\": string[]}. The categories array " +
    "must have the EXACT same length and order as the input. Each entry " +
    "must be one lowercase word from this fixed list:\n" +
    CATEGORIES.join(", ") +
    "\nPick the MOST fitting category. Use \"other\" only when nothing " +
    "else applies.\n\nGuidance:\n" +
    "- bed / pillow / blanket / mattress → bedding\n" +
    "- chair / sofa / couch / throne / bench / stool → seating\n" +
    "- table / desk / counter / workbench → table\n" +
    "- dresser / wardrobe / chest / cabinet / bookshelf → storage\n" +
    "- fork / knife / pot / pan / cauldron / plate / cup → kitchen\n" +
    "- tv / radio / computer / phone / lantern (electric) → electronics\n" +
    "- rug / curtain / vase / candle (decor) / poster → decor\n" +
    "- shirt / pants / hat / boots / cloak → clothing\n" +
    "- hammer / saw / wrench / shovel / pickaxe → tool\n" +
    "- book / scroll / map / parchment → book\n" +
    "- apple / bread / cheese / cake / mushroom (edible) → food\n" +
    "- tree / flower / bush / fern / cactus → plant\n" +
    "- barrel / crate / bottle / jar / pot (not for cooking) → container\n" +
    "- lamp / candle (light source) / torch / lantern / chandelier → lighting\n" +
    "- painting / statue / sculpture / mural → art\n" +
    "- doll / ball / kite / spinning-top → toy\n" +
    "- sword / axe / bow / shield / staff → weapon\n" +
    "- cart / wagon / car / boat / horse-saddle → vehicle";

  const user = JSON.stringify({ items: trimmed });
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return trimmed.map(heuristicCategory);
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return trimmed.map(heuristicCategory);
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.categories)) return trimmed.map(heuristicCategory);
    // Align length defensively + sanitize each entry into the enum.
    return trimmed.map((t, i) => {
      const raw = parsed.categories[i];
      if (typeof raw === "string") {
        const c = raw.trim().toLowerCase();
        if (CATEGORY_SET.has(c)) return c;
      }
      return heuristicCategory(t);
    });
  } catch {
    return trimmed.map(heuristicCategory);
  }
}

/** Keyword-based fallback. Used when no API key is present or the
 *  upstream call fails. Conservative — defaults to "other" rather than
 *  guessing on weak signals. */
export function heuristicCategory(text) {
  const s = (text || "").toLowerCase();
  if (!s) return "other";
  // Order matters — check more-specific keywords before generic ones.
  const RULES = [
    [/\b(bed|pillow|blanket|mattress|cot|cradle)\b/, "bedding"],
    [/\b(sofa|couch|chair|stool|bench|throne|seat|armchair)\b/, "seating"],
    [/\b(table|desk|counter|workbench|nightstand)\b/, "table"],
    [/\b(dresser|wardrobe|cabinet|bookshelf|chest|shelf|locker|armoire)\b/, "storage"],
    [/\b(fork|knife|pot|pan|cauldron|plate|cup|mug|kettle|teapot|skillet)\b/, "kitchen"],
    [/\b(tv|television|radio|computer|phone|monitor|console)\b/, "electronics"],
    [/\b(rug|carpet|curtain|drape|vase|tapestry|wreath)\b/, "decor"],
    [/\b(shirt|pants|hat|boots?|cloak|robe|gloves?|scarf|cape|tunic)\b/, "clothing"],
    [/\b(hammer|saw|wrench|shovel|pickaxe|axe(?! wielder)|tongs|pliers)\b/, "tool"],
    [/\b(book|scroll|map|parchment|tome|spellbook|journal|grimoire)\b/, "book"],
    [/\b(apple|bread|cheese|cake|pie|fruit|loaf|sandwich|carrot|berry)\b/, "food"],
    [/\b(tree|flower|bush|fern|cactus|mushroom|plant|shrub|sapling|sapling)\b/, "plant"],
    [/\b(barrel|crate|bottle|jar|sack|basket|chest)\b/, "container"],
    [/\b(lamp|candle|torch|lantern|chandelier|brazier|sconce)\b/, "lighting"],
    [/\b(painting|statue|sculpture|mural|portrait|fresco|easel)\b/, "art"],
    [/\b(doll|ball|kite|toy|figurine|teddy)\b/, "toy"],
    [/\b(sword|bow|shield|staff|spear|dagger|crossbow|mace|wand)\b/, "weapon"],
    [/\b(cart|wagon|car|boat|ship|saddle|carriage|sled|raft)\b/, "vehicle"],
  ];
  for (const [re, cat] of RULES) {
    if (re.test(s)) return cat;
  }
  return "other";
}
