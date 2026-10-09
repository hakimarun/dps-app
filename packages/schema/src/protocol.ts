// Nachrichten zwischen App und Server (WebSocket, JSON).
import { z } from "zod";
import { Sk, type Findings } from "./index.ts";

export const Intent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().trim().min(1).max(40), unit: z.string() }),
  z.object({ type: z.literal("scan"), patient: z.string() }),
  z.object({ type: z.literal("start"), patient: z.string(), action: z.string() }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("triage"), patient: z.string(), sk: Sk }),
]);

// Alles vom Client wird hier geprüft, bevor der Server es anfasst.
export const ClientMsg = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), exercise: z.string().max(20), participant: z.string().max(64).nullable() }),
  // at: Zeitpunkt der Aktion in Serverzeit (ms); bei gepufferten Aktionen liegt er in der Vergangenheit.
  z.object({ type: z.literal("intent"), id: z.string().min(8).max(64), at: z.number(), intent: Intent }),
]);

export type Intent = z.infer<typeof Intent>;
export type ClientMsg = z.infer<typeof ClientMsg>;

export type View = {
  me: { id: string; name: string; unit: string; busy: { action: string; until: number | null } | null } | null;
  patient: { id: string; picture: string; findings: Partial<Findings>; triage: Sk | null; done: string[] } | null;
  inventory: Record<string, number>;
  unitArrived: boolean;
};

export type ActionInfo = { id: string; title: string; minutes: number | null; material: Record<string, number> };

export type ServerMsg =
  | {
      type: "welcome";
      serverNow: number;
      startedAt: number;
      title: string;
      units: { id: string; title: string }[];
      actions: ActionInfo[];
      participant: string | null;
    }
  | { type: "ack"; id: string; error: string | null; participant?: string }
  | { type: "view"; view: View }
  | { type: "error"; error: string };
