// Eine laufende Übung: gespeichert werden nur die angenommenen Helfer-Aktionen.
// Der Zustand wird daraus mit der Engine neu berechnet; so lassen sich verspätete (offline gepufferte)
// Aktionen an ihrer echten Zeit einsortieren.
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Action, Patient, Scenario } from "@dps/schema";
import type { ClientMsg, View } from "@dps/schema/protocol";
import { apply, initial, tick, validate, visible, type Defs, type Event, type Settings, type State } from "@dps/engine";

export type Library = { defs: Defs; scenarios: Record<string, Scenario> };

export function loadLibrary(dir: URL): Library {
  const read = (p: string) => JSON.parse(readFileSync(new URL(p, dir), "utf8"));
  const list = (sub: string) => readdirSync(new URL(sub, dir)).filter((f) => f.endsWith(".json"));
  const patients = Object.fromEntries(list("patients/").map((f) => Patient.parse(read(`patients/${f}`))).map((p) => [p.id, p]));
  const actions = Object.fromEntries(Action.array().parse(read("actions.json")).map((a) => [a.id, a]));
  const scenarios = Object.fromEntries(list("scenarios/").map((f) => Scenario.parse(read(`scenarios/${f}`))).map((s) => [s.id, s]));
  return { defs: { patients, actions }, scenarios };
}

type Rec = { id: string; t: number; event: Event; name?: string };
type Header = { code: string; scenario: Scenario; settings: Settings; seed: number; startedAt: number };
export type Exercise = Header & { defs: Defs; records: Rec[]; seen: Set<string>; names: Map<string, string>; file?: string };

export function createExercise(h: Header, defs: Defs, file?: string): Exercise {
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify({ type: "exercise", ...h }) + "\n");
  }
  return { ...h, defs, records: [], seen: new Set(), names: new Map(), file };
}

// Lädt eine Übung aus ihrer Protokolldatei (eine JSON-Zeile je Eintrag).
export function loadExercise(file: string, defs: Defs): Exercise {
  const [head, ...lines] = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const { type: _, ...h } = head;
  const ex: Exercise = { ...(h as Header), defs, records: [], seen: new Set(), names: new Map(), file };
  for (const { type: _t, ...r } of lines) addRecord(ex, r as Rec);
  return ex;
}

function addRecord(ex: Exercise, r: Rec) {
  const i = ex.records.findLastIndex((x) => x.t <= r.t) + 1;
  ex.records.splice(i, 0, r);
  ex.seen.add(r.id);
  if (r.event.type === "join" && r.name) ex.names.set(r.event.participant, r.name);
}

export const minutes = (ex: Exercise, ms: number) => Math.max(0, (ms - ex.startedAt) / 60000);

// ponytail: rechnet bei jeder Abfrage alles neu (O(Aktionen)); bei Bedarf Zwischenstände cachen.
export function stateAt(ex: Exercise, t: number): State {
  const s = initial(ex.scenario, ex.defs, ex.settings, ex.seed);
  for (const r of ex.records) {
    if (r.t > t) break;
    tick(s, r.t);
    if (!validate(s, r.event)) apply(s, r.event); // nachträglich ungültig gewordene Aktionen fallen weg
  }
  tick(s, t);
  return s;
}

const BUFFER_MINUTES = 10; // so weit zurück darf eine gepufferte Aktion liegen

export function submit(
  ex: Exercise,
  participant: string | null,
  msg: Extract<ClientMsg, { type: "intent" }>,
  now: number,
): { error: string | null; participant?: string } {
  if (ex.seen.has(msg.id)) return { error: null, participant: participant ?? undefined }; // erneut gesendet
  const nowT = minutes(ex, now);
  const atT = minutes(ex, msg.at);
  const i = msg.intent;
  let event: Event;
  let name: string | undefined;
  if (i.type === "join") {
    if (participant) return { error: "schon beigetreten" };
    event = { t: nowT, type: "join", participant: randomUUID(), unit: i.unit };
    name = i.name;
  } else {
    if (!participant) return { error: "nicht beigetreten" };
    const t = atT <= nowT && atT >= nowT - BUFFER_MINUTES ? atT : nowT;
    event = { ...i, t, participant };
  }
  const error = validate(stateAt(ex, event.t), event);
  if (error) return { error };
  const r: Rec = { id: msg.id, t: event.t, event, name };
  addRecord(ex, r);
  if (ex.file) appendFileSync(ex.file, JSON.stringify({ type: "intent", ...r }) + "\n");
  return { error: null, participant: event.participant };
}

// Was ein Helfer sehen darf: nur der gescannte Patient, nur aufgedeckte Befunde, kein Titel (der verrät die Diagnose).
export function viewFor(ex: Exercise, s: State, id: string): View {
  const me = s.participants[id];
  if (!me) return { me: null, patient: null, inventory: {}, unitArrived: false };
  const unit = s.units[me.unit];
  const p = me.patient;
  return {
    me: { id, name: ex.names.get(id) ?? "", unit: me.unit, busy: me.busy && { action: me.busy.action, until: me.busy.until } },
    patient: p
      ? { id: p, picture: ex.defs.patients[p].picture, findings: visible(s, p), triage: s.patients[p].triage, done: s.patients[p].done }
      : null,
    inventory: unit.inventory,
    unitArrived: s.t >= unit.arrivesAt,
  };
}
