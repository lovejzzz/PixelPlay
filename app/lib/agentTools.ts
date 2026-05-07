/**
 * Tool schema for the Concierge agent (Phase 10).
 *
 * The agent runs as a multi-turn `gpt-4o` chat that drives the FORGE form
 * via OpenAI function-calling. Each tool here mirrors a mutator the user
 * could invoke from the UI: forging an asset, listing what's already on
 * the project, writing project memory, or applying a saved recipe.
 *
 * Schema follows the OpenAI Chat Completions function-calling format
 * (`{type: "function", function: {name, description, parameters}}`). Pure
 * data — no React or network coupling. Both `/api/agent/route.ts` and the
 * client consume this constant so the wire format stays in sync.
 */
export type AgentToolName =
  | "forge_asset"
  | "list_assets"
  | "set_project_memory"
  | "apply_recipe";

export type ForgeAssetArgs = {
  prompt: string;
  mode: "character" | "item" | "scene";
  quality?: "low" | "medium" | "high";
};

export type ListAssetsArgs = Record<string, never>;

export type SetProjectMemoryArgs = {
  memory: string;
};

export type ApplyRecipeArgs = {
  /** Either a recipe id (preferred) or a recipe name. */
  recipe: string;
};

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "forge_asset",
      description:
        "Generate a new pixel-art asset by submitting the FORGE form. Use this when the user asks for a new sprite, character, item, tile, or full scene. The mode determines how the prompt is parsed: 'item' for a single non-character sprite, 'character' for a single character (pose/walk-cycle controls apply), 'scene' for a multi-asset composition that gets split into 3-8 items and arranged on a canvas.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "Short natural-language description of what to forge, e.g. 'cozy forest cabin with smoke from chimney'. Same text the user would type in the FORGE textarea.",
          },
          mode: {
            type: "string",
            enum: ["character", "item", "scene"],
            description:
              "Which generation mode to fire: character / item / scene.",
          },
          quality: {
            type: "string",
            enum: ["low", "medium", "high"],
            description:
              "Image quality (cost trade-off). Default to 'medium' if unsure.",
          },
        },
        required: ["prompt", "mode"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_assets",
      description:
        "Return the project's current assets as a JSON array of {id, name, assetType, prompt} entries. Use this to see what's already been generated before deciding what to forge next.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_project_memory",
      description:
        "Overwrite the project's MEMORY blob with the given markdown text. Use sparingly — this is the persistent note the project carries into every future generation prompt. Soft-capped around 2200 chars.",
      parameters: {
        type: "object",
        properties: {
          memory: {
            type: "string",
            description:
              "The full new MEMORY text. Markdown-formatted bullet list works well.",
          },
        },
        required: ["memory"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_recipe",
      description:
        "Apply a saved Recipe by id or name — re-fills the FORGE form with the recipe's stored prompt/mode/quality/etc. and bumps its usage counter. Does NOT auto-fire FORGE; the user (or the agent, on a follow-up turn) still calls forge_asset to actually generate.",
      parameters: {
        type: "object",
        properties: {
          recipe: {
            type: "string",
            description:
              "Recipe id (preferred) or recipe name. Names are matched case-insensitively.",
          },
        },
        required: ["recipe"],
        additionalProperties: false,
      },
    },
  },
] as const;

export type AgentToolCall =
  | { name: "forge_asset"; args: ForgeAssetArgs }
  | { name: "list_assets"; args: ListAssetsArgs }
  | { name: "set_project_memory"; args: SetProjectMemoryArgs }
  | { name: "apply_recipe"; args: ApplyRecipeArgs };
