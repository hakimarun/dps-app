// Eine Übung: gespeichert werden nur die angenommenen Helfer-Aktionen und die Steuerbefehle der Leitung.
// Der Zustand wird daraus mit der Engine neu berechnet; so lassen sich verspätete (offline gepufferte)
// Aktionen an ihrer echten Zeit einsortieren. Keine Ein- und Ausgabe hier, das Speichern machen onRecord/onControl.
import { readFileSync, readdirSync } from "node:fs";
import { Action, Patient, Scenario, type Sk } from "@dps/schema";
import { TOPIC_LABEL, type ClientMsg, type LeitungView, type Role, type Status, type Trupp, type View } from "@dps/schema/protocol";
import type { Ai } from "./ai.ts";
import { askPatient } from "./dialog.ts";
import { apply, describe, initial, phaseDef, targetSk, tick, validate, visible, type Defs, type Event, type Settings, type State } from "@dps/engine";

export type Library = { defs: Defs; scenarios: Record<string, Scenario> };

export function loadLibrary(dir: URL): Library {
  const read = (p: string) => JSON.parse(readFileSync(new URL(p, dir), "utf8"));
  const list = (sub: string) => readdirSync(new URL(sub, dir)).filter((f) => f.endsWith(".json"));
  const patients = Object.fromEntries(list("patients/").map((f) => Patient.parse(read(`patients/${f}`))).map((p) => [p.id, p]));
  const actions = Object.fromEntries(Action.array().parse(read("actions.json")).map((a) => [a.id, a]));
  const scenarios = Object.fromEntries(list("scenarios/").map((f) => Scenario.parse(read(`scenarios/${f}`))).map((s) => [s.id, s]));
  return { defs: { patients, actions }, scenarios };
}

export type Rec = { id: string; t: number; event: Event; name?: string; trupp?: string };
export type Control = { at: number; type: "start" | "pause" | "resume" | "end" | "release" }; // release: Berichte freigegeben
export type Header = { code: string; owner: string; scenario: Scenario; settings: Settings; seed: number; created: number; trupps?: Trupp[] };
export type Exercise = Header & {
  defs: Defs;
  records: Rec[];
  controls: Control[];
  seen: Set<string>;
  names: Map<string, string>;
  truppOf: Map<string, string>; // Teilnehmer -> Trupp-Code
  onRecord?: (r: Rec) => void;
  onControl?: (c: Control) => void;
  // Zwischenstand: Zustand nach den ersten n Einträgen, fortgeschrieben bis t. Verfällt, wenn ein Eintrag davor einsortiert wird.
  cache?: { n: number; t: number; s: State };
};

export function createExercise(h: Header, defs: Defs): Exercise {
  return { ...h, trupps: h.trupps ?? [], defs, records: [], controls: [], seen: new Set(), names: new Map(), truppOf: new Map() };
}

export function addRecord(ex: Exercise, r: Rec) {
  const i = ex.records.findLastIndex((x) => x.t <= r.t) + 1;
  if (ex.cache && (i < ex.cache.n || r.t < ex.cache.t)) delete ex.cache; // verspätete Offline-Aktion: neu rechnen
  ex.records.splice(i, 0, r);
  ex.seen.add(r.id);
  if (r.event.type === "join" && r.name) ex.names.set(r.event.participant, r.name);
  if (r.event.type === "join" && r.trupp) ex.truppOf.set(r.event.participant, r.trupp);
}

export const truppOf = (ex: Exercise, participant: string) => ex.trupps!.find((t) => t.code === ex.truppOf.get(participant)) ?? null;
export const roleOf = (ex: Exercise, participant: string): Role => truppOf(ex, participant)?.role ?? "behandlung";

// Sichtungstrupps: nur Sichtung und lebensrettende Sofortmaßnahmen (Blutstillung, Atemweg freimachen).
const SICHTUNG_ACTIONS = ["tourniquet", "pressure_dressing", "airway_open", "recovery_position"];
export const allowedActions = (ex: Exercise, role: Role) =>
  Object.values(ex.defs.actions).filter((a) => role !== "sichtung" || SICHTUNG_ACTIONS.includes(a.id));

export const PLACE: Record<string, string> = { fundort: "Fundort", ablage: "Patientenablage", bhp: "Behandlungsplatz", abtransport: "abtransportiert" };

export function status(ex: Exercise): Status {
  const last = ex.controls.findLast((c) => c.type !== "release")?.type;
  return !last ? "ready" : last === "pause" ? "paused" : last === "end" ? "ended" : "running";
}

