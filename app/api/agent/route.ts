import { NextRequest } from "next/server";
import { AGENT_TOOLS } from "../../lib/agentTools";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Body: { messages: ChatMessage[], projectContext?: string }
 *  Returns: text/event-stream of `data: <json>\n\n` events:
 *    - {type: "delta", text}     — assistant text fragment
 *    - {type: "tool_call", id, name, args}
 *    - {type: "done", finishReason}
 *    - {type: "error", message}
 *
 *  Single turn per request: the client POSTs with the full conversation
 *  so far (including any prior tool_results), and the route streams the
 *  next assistant message. Tool calls are surfaced as discrete SSE
 *  events for the client to execute against the FORGE form; the client
 *  then re-POSTs with the appended `tool_result` message. Capped at 8
 *  assistant turns to prevent runaway loops.
 *
 *  Uses `x-openai-key` header (or env `OPENAI_API_KEY`).
 */

type ChatRole = "system" | "user" | "assistant" | "tool";

type ToolCallShape = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatMessage = {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCallShape[];
  name?: string;
};

type Body = {
  messages?: ChatMessage[];
  projectContext?: string;
};

const MAX_TURNS = 8;
const PROJECT_CONTEXT_CAP = 2000;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid JSON", 400);
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return jsonError("messages[] is required", 400);
  }
  const assistantTurns = messages.filter((m) => m.role === "assistant").length;
  if (assistantTurns >= MAX_TURNS) {
    return jsonError(
      `Conversation cap reached (${MAX_TURNS} assistant turns)`,
      400
    );
  }

  const userKey = req.headers.get("x-openai-key")?.trim() || "";
  const apiKey = userKey || process.env.OPENAI_API_KEY || "";
  if (!apiKey) {
    return jsonError(
      "No OpenAI API key. Open ⚙ Settings and paste your key.",
      401
    );
  }

  const fullMessages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(body.projectContext || "") },
    ...messages,
  ];

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-4o",
        messages: fullMessages,
        tools: AGENT_TOOLS,
        stream: true,
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`Upstream fetch failed: ${msg}`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return jsonError(`Upstream ${upstream.status}: ${text.slice(0, 300)}`, 502);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buf = "";
      // Tool calls stream as deltas keyed by `index`. Each delta may
      // contribute partial id/name/arguments — accumulate until done.
      const pending = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let finishReason: string | null = null;

      const send = (event: object) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            for (const line of chunk.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") {
                finishReason = finishReason || "stop";
                continue;
              }
              let json: {
                choices?: Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index: number;
                      id?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>;
              };
              try {
                json = JSON.parse(data);
              } catch {
                continue;
              }
              const choice = json.choices?.[0];
              if (!choice) continue;
              const delta = choice.delta;
              if (delta?.content) {
                send({ type: "delta", text: delta.content });
              }
              if (Array.isArray(delta?.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const existing =
                    pending.get(tc.index) || { id: "", name: "", arguments: "" };
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                  pending.set(tc.index, existing);
                }
              }
              if (choice.finish_reason) finishReason = choice.finish_reason;
            }
          }
        }
        if (pending.size > 0) {
          const indexes = [...pending.keys()].sort((a, b) => a - b);
          for (const i of indexes) {
            const tc = pending.get(i)!;
            let args: unknown;
            try {
              args = JSON.parse(tc.arguments || "{}");
            } catch {
              args = { _raw: tc.arguments };
            }
            send({ type: "tool_call", id: tc.id, name: tc.name, args });
          }
        }
        send({ type: "done", finishReason: finishReason || "stop" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildSystemPrompt(projectContext: string): string {
  const base =
    "You are Pixel Play's Concierge — a creative assistant that helps the " +
    "user build pixel-art game projects. You drive the FORGE form via " +
    "function-calls. When the user asks for a batch of assets (e.g. " +
    "'make me a cozy forest tileset'), briefly state your plan, then call " +
    "forge_asset once per asset. Use list_assets first if you need to know " +
    "what's already on the project. Use set_project_memory when you discover " +
    "a recurring style preference worth remembering across generations. Use " +
    "apply_recipe when the user references a saved pattern by name. Keep " +
    "natural-language replies short — your real output is the tool calls.";
  const ctx = projectContext.trim();
  if (!ctx) return base;
  return `${base}\n\nPROJECT CONTEXT:\n${ctx.slice(0, PROJECT_CONTEXT_CAP)}`;
}
