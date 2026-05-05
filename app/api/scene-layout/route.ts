import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type LayoutItem = { name: string; x: number; y: number; scale: number; z: number };
type Body = {
  sceneDescription: string;
  items: string[];
  width: number;
  height: number;
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

  try {
    const layout = await gptLayout(key, description, items, W, H);
    if (!layout || layout.length === 0) {
      return NextResponse.json({ items: heuristicLayout(items, W, H), fallback: true });
    }
    return NextResponse.json({ items: layout });
  } catch {
    return NextResponse.json({ items: heuristicLayout(items, W, H), fallback: true });
  }
}

async function gptLayout(
  key: string,
  description: string,
  items: string[],
  W: number,
  H: number
): Promise<LayoutItem[]> {
  const sys =
    `You are a top-down pixel-art scene layout assistant. ` +
    `Place each item in a ${W}×${H} canvas (origin top-left, +x right, +y down) for a scene described as: "${description}". ` +
    `Each placement specifies the item's center point (x, y), a scale 0.05–0.5 (fraction of the canvas), and z-order (higher = drawn on top). ` +
    `Background-y items (rugs, floors) get small z; foreground items (lamps on top of furniture) get larger z. ` +
    `Place larger furniture against walls, leave open floor in the middle. Avoid overlaps unless logical (e.g. lamp on top of a nightstand should overlap and have higher z). ` +
    `Return JSON: { "items": [{"name": "...", "x": int, "y": int, "scale": float, "z": int}, ...] } using the EXACT item names provided.`;

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
