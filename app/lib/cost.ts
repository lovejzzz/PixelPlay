/**
 * Tiny cost tracker — wraps every generation call with a price estimate
 * and persists per-project lifetime totals plus the current session.
 *
 * Estimates are based on OpenAI's gpt-image-1 + gpt-4o-mini pricing as of
 * 2026-Q1 (see https://platform.openai.com/docs/pricing). Numbers are
 * approximate — actual billing may differ slightly. Goal here is "give the
 * user a real-time sense of spend" not invoice-grade accounting.
 */

export type Quality = "low" | "medium" | "high" | "auto";
export type Size = "1024x1024" | "1024x1536" | "1536x1024";

const SESSION_KEY = "pwf:cost-session:v1";
const PROJECT_KEY = "pwf:cost-project:v1";

export type SessionState = {
  startedAt: number;
  cost: number;
  calls: number;
  byTier?: { low: number; medium: number; high: number; chat: number };
};

export type ProjectCosts = Record<
  string,
  { cost: number; calls: number; byTier?: { low: number; medium: number; high: number; chat: number } }
>;

// gpt-image-1 prices per image, by quality and aspect ratio.
const IMAGE_PRICE: Record<Exclude<Quality, "auto">, Record<Size, number>> = {
  low:    { "1024x1024": 0.011, "1024x1536": 0.016, "1536x1024": 0.016 },
  medium: { "1024x1024": 0.042, "1024x1536": 0.063, "1536x1024": 0.063 },
  high:   { "1024x1024": 0.167, "1024x1536": 0.25,  "1536x1024": 0.25  },
};

const CHAT_FLAT = 0.0002; // gpt-4o-mini call (scene parse or layout)

export function estimateImageCost(
  quality: Quality | undefined,
  size: Size,
  variants: number = 1
): number {
  const q = (quality && quality !== "auto" ? quality : "medium") as Exclude<Quality, "auto">;
  return IMAGE_PRICE[q][size] * Math.max(1, variants);
}

export function estimateChatCost(): number {
  return CHAT_FLAT;
}

// ---- session storage ----

export function getSession(): SessionState {
  if (typeof window === "undefined") return { startedAt: Date.now(), cost: 0, calls: 0 };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SessionState;
      if (parsed && typeof parsed.cost === "number") return parsed;
    }
  } catch {}
  const fresh = { startedAt: Date.now(), cost: 0, calls: 0 };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(fresh)); } catch {}
  return fresh;
}

export function recordSpend(
  projectId: string,
  dollars: number,
  calls: number = 1,
  tier: "low" | "medium" | "high" | "chat" = "medium"
): {
  session: SessionState;
  project: ProjectCosts[string];
} {
  if (typeof window === "undefined") {
    return {
      session: { startedAt: Date.now(), cost: 0, calls: 0, byTier: emptyTier() },
      project: { cost: 0, calls: 0, byTier: emptyTier() },
    };
  }
  // Session.
  const session = getSession();
  if (!session.byTier) session.byTier = emptyTier();
  session.cost += dollars;
  session.calls += calls;
  session.byTier[tier] += dollars;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}

  // Project lifetime.
  let projects: ProjectCosts = {};
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (raw) projects = JSON.parse(raw) as ProjectCosts;
  } catch {}
  const cur = projects[projectId] || { cost: 0, calls: 0, byTier: emptyTier() };
  if (!cur.byTier) cur.byTier = emptyTier();
  cur.cost += dollars;
  cur.calls += calls;
  cur.byTier[tier] += dollars;
  projects[projectId] = cur;
  try { localStorage.setItem(PROJECT_KEY, JSON.stringify(projects)); } catch {}
  return { session, project: cur };
}

function emptyTier() {
  return { low: 0, medium: 0, high: 0, chat: 0 };
}

export function getProjectCost(projectId: string): ProjectCosts[string] {
  const empty = { cost: 0, calls: 0, byTier: emptyTier() };
  if (typeof window === "undefined") return empty;
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return empty;
    const projects = JSON.parse(raw) as ProjectCosts;
    const cur = projects[projectId];
    if (!cur) return empty;
    return { ...cur, byTier: cur.byTier || emptyTier() };
  } catch {
    return empty;
  }
}

export function formatDollars(d: number): string {
  if (d < 0.01) return "<$0.01";
  if (d < 1) return `$${d.toFixed(2)}`;
  return `$${d.toFixed(2)}`;
}