export const released = (ex: Exercise) => ex.controls.some((c) => c.type === "release");

// Übungsminuten bis ms: nur die Zeit, in der die Übung lief.
export function minutes(ex: Exercise, ms: number): number {
  let total = 0;
  let since: number | null = null;
  for (const c of ex.controls) {
    if (c.at > ms) break;
    if (c.type === "start" || c.type === "resume") since = c.at;
    else if (since !== null) (total += c.at - since), (since = null);
  }
  if (since !== null) total += ms - since;
  return Math.max(0, total / 60000);
}

export function control(ex: Exercise, type: Control["type"], now: number): string | null {
  const s = status(ex);
  const ok = { start: s === "ready", pause: s === "running", resume: s === "paused", end: s !== "ended", release: s === "ended" && !released(ex) }[type];
  if (!ok) return `in diesem Zustand (${s}) nicht möglich`;
  const c = { at: now, type };
  ex.controls.push(c);
  ex.onControl?.(c);
  return null;
}

// ponytail: rechnet bei jeder Abfrage alles neu (O(Aktionen)); bei Bedarf Zwischenstände cachen.
export function stateAt(ex: Exercise, t: number, generated?: Event[]): State {
  // Ohne Ereignisliste vom Zwischenstand weiterrechnen statt das ganze Protokoll neu (sonst quadratisch mit der Übungsdauer).
  const c = !generated && ex.cache && ex.cache.t <= t ? ex.cache : null;
  const s = c ? copy(c.s) : initial(ex.scenario, ex.defs, ex.settings, ex.seed);
  let n = c ? c.n : 0;
  for (const r of ex.records.slice(n)) {
    if (r.t > t) break;
    n++;
    const g = tick(s, r.t);
    generated?.push(...g);
    if (!validate(s, r.event)) apply(s, r.event); // nachträglich ungültig gewordene Aktionen fallen weg
  }
  const rest = tick(s, t); // nicht in generated?.push(...) einbetten: ?. würde tick sonst überspringen
  generated?.push(...rest);
  if (!generated && (!ex.cache || ex.cache.t <= t)) ex.cache = { n, t, s: copy(s) };
  return s;
}
// Nur die veränderlichen Teile kopieren; defs und settings sind unveränderlich und werden geteilt.
const copy = (s: State): State => ({ ...s, patients: structuredClone(s.patients), participants: structuredClone(s.participants), units: structuredClone(s.units) });

const BUFFER_MINUTES = 10; // so weit zurück darf eine gepufferte Aktion liegen
const NOT_RUNNING: Record<Status, string> = { ready: "Übung noch nicht gestartet", paused: "Übung pausiert", ended: "Übung beendet", running: "" };

export function submit(
  ex: Exercise,
  participant: string | null,
  msg: Extract<ClientMsg, { type: "intent" }>,
  now: number,
  trupp: Trupp | null = null, // Beitritt mit Trupp-Code
): { error: string | null; participant?: string } {
  if (ex.seen.has(msg.id)) return { error: null, participant: participant ?? undefined }; // erneut gesendet
  const st = status(ex);
  const nowT = minutes(ex, now);
  const i = msg.intent;
  if (i.type === "ask") return { error: "Fragen laufen über submitAsk" };
  let event: Event;
  let name: string | undefined;
  if (i.type === "join") {
    if (st === "ended") return { error: NOT_RUNNING.ended };
    if (participant) return { error: "schon beigetreten" };
    const unit = trupp?.unit ?? i.unit;
    if (!unit) return { error: "Einheit fehlt" };
    event = { t: nowT, type: "join", participant: crypto.randomUUID(), unit };
    name = i.name;
  } else {
    if (!participant) return { error: "nicht beigetreten" };
    if (st !== "running") return { error: NOT_RUNNING[st] };
    const role = roleOf(ex, participant);
    if (i.type === "start" && role === "sichtung" && !SICHTUNG_ACTIONS.includes(i.action))
      return { error: "Sichtungstrupps sichten und leisten nur lebensrettende Sofortmaßnahmen" };
    if (i.type === "handover" && role === "sichtung") return { error: "Die Übergabe macht ein Behandlungs- oder Transporttrupp" };
    const atT = minutes(ex, msg.at);
    const t = msg.at <= now && atT >= nowT - BUFFER_MINUTES ? atT : nowT;
    event = { ...i, t, participant };
  }
  const error = validate(stateAt(ex, event.t), event);
  if (error) return { error };
  const r: Rec = { id: msg.id, t: event.t, event, name, trupp: event.type === "join" ? trupp?.code : undefined };
  addRecord(ex, r);
  ex.onRecord?.(r);
  return { error: null, participant: event.participant };
}

