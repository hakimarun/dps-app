// Nachrichten zwischen App und Server (WebSocket, JSON) und REST-Eingaben der Praxisanleiter.
import { z } from "zod";
import { Algorithm, Place, Sk, type Findings } from "./index.ts";

// Trupp-Funktionen: Sichtungstrupps sichten nur (plus lebensrettende Sofortmaßnahmen).
export const Role = z.enum(["sichtung", "behandlung", "transport"]);
export type Role = z.infer<typeof Role>;
export type Trupp = { code: string; name: string; role: Role; unit: string };

// Anamnese nach SAMPLER (+ Risikofaktoren): Themen für die Ersatz-Auswahlliste und die Auswertung.
export const Topic = z.enum(["symptoms", "allergies", "medication", "history", "lastMeal", "event", "risk"]);
export type Topic = z.infer<typeof Topic>;
export const TOPIC_LABEL: Record<Topic, string> = {
  symptoms: "Beschwerden", allergies: "Allergien", medication: "Medikamente", history: "Vorerkrankungen",
  lastMeal: "Letzte Mahlzeit", event: "Hergang", risk: "Risikofaktoren",
};

export const Intent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("join"), name: z.string().trim().min(1).max(40), unit: z.string().optional() }), // ohne unit: Einheit des Trupps
  z.object({ type: z.literal("scan"), patient: z.string() }),
  z.object({ type: z.literal("start"), patient: z.string(), action: z.string() }),
  z.object({ type: z.literal("end") }),
  z.object({ type: z.literal("triage"), patient: z.string(), sk: Sk }),
  z.object({ type: z.literal("admit"), patient: z.string(), place: Place }),
  // Patient befragen: freie Frage (KI) oder Thema aus der Auswahlliste (ohne KI).
  z.object({ type: z.literal("ask"), patient: z.string(), question: z.string().trim().max(300).optional(), topic: Topic.optional() }),
  z.object({
    type: z.literal("handover"), patient: z.string(), vehicle: z.string(),
    destination: z.string().trim().min(1).max(80), diagnosis: z.string().trim().max(200),
  }),
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
  trupps: z
    .object({ sichtung: z.number().int().min(0).max(10), behandlung: z.number().int().min(0).max(20), transport: z.number().int().min(0).max(10) })
    .default({ sichtung: 1, behandlung: 2, transport: 1 }),
  // H1/H2: Vorgaben der Stufe einzeln überschreiben
  phaseMinutes: z.number().int().min(5).max(30).optional(),
  random: z.boolean().optional(),
  vitals: z.enum(["numbers", "live", "text"]).default("numbers"),
});
export const GenerateReq = z.object({ brief: z.string().trim().min(10).max(2000), idea: z.string().max(10).optional() });
// Formular-Editor (A1/A4): Fall im Bibliotheksformat, geprüft wird auf dem Server.
export const CaseSaveReq = z.object({ patient: z.record(z.string(), z.unknown()) });
export const ScenarioSaveReq = z.object({
  id: z.string().max(64).optional(), // eigenes Szenario überschreiben; sonst neue Kopie
  title: z.string().trim().min(3).max(120),
  situation: z.string().trim().max(2000).default(""),
  units: z.array(z.object({ kind: z.enum(["RTW", "NEF", "KTW"]), arrivesAt: z.number().min(0).max(120) })).min(1).max(20),
  patients: z.array(z.string().max(64)).min(1).max(100),
});
export const ScenarioGenReq = z.object({ brief: z.string().trim().min(10).max(4000), patients: z.number().int().min(1).max(15) });
export const ControlReq = z.object({ type: z.enum(["start", "pause", "resume", "end", "release", "speed"]), factor: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional() }); // release: Berichte freigeben; speed: Tempo (D5)
// A6: Szenario als Datei zum Austausch zwischen Organisationen: Lage, Fahrzeuge und alle Fallverläufe, ohne Konto- oder Personendaten.
export const ScenarioBundle = z.object({
  format: z.literal("dps-szenario"),
  version: z.literal(1),
  exported: z.string().optional(),
  scenario: z.object({
    title: z.string().min(1).max(200),
    situation: z.string().max(2000).nullable().optional(),
    patients: z.array(z.string()).min(1).max(60),
    units: z.array(z.object({ id: z.string(), title: z.string(), arrivesAt: z.number().min(0), seats: z.number().int().min(0).default(0), inventory: z.record(z.string(), z.number().int().min(0)) })).min(1).max(30),
  }),
  patients: z.array(z.record(z.string(), z.unknown())).min(1).max(60), // Fallverläufe im Szenarioformat, beim Import geprüft
});
export type ScenarioBundle = z.infer<typeof ScenarioBundle>;
// G10: Feedback je Helfer: KI-Vorschlag holen, geprüften Text speichern (leer = zurücknehmen).
export const FeedbackReq = z.object({ helper: z.string().max(64), text: z.string().trim().max(1200).optional() });
// E7: Notiz eines Beobachters (Beobachter-Code der Übung, ohne Konto).
export const NoteReq = z.object({
  by: z.string().trim().min(1).max(40),
  text: z.string().trim().min(1).max(300),
  kind: z.enum(["note", "gut", "besser"]).default("note"),
  helper: z.string().max(64).nullable().default(null),
  patient: z.string().max(64).nullable().default(null),
});
export type ObserverView = {
  title: string; status: Status; t: number;
  patients: { id: string; title: string }[];
  helpers: { id: string; name: string; trupp: string | null }[];
  notes: { t: number; text: string }[]; // als Ereignistext, neueste zuerst
};
// E5: Eingriffe der Leitung während der Übung.
export const InjectReq = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), patient: z.string().max(64), to: z.string().max(64) }),
  z.object({ type: z.literal("message"), text: z.string().trim().min(1).max(300) }),
]);

