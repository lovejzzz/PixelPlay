import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type LayoutItem = { name: string; x: number; y: number; scale: number; z: number };
type SceneContext = "interior" | "exterior" | "aerial";

/** Relationship between two items in a scene. The model populates this
 *  whenever items naturally rest on, hang above, sit beside, or stand in
 *  front of each other; the resolver below converts the relation into
 *  concrete (x, y, z) overrides so a lamp described as "on a nightstand"
 *  actually lands on top of the nightstand instead of next to it. */
type LayoutRelation = {
  /** Name of the host item (must match another entry in the items list). */
  to: string;
  where: "on" | "above" | "beside" | "in-front";
};
type Body = {
  sceneDescription: string;
  items: string[];
  width: number;
  height: number;
  /** Optional context hint from the scene parser. Drives spatial rules. */
  context?: SceneContext;
  /** Project MEMORY blob — appended to the layout system prompt. */
  projectMemory?: string;
};

const MAX_ITEMS = 16;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "items[] is required" }, { status: 400 });
  }

  const items = body.items.slice(0, MAX_ITEMS);
  const W = body.width || 1024;
  const H = body.height || 1024;
  const description = body.sceneDescription || "scene";

  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const key = userKey || process.env.OPENAI_API_KEY || "";
  if (!key) {
    return NextResponse.json({ items: heuristicLayout(items, W, H) });
  }

  const context: SceneContext =
    body.context === "interior" || body.context === "aerial" || body.context === "exterior"
      ? body.context
      : "exterior";

  try {
    const layout = await gptLayout(key, description, items, W, H, context, body.projectMemory);
    if (!layout || layout.length === 0) {
      return NextResponse.json({ items: heuristicLayout(items, W, H), fallback: true });
    }
    return NextResponse.json({ items: layout });
  } catch {
    return NextResponse.json({ items: heuristicLayout(items, W, H), fallback: true });
  }
}

const CONTEXT_RULES: Record<SceneContext, string> = {
  interior:
    `CONTEXT: interior room. Push large furniture (bed, sofa, table, dresser, wardrobe, bookshelf, fireplace) against the canvas edges as if hugging walls. Leave the middle 40% of the canvas open as walkable floor. Rugs go in the middle floor area at low z. Small props (lamps, books, mugs) sit ON TOP of furniture at slightly higher z and overlap their host's bounding box on purpose. Buildings, exterior doors, roofs would be wrong here — every item is room-scale.`,
  exterior:
    `CONTEXT: exterior landscape. Place ONE central focal item (the largest building if any) near the canvas center or upper third. Scatter smaller items (trees, rocks, signs, barrels, crates) around it with natural irregular spacing — DON'T grid-align them. Leave foreground (bottom 25%) lighter so the scene reads in depth. Trees and tall items can be larger (scale 0.25–0.4) than ground props (0.1–0.2). Avoid pushing items to the canvas edges as if they were furniture against walls — they're outside.`,
  aerial:
    `CONTEXT: aerial top-down map. Items are small and read as pieces on a board. Use a more spread, even distribution across the canvas. Paths and ponds may stretch (use moderate scales 0.15–0.3). Roof-top buildings cluster but don't overlap. No item should fill more than ~30% of the canvas.`,
};