// Frage an einen Patienten: prüfen, Antwort holen (KI oder Profil), mit Antwort protokollieren.
export async function submitAsk(ex: Exercise, participant: string | null, msg: Extract<ClientMsg, { type: "intent" }>, now: number, ai: Ai | null): Promise<{ error: string | null }> {
  const i = msg.intent;
  if (i.type !== "ask") return { error: "keine Frage" };
  if (ex.seen.has(msg.id)) return { error: null };
  if (!participant) return { error: "nicht beigetreten" };
  if (status(ex) !== "running") return { error: NOT_RUNNING[status(ex)] };
  if (!i.question && !i.topic) return { error: "Frage fehlt" };
  const t = minutes(ex, now);
  const question = i.question ?? TOPIC_LABEL[i.topic!];
  const s = stateAt(ex, t);
  const probe: Event = { t, type: "ask", participant, patient: i.patient, question, answer: "", topics: [] };
  const error = validate(s, probe);
  if (error) return { error };
  ex.seen.add(msg.id); // gegen doppelt gesendete Fragen, während die KI antwortet
  try {
    const history = ex.records.flatMap((r) => (r.event.type === "ask" && r.event.participant === participant && r.event.patient === i.patient ? [{ q: r.event.question, a: r.event.answer, topics: r.event.topics }] : []));
    const { answer, topics } = await askPatient(ai, ex.defs.patients[i.patient], s, i.patient, i, history);
    const r: Rec = { id: msg.id, t, event: { ...probe, answer, topics } };
    addRecord(ex, r);
    ex.onRecord?.(r);
    return { error: null };
  } catch (e) {
    ex.seen.delete(msg.id);
    return { error: e instanceof Error ? e.message : "Fehler bei der Antwort" };
  }
}

// H2: Im Modus "text" bekommt das Handy nur Befundtext, keine Zahlen (auch nicht versteckt im Datenstrom).
const NUMERIC = ["rr", "hr", "bp", "spo2", "gcs", "recap", "temp"] as const;
function findingsFor(ex: Exercise, s: State, p: string) {
  const f = visible(s, p);
  if (ex.settings.vitals !== "text") return { findings: f, vitalsText: null, live: ex.settings.vitals === "live" };
  const vitalsText = describe(f);
  const { glucose: _, ...exam } = f.exam ?? {};
  return { findings: { ...Object.fromEntries(Object.entries(f).filter(([k]) => !(NUMERIC as readonly string[]).includes(k))), exam }, vitalsText };
}

// Was ein Helfer sehen darf: nur der gescannte Patient, nur aufgedeckte Befunde, kein Titel (der verrät die Diagnose).
export function viewFor(ex: Exercise, s: State, id: string): View {
  const me = s.participants[id];
  if (!me) return { me: null, patient: null, inventory: {}, unitArrived: false, vehicles: [] };
  const unit = s.units[me.unit];
  const p = me.patient;
  const ps = p ? s.patients[p] : null;
  return {
    me: { id, name: ex.names.get(id) ?? "", unit: me.unit, role: roleOf(ex, id), trupp: truppOf(ex, id)?.name ?? null, busy: me.busy && { action: me.busy.action, until: me.busy.until } },
    patient: p && ps
      ? {
          id: p, picture: ex.defs.patients[p].picture, ...findingsFor(ex, s, p), triage: ps.triage, done: ps.done, place: PLACE[ps.place], left: ps.left,
          dialog: ex.records.flatMap((r) => (r.event.type === "ask" && r.event.participant === id && r.event.patient === p ? [{ q: r.event.question, a: r.event.answer }] : [])).slice(-10),
        }
      : null,
    inventory: unit.inventory,
    unitArrived: s.t >= unit.arrivesAt,
    vehicles: ex.scenario.units.filter((u) => u.seats > 0).map((u) => ({ id: u.id, title: u.title, seats: s.units[u.id].seats, arrived: s.t >= u.arrivesAt })),
  };
}

const RANK: Record<Sk, number> = { I: 3, II: 2, III: 1, IV: 0, EX: -1 };
const CONTACT_ALERT_MIN = 5;