export type Intent = z.infer<typeof Intent>;
export type ClientMsg = z.infer<typeof ClientMsg>;
export type Level = z.infer<typeof Level>;
export type Status = "ready" | "running" | "paused" | "ended";

// Kompetenzprofil (5 Achsen): je Achse, wie oft etwas richtig lief (ok) von allem Bewertbaren (total).
export const AXES = ["sichtung", "blutung", "atemweg", "kommunikation", "ressourcen"] as const;
export type Axis = (typeof AXES)[number];
export type Skills = Record<Axis, { ok: number; total: number }>;

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
  notes: string[]; // Beobachtungen zu dieser Person (F5)
  feedback: string | null; // Rückmeldung der Leitung (G10, ggf. aus KI-Vorschlag)
  skills: Skills;
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
    handover: { t: number; vehicle: string; destination: string; missing: string[] } | null; // missing: was in der Übergabe fehlte
  }[];
  helpers: HelperReport[];
  trupps: { code: string; name: string; role: Role; points: number; members: string[] }[];
  triageByRole: Record<Role, { correct: number; over: number; under: number }>;
};

export type View = {
  result?: { team: Team; me: HelperReport } | null; // erst nach Freigabe durch die Leitung
  me: { id: string; name: string; unit: string; role: Role; trupp: string | null; busy: { action: string; until: number | null } | null } | null;
  patient: {
    id: string; picture: string; findings: Partial<Findings>; triage: Sk | null; done: string[]; place: string; left: boolean;
    vitalsText: Record<string, string> | null; // Befundtext statt Zahlen (Vitalwerte-Modus "text"); dann fehlen die Zahlen in findings
    live?: boolean; // Vitalwerte gleiten und schwanken (Modus "live"): kein Aufblitzen bei jeder Änderung
    image?: string | null; // Patientenbild (Pfad auf dem Server), falls eines erzeugt wurde
    dialog: { q: string; a: string }[]; // eigene Fragen an diesen Patienten
  } | null;
  inventory: Record<string, number>;
  unitArrived: boolean;
  vehicles: { id: string; title: string; seats: number; arrived: boolean }[];
  messages: { t: number; text: string }[]; // Nachrichten der Leitung, neueste zuletzt
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
    place: string;
    trend: "besser" | "schlechter" | "gleich"; // Soll-SK jetzt gegenüber Übungsbeginn
    phases: string[]; // alle Phasen des Falls, zum Setzen von Hand (E5)
  }[];
  helpers: { id: string; name: string; unit: string; trupp: string | null; role: Role; patient: string | null; busy: string | null; idle: number | null }[];
  trupps: (Trupp & { members: string[] })[];
  events: { t: number; text: string }[]; // neueste zuerst
  observer: string | null; // Beobachter-Code (E7)
};

export type ActionInfo = { id: string; title: string; minutes: number | null; material: Record<string, number>; group: string };

export type ServerMsg =
  | {
      type: "welcome";
      title: string;
      units: { id: string; title: string }[];
      actions: ActionInfo[]; // nur die für diese Funktion erlaubten
      participant: string | null;
      trupp: { name: string; role: Role; unit: string } | null; // bei Beitritt mit Trupp-Code
      ai: boolean; // freie Fragen an Patienten möglich (sonst nur Themenliste)
    }
  // Übungsuhr: t Minuten zum Zeitpunkt serverNow; läuft nur bei status "running" weiter.
  | { type: "clock"; status: Status; t: number; serverNow: number; speed?: number } // speed: Übungsminuten je echter Minute (D5)
  | { type: "ack"; id: string; error: string | null; participant?: string }
  | { type: "view"; view: View }
  | { type: "leitung"; view: LeitungView }
  | { type: "error"; error: string };
