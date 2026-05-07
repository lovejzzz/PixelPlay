import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
// FAL Flux Schnell finishes in ~2-5s per image; 30s leaves headroom for
// the n=4 case + post-fetch base64 conversion. (Compare /api/generate's
// 60s cap, which is needed for slow gpt-image-1 calls.)
export const maxDuration = 30;

type Size = "1024x1024" | "1024x1536" | "1536x1024";
type Quality = "low" | "medium" | "high";

type Body = {
  prompt: string;
  size?: Size;
  quality?: Quality;
  /** Number of images. Accepts both `variants` (matching /api/generate)
   *  and `n` (the roadmap's preferred name). Capped at 4. */
  variants?: number;
  n?: number;
};

// FAL's published price for fal-ai/flux/schnell at the time of writing
// (~$0.003 / megapixel-image). Hard-coded so callers can show estimated
// spend; verify against fal.ai/pricing if it drifts.
const COST_PER_IMAGE = 0.003;

function mapSize(size: Size | undefined): { width: number; height: number } {
  switch (size) {
    case "1024x1536": return { width: 1024, height: 1536 };
    case "1536x1024": return { width: 1536, height: 1024 };
    case "1024x1024":
    default:          return { width: 1024, height: 1024 };
  }
}

// Schnell is tuned for 4 steps; bumping past 8 wastes cost without quality
// gain, and dropping below 2 produces noise.
function stepsFor(quality: Quality | undefined): number {
  switch (quality) {
    case "high":  return 8;
    case "low":   return 2;
    case "medium":
    default:      return 4;
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

  const userKey = req.headers.get("x-fal-key")?.trim() || "";
  const apiKey = userKey || process.env.FAL_API_KEY || "";
  if (!apiKey) {
    return NextResponse.json(
      { error: "No FAL API key. Open ⚙ Settings and paste your fal-key, or set FAL_API_KEY on the server." },
      { status: 401 }
    );
  }

  const { width, height } = mapSize(body.size);
  const num_images = Math.min(4, Math.max(1, body.variants ?? body.n ?? 1));
  const num_inference_steps = stepsFor(body.quality);

  try {
    const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
      method: "POST",
      headers: {
        Authorization: `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: body.prompt,
        image_size: { width, height },
        num_inference_steps,
        num_images,
        enable_safety_checker: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `FAL ${res.status}: ${text.slice(0, 500)}` },
        { status: 502 }
      );
    }
    const json = (await res.json()) as {
      images?: Array<{ url?: string }>;
    };
    const images = json.images || [];
    if (images.length === 0) {
      return NextResponse.json({ error: "FAL returned no images" }, { status: 502 });
    }
    const urls: string[] = [];
    for (const img of images) {
      if (img.url) urls.push(await urlToDataUrl(img.url));
    }
    if (urls.length === 0) {
      return NextResponse.json({ error: "FAL images had no urls" }, { status: 502 });
    }
    return NextResponse.json({
      urls,
      cost: urls.length * COST_PER_IMAGE,
      size: `${width}x${height}`,
      cols: 1,
      rows: 1,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "image/png";
  return `data:${mime};base64,${buf.toString("base64")}`;
}