// Was die Leitung sieht: alles, inklusive Soll-SK, Hinweisen und Ereignisstrom.
export function leitungView(ex: Exercise, now: number): LeitungView {
  const t = minutes(ex, now);
  const generated: Event[] = [];
  const s = stateAt(ex, t, generated);
  const name = (id: string) => ex.names.get(id) ?? "?";
  const action = (id: string) => ex.defs.actions[id]?.title ?? id;
  const unit = (id: string) => ex.scenario.units.find((u) => u.id === id)?.title ?? id;
  const counts: LeitungView["counts"] = { I: 0, II: 0, III: 0, IV: 0, EX: 0, offen: 0 };
  const start = initial(ex.scenario, ex.defs, ex.settings, ex.seed); // für den Trend: Soll-SK zu Beginn
  const patients = Object.entries(s.patients).map(([id, ps]) => {
    const ph = phaseDef(s, id);
    const target = targetSk(s, id);
    const helpers = Object.entries(s.participants).filter(([, h]) => h.busy?.patient === id || h.patient === id).map(([hid]) => name(hid));
    const busyHere = Object.values(s.participants).some((h) => h.busy?.patient === id);
    const last = ex.records.findLast((r) => r.t <= t && "patient" in r.event && r.event.patient === id)?.t ?? null;
    const lastContact = busyHere ? t : last;
    counts[ps.triage ?? "offen"]++;
    const alert = ph.dead
      ? "verstorben"
      : ph.left || ps.left
        ? null
        : ps.triage && RANK[ps.triage] < RANK[target]
          ? `Untertriage (Soll ${target})`
          : target === "I" && t - (lastContact ?? 0) >= CONTACT_ALERT_MIN
            ? `seit ${Math.floor(t - (lastContact ?? 0))} min ohne Helfer`
            : !ps.triage && t >= 10
              ? "nicht gesichtet"
              : null;
    const before = targetSk(start, id);
    const trend = target === before ? "gleich" : target === "EX" || RANK[target] > RANK[before] ? "schlechter" : "besser"; // verstorben zählt als schlechter
    return { id, title: ex.defs.patients[id].title, phase: ph.left || ps.left ? "abtransportiert" : ps.phase, target, triage: ps.triage, helpers, lastContact, alert, place: PLACE[ps.place], trend } as const;
  });
  // E2: Leerlauf = Zeit seit der letzten Aktion (bei Maßnahmen: seit ihrem Ende)
  const lastActive = new Map<string, number>();
  for (const r of ex.records) {
    if (r.t > t || !("participant" in r.event)) continue;
    const end = r.event.type === "start" ? r.t + (ex.defs.actions[r.event.action]?.minutes ?? 0) : r.t;
    lastActive.set(r.event.participant, Math.max(lastActive.get(r.event.participant) ?? 0, end));
  }
  const helpers = Object.entries(s.participants).map(([id, h]) => ({
    id, name: name(id), unit: unit(h.unit), trupp: truppOf(ex, id)?.name ?? null, role: roleOf(ex, id), patient: h.patient, busy: h.busy ? action(h.busy.action) : null,
    idle: h.busy ? null : Math.max(0, t - (lastActive.get(id) ?? 0)),
  }));
  const trupps = ex.trupps!.map((tr) => ({ ...tr, unit: unit(tr.unit), members: [...ex.truppOf].filter(([, c]) => c === tr.code).map(([pid]) => name(pid)) }));
  const events = timeline(ex, t, generated).reverse().slice(0, 30).map((e) => ({ t: e.t, text: e.text }));
  return { code: ex.code, title: ex.scenario.title, status: status(ex), t, counts, patients, helpers, trupps, events };
}