async function gptLayout(
  key: string,
  description: string,
  items: string[],
  W: number,
  H: number,
  context: SceneContext,
  projectMemory?: string
): Promise<Array<LayoutItem & { relation?: LayoutRelation }>> {
  const memorySuffix =
    projectMemory && projectMemory.trim()
      ? `\n\nPROJECT MEMORY (the user's notes about this project — recurring characters, palette, layout preferences. Treat as soft constraints):\n${projectMemory.trim().slice(0, 1500)}`
      : "";
  const sys =
    `You are a 2D pixel-art scene layout assistant.\n\n` +
    `Place each item in a ${W}×${H} canvas (origin top-left, +x right, +y down) for a scene described as: "${description}".\n\n` +
    `IMPORTANT: items are rendered with BOTTOM-CENTER anchoring. The (x, y) you return is the GROUND POINT — where the item touches the floor — not its centre. So a tall tree at y=600 means the tree's BASE is at y=600 (and its leaves are above). Items "on the same ground line" share the same y. Items that visually sit ON another item (a lamp on a nightstand) should have y close to the host's TOP edge (host_y - host_height + small_overlap), not the host's center.\n\n` +
    `Each placement: { "name": "...", "x": int, "y": int, "scale": float (0.05–0.5 of the longest canvas edge), "z": int (higher = drawn on top), "relation"?: { "to": "<other-item-name>", "where": "on" | "above" | "beside" | "in-front" } }.\n\n` +
    `RELATIONSHIPS (USE THESE — they're the difference between a lamp on the floor next to a nightstand vs a lamp on top of the nightstand):\n` +
    `Items that NATURALLY rest on / hang above / touch the side of / stand in front of another item must declare it via the optional "relation" field. The "to" must EXACTLY match the name of another item in this layout (case sensitive).\n` +
    `- "on" — the item rests on top of the host's surface (lamp on nightstand, candle on table, vase on dresser, mug on workbench, book on shelf, plate on stove, jar on countertop). Resolver places it at the host's top edge with proper z-stacking.\n` +
    `- "above" — the item hangs / floats higher than the host but is contextually associated with it (painting above bed, banner above throne, lantern above table, sign above shop door).\n` +
    `- "beside" — the item touches one side of the host along the same ground line (chair beside table, barrel beside crate, NPC beside cauldron). The resolver picks an open side automatically.\n` +
    `- "in-front" — the item stands a small step closer to the camera than the host (rug in front of bed, footstool in front of armchair, market stall in front of shop building).\n` +
    `Items that genuinely belong "next to" but not against another item — like a tree near a cabin, or a barrel a few paces from a stall — should NOT use a relation; just place them with x/y. The relation field is for tight contact, not loose proximity.\n` +
    `One worked example for "a cozy bedroom": bed (focal, no relation, scale 0.30), nightstand {relation: {to: "bed", where: "beside"}, scale 0.13}, lamp {relation: {to: "nightstand", where: "on"}, scale 0.06}, painting {relation: {to: "bed", where: "above"}, scale 0.10}, rug {relation: {to: "bed", where: "in-front"}, scale 0.18}.\n` +
    `One worked example for "a wizard's potion shop": cauldron (focal, no relation, scale 0.28), shelf {relation: {to: "cauldron", where: "beside"}, scale 0.22}, potion bottle {relation: {to: "shelf", where: "on"}, scale 0.08}, spell book {relation: {to: "cauldron", where: "beside"}, scale 0.10}.\n` +
    `IMPORTANT: even when you set a relation, ALSO provide reasonable x/y/z fallback values — the resolver only overrides when the host is found, otherwise your fallback is used.\n\n` +
    `SCALE RUBRIC (strict — these ranges enforce relative sizes so a tree never ends up smaller than a barrel):\n` +
    `- Trees, large buildings, towers, statues, ships: 0.25–0.40\n` +
    `- Characters (the player, NPCs, creatures): 0.15–0.20\n` +
    `- Mid-size props (furniture, vehicles, signs, fountains, anvils, large plants): 0.10–0.18\n` +
    `- Small ground props (rocks, mushrooms, flowers, coins, food, bones, seashells): 0.06–0.10\n` +
    `Worked example for "a forest with a cabin": cabin 0.35, pine tree 0.30, oak tree 0.28, mossy rock 0.10, mushroom 0.07. Note the cabin and trees are clearly larger than the ground props.\n\n` +
    `COMPOSITION RULES:\n` +
    `- Pick ONE focal item (the largest, most-evocative item — usually a building, central character, or main prop) and place it in the upper-third center area at the TOP of its scale range.\n` +
    `- Supporting items use the bottom-to-middle of their respective range — scattered around the focal item with natural irregular spacing. Avoid grid-aligning supporting items.\n` +
    `- Z-order: items further back (smaller y) get LOWER z; items in front (larger y) get HIGHER z. Items resting ON another item get z = parent.z + 1.\n` +
    `- Don't cram every part of the canvas — leave ~30% breathing room. Avoid items inside the bottom 8% of the canvas (looks awkward against the frame).\n` +
    `- Don't overlap two items unless one logically sits on / against / behind the other.\n\n` +
    CONTEXT_RULES[context] +
    `\n\nReturn JSON: { "items": [{"name": "...", "x": int, "y": int, "scale": float, "z": int, "relation"?: { "to": "<host-name>", "where": "on" | "above" | "beside" | "in-front" }}, ...] } using the EXACT item names provided.` +
    memorySuffix;

  const userMsg = `Items: ${JSON.stringify(items)}`;

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
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
    }),
  });
  if (!res.ok) throw new Error(`Chat ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return [];
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.items)) return [];

  // First pass — sanitize each entry, including the optional relation.
  // Items with a valid relation get resolved AFTER this loop so we have
  // the full lookup table by name available.
  type SanitizedItem = LayoutItem & { relation?: LayoutRelation };
  const sanitized: SanitizedItem[] = [];
  for (let i = 0; i < parsed.items.length && i < MAX_ITEMS; i++) {
    const raw = parsed.items[i] as
      | (Partial<LayoutItem> & { relation?: Partial<LayoutRelation> })
      | undefined;
    if (!raw) continue;
    const name = typeof raw.name === "string" ? raw.name : items[i];
    const x = clamp(Number(raw.x) || 0, 0, W);
    const y = clamp(Number(raw.y) || 0, 0, H);
    // Defensive clamp into [0.04, 0.5] — even if the LLM ignores the
    // SCALE RUBRIC, no single item can dominate or vanish off-screen.
    const scale = clamp(Number(raw.scale) || 0.2, 0.04, 0.5);
    const z = Number.isFinite(Number(raw.z)) ? Number(raw.z) : i;
    const relation = parseRelation(raw.relation);
    sanitized.push({ name, x, y, scale, z, ...(relation ? { relation } : {}) });
  }

  // Second pass — resolve relations into concrete (x, y, z) overrides.
  // Single-pass only: if a host itself has a relation, we still anchor to
  // the host's RAW (LLM-supplied) position to avoid two-step chain drift.
  const byName = new Map<string, SanitizedItem>();
  for (const it of sanitized) byName.set(it.name, it);
  const longest = Math.max(W, H);
  for (const it of sanitized) {
    if (!it.relation) continue;
    const host = byName.get(it.relation.to);
    // Bail out if host is missing or self-reference; fall back to LLM xy.
    if (!host || host.name === it.name) {
      delete it.relation;
      continue;
    }
    const hostHeight = host.scale * longest;
    const hostHalfW = (host.scale * longest) / 2;
    const itemHalfW = (it.scale * longest) / 2;
    switch (it.relation.where) {
      case "on": {
        // Sit on the host's TOP edge. y is the foot in our anchor model;
        // overlap by ~10% of host height so the item visually rests rather
        // than floats. Same x as host. z = host.z + 1 so the item draws
        // over the host even when y-sort would tie them.
        it.x = clamp(host.x, 0, W);
        it.y = clamp(host.y - hostHeight * 0.9, 0, H);
        it.z = host.z + 1;
        break;
      }
      case "above": {
        // Float clearly above the host with a small gap. Same x.
        it.x = clamp(host.x, 0, W);
        it.y = clamp(host.y - hostHeight - hostHeight * 0.25, 0, H);
        it.z = host.z + 1;
        break;
      }
      case "beside": {
        // Touch the host along the same ground line. Pick the side with
        // more room — if host is past canvas centre, place LEFT; else RIGHT.
        const placeRight = host.x < W / 2;
        const sideX = placeRight ? host.x + hostHalfW + itemHalfW : host.x - hostHalfW - itemHalfW;
        it.x = clamp(sideX, 0, W);
        it.y = host.y;
        it.z = host.z; // same depth, beside does not stack
        break;
      }
      case "in-front": {
        // One small step closer to the camera. Same x. z = host.z + 1
        // (always in front in stacking order).
        it.x = clamp(host.x, 0, W);
        it.y = clamp(host.y + hostHeight * 0.15, 0, H);
        it.z = host.z + 1;
        break;
      }
    }
  }

  // Painters-algorithm post-process: re-sort z by ground y so items further
  // back (smaller y) draw under items in front (larger y). gpt-4o-mini gets
  // local attachment z right (lamp on table) but not the global ordering;
  // doing it server-side guarantees correct depth without a second LLM
  // round-trip. Items with a relation are SKIPPED — their z is dictated
  // by the host's z + 1 and their on-screen depth is overridden in the
  // Player's y-sort, which walks the relation to inherit host depth.
  const standalone = sanitized.filter((it) => !it.relation);
  const sortedByY = [...standalone]
    .map((it, idx) => ({ it, idx, attachBump: it.z }))
    .sort((a, b) => a.it.y - b.it.y || a.it.z - b.it.z);
  for (let i = 0; i < sortedByY.length; i++) {
    sortedByY[i].it.z = i * 10 + (sortedByY[i].attachBump > 0 ? 1 : 0);
  }
  // Relation-bearing items: bump z to host.z + 1 (after host gets its
  // y-rank z above). Loop a second time in case a relation references
  // another relation-bearing item.
  for (let pass = 0; pass < 2; pass++) {
    for (const it of sanitized) {
      if (!it.relation) continue;
      const host = sanitized.find((x) => x.name === it.relation!.to);
      if (!host) continue;
      it.z = host.z + 1;
    }
  }
  return sanitized;
}

/** Falls back to a simple grid layout if GPT fails. */
function heuristicLayout(items: string[], W: number, H: number): LayoutItem[] {
  const cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);
  const cellW = W / cols;
  const cellH = H / rows;
  return items.map((name, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      name,
      x: Math.round(c * cellW + cellW / 2),
      y: Math.round(r * cellH + cellH / 2),
      scale: 0.2,
      z: i,
    };
  });
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Validate the LLM's relation field; return null if missing or malformed. */
function parseRelation(
  raw: Partial<LayoutRelation> | undefined
): LayoutRelation | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.to !== "string" || raw.to.length === 0) return null;
  if (
    raw.where !== "on" &&
    raw.where !== "above" &&
    raw.where !== "beside" &&
    raw.where !== "in-front"
  ) {
    return null;
  }
  return { to: raw.to, where: raw.where };
}
