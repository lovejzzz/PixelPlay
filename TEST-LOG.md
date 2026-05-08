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
