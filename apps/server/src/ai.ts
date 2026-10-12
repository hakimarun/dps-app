// KI-Anbindung (G12): Claude über die Anthropic API oder ein lokales Modell über eine OpenAI-kompatible
// Schnittstelle (z. B. Ollama, llama.cpp, vLLM). Eine schmale Schnittstelle, je Aufgabe wählbar:
//   AI_DIALOG / AI_GENERATOR = claude | local | off
//   ANTHROPIC_API_KEY (Claude), LOCAL_AI_URL + LOCAL_AI_MODEL (lokal)
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export type Task = "dialog" | "generator";
export type Ai = { name: string; json<T>(task: Task, system: string, user: string, schema: z.ZodType<T>, maxTokens: number): Promise<T> };

const MODEL = { dialog: "claude-haiku-5-5", generator: "claude-opus-5-5" } as const; // Dialog schnell und günstig, Generator gründlich
const EFFORT = { dialog: "low", generator: "high" } as const;
const TIMEOUT = { dialog: 15_000, generator: 300_000 } as const;

export function claude(): Ai {
  const clients = { dialog: new Anthropic({ timeout: TIMEOUT.dialog }), generator: new Anthropic({ timeout: TIMEOUT.generator }) };
  return {
    name: "claude",
    async json(task, system, user, schema, maxTokens) {
      const res = await clients[task].messages.parse({
        model: MODEL[task],
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: EFFORT[task], format: zodOutputFormat(schema) },
      });
      if (res.stop_reason === "refusal") throw new Error("Die KI hat die Anfrage abgelehnt");
      if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new Error("Die KI-Antwort war unvollständig");
      return res.parsed_output;
    },
  };
}

export function local(url: string, model: string): Ai {
  return {
    name: "local",
    async json(task, system, user, schema, maxTokens) {
      // Kleine Modelle liefern gelegentlich kaputtes JSON, Ollama bricht selten mit HTTP 500 ab; ein zweiter Versuch reicht meist.
      for (let attempt = 1; ; attempt++) {
        try {
          return await once(task, system, user, schema, maxTokens);
        } catch (e) {
          if (attempt === 2 || !(e instanceof SyntaxError || e instanceof z.ZodError || /HTTP 5/.test(String(e)))) throw e;
        }
      }
    },
  };
  async function once<T>(task: Task, system: string, user: string, schema: z.ZodType<T>, maxTokens: number): Promise<T> {
    const res = await fetch(`${url.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT[task] * 2), // lokal: Modell muss evtl. erst geladen werden
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "antwort", schema: z.toJSONSchema(schema) } },
      }),
    });
    if (!res.ok) throw new Error(`Lokales Modell antwortet mit HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    // Kleine Modelle umrahmen JSON manchmal mit Text; das äußerste Objekt herausschneiden und streng prüfen.
    return schema.parse(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
  }
}

export function fromEnv(task: Task, env: NodeJS.ProcessEnv = process.env): Ai | null {
  const choice = env[task === "dialog" ? "AI_DIALOG" : "AI_GENERATOR"] ?? (env.ANTHROPIC_API_KEY ? "claude" : env.LOCAL_AI_URL ? "local" : "off");
  if (choice === "claude") return claude();
  if (choice === "local" && env.LOCAL_AI_URL) return local(env.LOCAL_AI_URL, env.LOCAL_AI_MODEL ?? "gemma3:4b");
  return null;
}
