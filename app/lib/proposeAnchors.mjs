/**
 * Multi-anchor surface proposal — for assets in categories that
 * naturally have multiple usable surfaces (storage, seating, table,
 * counter-style kitchen items, large workbench-style tools), call
 * gpt-4o-mini once to enumerate named placement zones as bbox
 * fractions of the image. The relation resolver later uses these
 * anchors to pick the right surface for an "on" placement based on
 * the child's category.
 *
 * Example output for "a wooden nightstand":
 *   [{ name: "top", x: 0.05, y: 0.1, w: 0.9, h: 0.06 }]
 *
 * Example for "a tall bookshelf":
 *   [
 *     { name: "shelf-top",    x: 0.1, y: 0.08, w: 0.8, h: 0.04 },
 *     { name: "shelf-middle", x: 0.1, y: 0.42, w: 0.8, h: 0.04 },
 *     { name: "shelf-bottom", x: 0.1, y: 0.76, w: 0.8, h: 0.04 },
 *   ]
 *
 * Categories without surfaces (lighting, book, clothing, food, weapon,
 * vehicle, plant — small or self-contained items) get an EMPTY anchor
 * list so the resolver falls through to the bounds-derived single-top.
 *
 * Cheap: one batched-of-one chat call per call (~$0.0002). Heuristic
 * fallback (no key OR API error) returns a single "top" anchor for
 * the relevant categories.
 */

/** Categories that need anchor proposals. Other categories return []
 *  immediately so we don't waste tokens. */
const ANCHOR_WORTHY = new Set([
  "table",
  "storage",
  "seating",
  "kitchen",
  "container",
]);

const ANCHOR_NAMES = [
  "top",
  "top-left", "top-right",
  "shelf-top", "shelf-middle", "shelf-bottom",
  "left-side", "right-side",
  "front",
];
const ANCHOR_NAME_SET = new Set(ANCHOR_NAMES);

/** Heuristic fallback — one "top" anchor at 80% width, 5% height,
 *  centered horizontally near the visual top of the image. */
function defaultTopAnchor() {
  return [{ name: "top", x: 0.1, y: 0.08, w: 0.8, h: 0.05 }];
}

/**
 * @param {string} apiKey
 * @param {string} descriptor — asset prompt or name
 * @param {string} category — asset's classify.mjs category
 * @param {{ model?: string }} [opts]
 * @returns {Promise<Array<{name:string, x:number, y:number, w:number, h:number}>>}
 */
export async function proposeAnchors(apiKey, descriptor, category, opts = {}) {
  if (!ANCHOR_WORTHY.has(category)) return [];
  if (!apiKey) return defaultTopAnchor();
  const model = opts.model || "gpt-4o-mini";

  const sys =
    "You're labeling placement zones on a 2D pixel-art game asset. Given the asset's descriptor and category, list 1-3 NAMED zones a player could put small props on (top surface, shelf levels, etc.), as bbox fractions [0,1] of the image (origin top-left, +x right, +y down).\n\n" +
    "Use ONLY these names: top, top-left, top-right, shelf-top, shelf-middle, shelf-bottom, left-side, right-side, front.\n" +
    "Pick names that fit the asset:\n" +
    "- Single flat-top items (nightstand, workbench, table, counter): one zone named 'top', width 0.7-0.9, height 0.04-0.08, y around 0.05-0.15.\n" +
    "- Multi-shelf items (bookshelf, hutch, display case): 2-3 zones named shelf-top / shelf-middle / shelf-bottom, evenly spaced top-to-bottom.\n" +
    "- Long counters with distinct sides (kitchen island): 'top-left' + 'top-right'.\n" +
    "- Chairs / stools: 'top' only (the seat).\n" +
    "- Barrels / round containers: 'top' only.\n\n" +
    "Return STRICT JSON: { \"anchors\": [{\"name\":\"...\", \"x\":..., \"y\":..., \"w\":..., \"h\":...}] }. ALL numeric values must be in [0,1]. If no surface naturally takes items, return { \"anchors\": [] }.";

  const user = `Descriptor: "${descriptor}"\nCategory: ${category}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
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
    if (!res.ok) return defaultTopAnchor();
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return defaultTopAnchor();
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.anchors)) return defaultTopAnchor();
    const out = [];
    for (const raw of parsed.anchors) {
      if (!raw || typeof raw !== "object") continue;
      const name = typeof raw.name === "string" ? raw.name.trim().toLowerCase() : "";
      if (!ANCHOR_NAME_SET.has(name)) continue;
      const x = clamp01(Number(raw.x));
      const y = clamp01(Number(raw.y));
      const w = clamp01(Number(raw.w));
      const h = clamp01(Number(raw.h));
      if (w <= 0 || h <= 0) continue;
      // Defensive: keep zone within the image.
      if (x + w > 1.001 || y + h > 1.001) continue;
      out.push({ name, x, y, w, h });
      if (out.length >= 5) break; // hard cap defensive
    }
    return out.length > 0 ? out : defaultTopAnchor();
  } catch {
    return defaultTopAnchor();
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Pick the best anchor for a given child category. Falls back to the
 *  first anchor, or null when the list is empty. */
export function pickAnchorFor(anchors, childCategory) {
  if (!Array.isArray(anchors) || anchors.length === 0) return null;
  if (anchors.length === 1) return anchors[0];

  // Preferences by child category. Top surfaces are the default for
  // most things you'd put on a piece of furniture.
  const TOP_FIRST = ["top", "top-left", "top-right", "shelf-top", "shelf-middle", "shelf-bottom", "front", "left-side", "right-side"];
  const order = TOP_FIRST;

  // Special-case decor/art lean towards back shelves first, books to
  // middle/bottom shelves so they don't sit above eye level by default.
  if (childCategory === "art" || childCategory === "decor") {
    return findFirstByNames(anchors, ["top", "shelf-top", "shelf-middle", "front", ...order]);
  }
  if (childCategory === "book") {
    return findFirstByNames(anchors, ["shelf-middle", "shelf-bottom", "shelf-top", "top", ...order]);
  }
  if (childCategory === "lighting") {
    return findFirstByNames(anchors, ["top", "top-left", "top-right", "shelf-top", ...order]);
  }
  return findFirstByNames(anchors, order);
}

function findFirstByNames(anchors, names) {
  for (const n of names) {
    const found = anchors.find((a) => a.name === n);
    if (found) return found;
  }
  return anchors[0];
}