// Alle Ereignisse bis t mit Text, aufsteigend: Aktionen der Helfer und echte Phasenwechsel der Patienten.
// Gemeinsame Grundlage für Live-Lage, Replay (F4) und CSV-Export (F6).
export type TimelineEvent = { t: number; type: Event["type"]; text: string; patient: string | null; who: string | null; trupp: string | null };
export function timeline(ex: Exercise, t: number, generated?: Event[]): TimelineEvent[] {
  if (!generated) stateAt(ex, t, (generated = []));
  const name = (id: string) => ex.names.get(id) ?? "?";
  const action = (id: string) => ex.defs.actions[id]?.title ?? id;
  const unit = (id: string) => ex.scenario.units.find((u) => u.id === id)?.title ?? id;
  const P = (p: string) => p.toUpperCase();
  const text = (e: Event): string => {
    switch (e.type) {
      case "join": return `${name(e.participant)} tritt bei (${truppOf(ex, e.participant)?.name ?? unit(e.unit)})`;
      case "scan": return `${name(e.participant)} scannt ${P(e.patient)}`;
      case "start": return `${name(e.participant)}: ${action(e.action)} an ${P(e.patient)}`;
      case "end": return `${name(e.participant)}: Maßnahme beendet`;
      case "triage": return `${name(e.participant)} sichtet ${P(e.patient)}: ${e.sk}`;
      case "ask": return `${name(e.participant)} fragt ${P(e.patient)}: „${e.question}“`;
      case "admit": return `${name(e.participant)} nimmt ${P(e.patient)} auf: ${PLACE[e.place]}`;
      case "handover": return `${name(e.participant)} übergibt ${P(e.patient)} an ${unit(e.vehicle)} → ${e.destination}`;
      case "phase": return `${P(e.patient)} wechselt in Phase ${e.to}`;
    }
  };
  // Nur echte Phasenwechsel; die Engine meldet auch erneute Regelprüfungen in derselben Phase.
  const prev: Record<string, string> = Object.fromEntries(ex.scenario.patients.map((id) => [id, ex.defs.patients[id].start]));
  const changes = generated.filter((e) => {
    if (e.type !== "phase" || prev[e.patient] === e.to) return false;
    prev[e.patient] = e.to;
    return true;
  });
  return [...ex.records.filter((r) => r.t <= t).map((r) => r.event), ...changes]
    .sort((a, b) => a.t - b.t)
    .map((e) => {
      const who = "participant" in e ? e.participant : null;
      return { t: e.t, type: e.type, text: text(e), patient: "patient" in e ? e.patient : null, who: who && name(who), trupp: who && (truppOf(ex, who)?.name ?? null) };
    });
}

// F4: Replay nach der Übung: je Minute die Lage aller Patienten (Phase, Soll- und Ist-SK, Ort), dazu alle Ereignisse.
export function replay(ex: Exercise, now: number) {
  const end = minutes(ex, now);
  const frames = [];
  // ponytail: rechnet jede Minute ab Start neu (O(Minuten × Aktionen)); reicht für Übungen von wenigen Stunden.
  for (let m = 0; m <= Math.ceil(end); m++) {
    const t = Math.min(m, end);
    const s = stateAt(ex, t, []);
    frames.push({
      t,
      patients: Object.entries(s.patients).map(([id, ps]) => {
        const ph = phaseDef(s, id);
        return { id, phase: ps.phase, triage: ps.triage, target: targetSk(s, id), place: PLACE[ps.place], dead: !!ph.dead, left: !!(ph.left || ps.left) };
      }),
    });
  }
  const patients = ex.scenario.patients.map((id) => ({ id, title: ex.defs.patients[id].title }));
  return { code: ex.code, title: ex.scenario.title, end, patients, frames, events: timeline(ex, end) };
}

// F6: Ereignisprotokoll als CSV. Semikolon und BOM, damit Excel mit deutschen Einstellungen es direkt öffnet.
// Namen und Fragen stammen von Helfern: Zellen mit = + - @ am Anfang entschärfen, sonst rechnet die Tabelle sie als Formel.
export function csv(ex: Exercise, now: number): string {
  const cell = (v: string) => {
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[;"\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const mmss = (t: number) => { const s = Math.round(t * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const rows = [
    ["Minute", "Ereignis", "Patient", "Helfer", "Trupp", "Text"],
    ...timeline(ex, minutes(ex, now)).map((e) => [mmss(e.t), e.type, e.patient?.toUpperCase() ?? "", e.who ?? "", e.trupp ?? "", e.text]),
  ];
  return "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

// Fall des Tages (Solo): reihum ein Musterfall je Kalendertag (UTC), damit alle am selben Tag denselben Fall üben.
// Tot aufgefundene Patienten taugen nicht für ein Einzeltraining.
export function caseOfDay(lib: Library, now: number): string {
  const ids = Object.values(lib.defs.patients).filter((p) => /^p\d+$/.test(p.id) && !p.phases[p.start].dead).map((p) => p.id).sort();
  return ids[Math.floor(now / 86_400_000) % ids.length];
}
// Ein Patient, alle Fahrzeuge des Busunfalls sofort vor Ort, kurze Phasen für 5–10 Minuten.
export function soloHeader(lib: Library, code: string, now: number, seed: number): Header {
  const patient = caseOfDay(lib, now);
  const units = lib.scenarios.busunfall.units.map((u) => ({ ...u, arrivesAt: 0 }));
  return {
    code, owner: SOLO, created: now, seed, trupps: [],
    scenario: { id: "solo", title: `Fall des Tages: ${lib.defs.patients[patient].title}`, patients: [patient], units },
    settings: { algorithm: "mstart", phaseMinutes: 3, random: false, vitals: "live" },
  };
}
export const SOLO = "solo";
export const SOLO_MINUTES = 10; // Mindestdauer für die Auswertung
