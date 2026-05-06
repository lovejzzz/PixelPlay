import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type LayoutItem = { name: string; x: number; y: number; scale: number; z: number };
type SceneContext = "interior" | "exterior" | "aerial";
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
): Promise<LayoutItem[]> {
  const memorySuffix =
    projectMemory && projectMemory.trim()
      ? `\n\nPROJECT MEMORY (the user's notes about this project — recurring characters, palette, layout preferences. Treat as soft constraints):\n${projectMemory.trim().slice(0, 1500)}`
      : "";
  const sys =
    `You are a 2D pixel-art scene layout assistant.\n\n` +
    `Place each item in a ${W}×${H} canvas (origin top-left, +x right, +y down) for a scene described as: "${description}".\n\n` +
    `IMPORTANT: items are rendered with BOTTOM-CENTER anchoring. The (x, y) you return is the GROUND POINT — where the item touches the floor — not its centre. So a tall tree at y=600 means the tree's BASE is at y=600 (and its leaves are above). Items "on the same ground line" share the same y. Items that visually sit ON another item (a lamp on a nightstand) should have y close to the host's TOP edge (host_y - host_height + small_overlap), not the host's center.\n\n` +
    `Each placement: { "name": "...", "x": int, "y": int, "scale": float (0.05–0.5 of the longest canvas edge), "z": int (higher = drawn on top) }.\n\n` +
    `COMPOSITION RULES:\n` +
    `- Pick ONE focal item (the largest, most-evocative item — usually a building, central character, or main prop) and place it in the upper-third center area, scaled 0.30–0.45.\n` +
    `- All other items are supporting: scale 0.10–0.22, scattered around the focal item with natural irregular spacing. Avoid grid-aligning supporting items.\n` +
    `- Z-order: items further back (smaller y) get LOWER z; items in front (larger y) get HIGHER z. Items resting ON another item get z = parent.z + 1.\n` +
    `- Don't cram every part of the canvas — leave ~30% breathing room. Avoid items inside the bottom 8% of the canvas (looks awkward against the frame).\n` +
    `- Don't overlap two items unless one logically sits on / against / behind the other.\n\n` +
    CONTEXT_RULES[context] +
    `\n\nReturn JSON: { "items": [{"name": "...", "x": int, "y": int, "scale": float, "z": int}, ...] } using the EXACT item names provided.` +
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

  const sanitized: LayoutItem[] = [];
  for (let i = 0; i < parsed.items.length && i < MAX_ITEMS; i++) {
    const raw = parsed.items[i] as Partial<LayoutItem> | undefined;
    if (!raw) continue;
    const name = typeof raw.name === "string" ? raw.name : items[i];
    const x = clamp(Number(raw.x) || 0, 0, W);
    const y = clamp(Number(raw.y) || 0, 0, H);
    const scale = clamp(Number(raw.scale) || 0.2, 0.05, 0.6);
    const z = Number.isFinite(Number(raw.z)) ? Number(raw.z) : i;
    sanitized.push({ name, x, y, scale, z });
  }

  // Painters-algorithm post-process: re-sort z by ground y so items further
  // back (smaller y) draw under items in front (larger y). gpt-4o-mini gets
  // local attachment z right (lamp on table) but not the global ordering;
  // doing it server-side guarantees correct depth without a second LLM
  // round-trip. Preserves the model's ATTACHMENT bumps by adding a tiny
  // perturbation per attachment level (rare, since most items are unstacked).
  const sortedByY = [...sanitized]
    .map((it, idx) => ({ it, idx, attachBump: it.z }))
    .sort((a, b) => a.it.y - b.it.y || a.it.z - b.it.z);
  for (let i = 0; i < sortedByY.length; i++) {
    sortedByY[i].it.z = i * 10 + (sortedByY[i].attachBump > 0 ? 1 : 0);
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
