/**
 * Cross-project user profile, persisted in localStorage. Inspired by
 * Hermes Agent's USER.md — a small blob of "who is this user, how do they
 * like to work" used to seed defaults for new projects and freshly opened
 * sessions. Decay-weighted: single FORGEs don't change the profile, but
 * a 5-in-a-row streak of one value does.
 */

// Local copies of the form-state unions. Kept here (rather than imported
// from page.tsx) so this module has no React/component coupling.
type GenMode = "character" | "item" | "scene";
type Perspective = "top-down" | "side-view";
type Quality = "low" | "medium" | "high";
type StylePreset = "cozy" | "snes-jrpg" | "gameboy" | "nes" | "monochrome";

export type UserProfile = {
  preferredMode?: GenMode;
  preferredQuality?: Quality;
  preferredPreset?: StylePreset;
  preferredPerspective?: Perspective;
  verbosityHint?: "terse" | "verbose";
};

const KEY = "pixelplay:user-profile:v1";
const STREAK_THRESHOLD = 5;

export function readUserProfile(): UserProfile {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as UserProfile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeUserProfile(profile: UserProfile): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    /* quota / private mode — best effort */
  }
}

export function patchUserProfile(patch: Partial<UserProfile>): UserProfile {
  const cur = readUserProfile();
  const next = { ...cur, ...patch };
  writeUserProfile(next);
  return next;
}

/** A small sliding window of recent FORGE submissions. The page module
 *  pushes a `sample` after every successful generation; this returns the
 *  fields that should be promoted to the profile because they've appeared
 *  STREAK_THRESHOLD times in a row. */
export type ForgeSample = {
  mode: GenMode;
  quality: Quality;
  perspective: Perspective;
};

export function streakedFields(window: ForgeSample[]): Partial<UserProfile> {
  if (window.length < STREAK_THRESHOLD) return {};
  const recent = window.slice(-STREAK_THRESHOLD);
  const out: Partial<UserProfile> = {};
  if (recent.every((s) => s.mode === recent[0].mode)) out.preferredMode = recent[0].mode;
  if (recent.every((s) => s.quality === recent[0].quality)) out.preferredQuality = recent[0].quality;
  if (recent.every((s) => s.perspective === recent[0].perspective)) out.preferredPerspective = recent[0].perspective;
  return out;
}

// Re-export for legacy callers.
export type { GenMode, Perspective, Quality, StylePreset };
