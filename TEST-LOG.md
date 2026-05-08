# Test & Refine log

Each fire of the test-and-refine cron picks a fresh scenario, runs the
`extractScene` flow against the live OpenAI API, and surfaces one
issue worth fixing in the prompt-engineering or sanitizer layer.

The harness is `scripts/test-refine.mjs` — cheap (~$0.001 per run,
gpt-4o-mini text-only), no image generation. Output is a JSON report
the agent reads to evaluate quality and pick a fix.

Newest at the bottom.

---

## 2026-05-08 fire #1

Scenario: a snowy mountain peak

LLM output (gpt-4o-mini, 2.2 s):
- context: exterior
- items: a rocky boulder, a pine tree, a single snowflake, a wooden signpost, a pair of snowshoes

Issues caught by the harness:
- Collective noun: "a pair of snowshoes" — sanitizer DOES strip "a pair of" but leaves the plural "snowshoes". gpt-image-1 then receives "single snowshoes" which it tends to render as a pair anyway.

Fix (this fire):
- Extended `sanitizeItemDescriptor` in `app/api/generate/route.ts` to also singularize the head noun after stripping a collective phrase. New `singularize()` helper handles common irregular plurals (knives, leaves, wolves, mice, men, women, children, feet, teeth, geese, oxen, cacti, fungi, fish, sheep, deer) and falls back to a conservative "drop trailing s" rule with skip-list for ss/us/is endings, plus dedicated paths for -ies → -y and -xes/-shes/-ches/-sses → drop -es. Preserves leading-letter case via `matchCase()`. So "a pair of snowshoes" now becomes "snowshoe", and the image prompt becomes "single snowshoe" instead of "single snowshoes".

Build: clean.

## 2026-05-08 fire #2

Scenario: a busy farmer's market square

LLM output (gpt-4o-mini, 4.1 s):
- context: exterior
- items: a wooden stall, a basket of apples, a bunch of carrots, a colorful umbrella, a metal scale, a single pumpkin, a crate of tomatoes

Issues caught: collective noun "a bunch of carrots".

But on closer inspection, "a bunch of carrots" is a legitimate single-asset framing — one tied bundle that reads as one game prop. Same for "a basket of apples" and "a crate of tomatoes" (containers with contents drawn together as one item). The sanitizer was being TOO aggressive — stripping "bunch of" turned "carrots" → "carrot" and lost the tied-bundle framing the LLM intended.

Fix (this fire):
- Removed `bunch` from the COLLECTIVE_RE strip list in `sanitizeItemDescriptor`. Strict collectives (set, pair, group, school, flock, herd, cluster) still get stripped because they imply distinct objects, but bundle-style phrases ("bunch of carrots", "bunch of keys") now pass through unchanged so the image prompt becomes "single bunch of carrots" — which renders as one cluster.
- Tightened the `extractScene` system prompt: replaced the confusing "borderline" wording for "bunch of" with explicit "tied-bundle phrases that read as ONE physical asset are fine — 'a bunch of carrots' (one bundle), 'a bunch of keys' (one keyring), 'a basket of apples' (one basket), 'a crate of bottles' (one crate)". Cleaner signal to the model.
- Updated `scripts/test-refine.mjs` so the harness no longer flags "bunch of" as a collective-noun issue (matches the new policy).

Build: clean.

2026-05-08 fire #3 — PASS — Scenario: an abandoned subway tunnel — a rusty train car, a broken light fixture, a cracked concrete wall, a discarded backpack, a single rat, a metal pipe

## 2026-05-08 fire #4

Scenario: a medieval blacksmith's forge

LLM output (gpt-4o-mini, 2.8 s):
- context: interior
- items: a wooden workbench, an anvil, a hammer, a set of tongs, a forge bellows, a metal bucket

Issue: "a set of tongs". Sanitizer would strip "set of" → "tongs" → singularize → "tong" — but "tong" is not a real noun. Tongs are a *plurale tantum*: grammatically plural but semantically one tool (you cannot have one tong, a tong is half a tongs).

Fix (this fire):
- Extended the IRREGULAR map in `singularize()` (app/api/generate/route.ts) with 16 plurale-tantum nouns common in game props: tongs, scissors, pliers, tweezers, shears, pincers, glasses, sunglasses, goggles, binoculars, pants, jeans, shorts, trousers, pajamas, headphones. Each maps to itself, so the singularizer leaves them unchanged. End result: "a set of tongs" → strip "set of" → "tongs" → IRREGULAR lookup → "tongs" → image prompt "single tongs" → renders as one pair.

Build: clean.

2026-05-08 fire #5 — PASS — Scenario: a top-down view of a small town — a wooden house, a brick shop, a small park bench, a street lamp, a single tree, a fountain

2026-05-08 fire #6 — PASS — Scenario: a cyberpunk alley with neon signs — a glowing neon sign, a metal dumpster, a brick wall, a flickering streetlight, a puddle of rainwater, a graffiti-covered panel

## 2026-05-08 fire #7

Scenario: a desert oasis with palm trees

LLM output (gpt-4o-mini, 2.6 s):
- context: exterior
- items: a palm tree, a small pond, a sandy rock, a single cactus, a wooden bench

Heuristic flagged nothing — but "a small pond" is a water-surface backdrop (the pond IS the oasis water, drawn as a ground tile, not a sprite). Fire #6 had the same class of slip-through with "a puddle of rainwater". Two water-surface escapes in two consecutive runs is a clear pattern, not a one-off.

Fix (this fire):
- Extended BACKDROPS in BOTH `app/api/generate/route.ts` (`sanitizeItemDescriptor`) AND `scripts/test-refine.mjs` (kept in sync) with 12 water-surface phrases: pond, small pond, puddle, puddle of water, puddle of rainwater, rain puddle, stream, creek, brook, waterfall, fountain water, well water. Plain "river" / "lake" / "pond surface" were already covered. Future runs that surface "a small pond" will both (a) get sanitized to null at the route, and (b) get flagged by the harness so the issue is visible. The whole BACKDROPS set is duplicated across the two files because the harness runs as a standalone Node script — keeping them aligned by hand is the simplest path until the test layer needs more shared logic.

Build: clean.
