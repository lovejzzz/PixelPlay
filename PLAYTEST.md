# Playtest session — 2026-05-10

## Goal

Use Pixel Play for ~20 minutes like a real user. Build a small playable
world. Find what hurts. The fixes from this session feed Phase 14.

App: <http://localhost:3000>

## Suggested 20-minute path

Ignore any step that breaks or that you don't want to do. Note the
friction in the log below as you go.

1. **Fresh start (2 min)** — open the app, see the onboarding modal,
   click through it. Did it feel useful or in the way?
2. **First asset (3 min)** — type a prompt, click FORGE, get a
   character. How long did it take? Were the form options obvious?
3. **A small scene (5 min)** — try a scene-style prompt
   ("a cabin in the forest with a fox"). Does the result feel cohesive?
   Are items placed sensibly? Do they look like they share a style?
4. **Walk it (3 min)** — drop in your character, hit Play. Walking
   feel right? Y-sort working — do you go behind trees? Shadows
   readable? Idle bobble visible?
5. **Try one AI feature (3 min)** — open the Concierge agent (🤖) OR
   try semantic search OR save a recipe and re-apply it. Does it work?
   Is it discoverable?
6. **Edit / iterate (4 min)** — try a tool you haven't used yet:
   tile painting, NPC dialogue, a portal between two scenes, light/
   particle emitters, the right-click menu, density toggle.
   Pick what's tempting.

When you're done playing, come back here and tell Claude what hurt.

## Friction log

> Capture each issue as a short bullet. Severity tags: `[BUG]` (broken),
> `[UX]` (confusing or annoying), `[POLISH]` (small visual/copy nit),
> `[FEATURE]` (missing thing). One line per issue, more if needed.

- [x] `[BUG]` `OPENAI_MODEL=gpt-image-2` in `.env.local` doesn't exist —
  every image-gen call returned 502. Fixed by changing to `gpt-image-1`.
  Lesson: route should validate the configured model OR the Settings
  Test-Connection button should also probe `/v1/models` to surface
  bad model env vars before the user clicks FORGE.
- [x] `[FEATURE]` Scene composition didn't understand item relationships
  (lamp ended up on the floor next to the nightstand, not on top).
  Implemented `relation` field in /api/scene-layout — LLM declares
  on/above/beside/in-front relations, server resolves to absolute
  positions + persists onto SceneItem so the Player's y-sort respects
  stacked items. Now lamp on nightstand, painting above bed,
  chair beside table — all positioned correctly.
- [ ]

## Things that felt good

> Worth noting too — keeps us honest about what NOT to break.

- [ ]
- [ ]
