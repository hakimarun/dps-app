// Nachrichten zwischen App und Server (WebSocket, JSON) und REST-Eingaben der Praxisanleiter.
import { z } from "zod";
import { Algorithm, Sk, type Findings } from "./index.ts";

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
  // Praxisanleiter beobachtet eine eigene Übung.
  z.object({ type: z.literal("watch"), exercise: z.string().max(20), token: z.string().max(200) }),
]);

export const Level = z.enum(["einsteiger", "fortgeschritten", "experte"]);
export const LoginReq = z.object({ email: z.email().max(200) });
export const VerifyReq = z.object({ email: z.email().max(200), code: z.string().regex(/^\d{6}$/) });
export const ApproveReq = z.object({ item: z.string().max(64), approved: z.boolean() });
export const CreateExerciseReq = z.object({
  scenario: z.string().max(64),
  patients: z.array(z.string().max(64)).min(1).max(100),
  algorithm: Algorithm,
  level: Level,
});
export const ControlReq = z.object({ type: z.enum(["start", "pause", "resume", "end", "release"]) }); // release: Berichte für Helfer freigeben

export type Intent = z.infer<typeof Intent>;
export type ClientMsg = z.infer<typeof ClientMsg>;
export type Level = z.infer<typeof Level>;
export type Status = "ready" | "running" | "paused" | "ended";

export type HelperReport = {
  id: string;
  name: string;
  unit: string;
  points: number;
  badges: string[];
  patients: number; // betreute Patienten
  actions: number;
  triages: number;
  busyShare: number; // Anteil der Zeit in Maßnahmen, 0..1
  good: string[]; // höchstens 3
  improve: string[]; // höchstens 3, wichtigste zuerst
};

export type Team = { stars: 0 | 1 | 2 | 3; survived: number; eligible: number };

export type Evaluation = {
  released: boolean;
  t: number;
  team: Team;
  critical: { timely: number; late: number; missed: number };
  triage: { correct: number; over: number; under: number }; // erste Sichtung je Patient
  patients: {
    id: string;
    title: string;
    firstContact: number | null;
    firstTriage: number | null;
    triage: "korrekt" | "übertriage" | "untertriage" | null;
    outcome: "verstorben" | "abtransportiert" | "vor Ort" | "tot aufgefunden";
    missed: string[];
  }[];
  helpers: HelperReport[];
};

export type View = {
  result?: { team: Team; me: HelperReport } | null; // erst nach Freigabe durch die Leitung
  me: { id: string; name: string; unit: string; busy: { action: string; until: number | null } | null } | null;
  patient: { id: string; picture: string; findings: Partial<Findings>; triage: Sk | null; done: string[] } | null;
  inventory: Record<string, number>;
  unitArrived: boolean;
};

export type LeitungView = {
  code: string;
  title: string;
  status: Status;
  t: number; // Übungsminuten
  counts: Record<Sk | "offen", number>; // Ist-Sichtung
  patients: {
    id: string;
    title: string;
    phase: string;
    target: Sk; // Soll-SK
    triage: Sk | null; // Ist-SK
    helpers: string[];
    lastContact: number | null;
    alert: string | null;
  }[];
  helpers: { id: string; name: string; unit: string; patient: string | null; busy: string | null }[];
  events: { t: number; text: string }[]; // neueste zuerst
};

export type ActionInfo = { id: string; title: string; minutes: number | null; material: Record<string, number> };

export type ServerMsg =
  | {
      type: "welcome";
      title: string;
      units: { id: string; title: string }[];
      actions: ActionInfo[];
      participant: string | null;
    }
  // Übungsuhr: t Minuten zum Zeitpunkt serverNow; läuft nur bei status "running" weiter.
  | { type: "clock"; status: Status; t: number; serverNow: number }
  | { type: "ack"; id: string; error: string | null; participant?: string }
  | { type: "view"; view: View }
  | { type: "leitung"; view: LeitungView }
  | { type: "error"; error: string };
