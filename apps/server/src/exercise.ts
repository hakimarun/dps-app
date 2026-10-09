// Eine Übung: gespeichert werden nur die angenommenen Helfer-Aktionen und die Steuerbefehle der Leitung.
// Der Zustand wird daraus mit der Engine neu berechnet; so lassen sich verspätete (offline gepufferte)
// Aktionen an ihrer echten Zeit einsortieren. Keine Ein- und Ausgabe hier, das Speichern machen onRecord/onControl.
import { readFileSync, readdirSync } from "node:fs";
import { Action, Patient, Scenario, type Sk } from "@dps/schema";
import type { ClientMsg, LeitungView, Role, Status, Trupp, View } from "@dps/schema/protocol";
import { apply, initial, phaseDef, targetSk, tick, validate, visible, type Defs, type Event, type Settings, type State } from "@dps/engine";

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
};

export function createExercise(h: Header, defs: Defs): Exercise {
  return { ...h, trupps: h.trupps ?? [], defs, records: [], controls: [], seen: new Set(), names: new Map(), truppOf: new Map() };
}

export function addRecord(ex: Exercise, r: Rec) {
  const i = ex.records.findLastIndex((x) => x.t <= r.t) + 1;
  ex.records.splice(i, 0, r);
  ex.seen.add(r.id);
  if (r.event.type === "join" && r.name) ex.names.set(r.event.participant, r.name);
  if (r.event.type === "join" && r.trupp) ex.truppOf.set(r.event.participant, r.trupp);
}

export const truppOf = (ex: Exercise, participant: string) => ex.trupps!.find((t) => t.code === ex.truppOf.get(participant)) ?? null;
export const roleOf = (ex: Exercise, participant: string): Role => truppOf(ex, participant)?.role ?? "behandlung";

// Sichtungstrupps: nur Sichtung und lebensrettende Sofortmaßnahmen (Blutstillung, Atemweg freimachen).
const SICHTUNG_ACTIONS = ["tourniquet", "pressure_dressing", "airway_open"];
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
  const s = initial(ex.scenario, ex.defs, ex.settings, ex.seed);
  for (const r of ex.records) {
    if (r.t > t) break;
    const g = tick(s, r.t);
    generated?.push(...g);
    if (!validate(s, r.event)) apply(s, r.event); // nachträglich ungültig gewordene Aktionen fallen weg
  }
  const rest = tick(s, t); // nicht in generated?.push(...) einbetten: ?. würde tick sonst überspringen
  generated?.push(...rest);
  return s;
}

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
      ? { id: p, picture: ex.defs.patients[p].picture, findings: visible(s, p), triage: ps.triage, done: ps.done, place: PLACE[ps.place], left: ps.left }
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
    return { id, title: ex.defs.patients[id].title, phase: ph.left || ps.left ? "abtransportiert" : ps.phase, target, triage: ps.triage, helpers, lastContact, alert, place: PLACE[ps.place] };
  });
  const helpers = Object.entries(s.participants).map(([id, h]) => ({
    id, name: name(id), unit: unit(h.unit), trupp: truppOf(ex, id)?.name ?? null, role: roleOf(ex, id), patient: h.patient, busy: h.busy ? action(h.busy.action) : null,
  }));
  const trupps = ex.trupps!.map((tr) => ({ ...tr, unit: unit(tr.unit), members: [...ex.truppOf].filter(([, c]) => c === tr.code).map(([pid]) => name(pid)) }));
  const text = (e: Event): string => {
    const P = (p: string) => p.toUpperCase();
    switch (e.type) {
      case "join": return `${name(e.participant)} tritt bei (${truppOf(ex, e.participant)?.name ?? unit(e.unit)})`;
      case "scan": return `${name(e.participant)} scannt ${P(e.patient)}`;
      case "start": return `${name(e.participant)}: ${action(e.action)} an ${P(e.patient)}`;
      case "end": return `${name(e.participant)}: Maßnahme beendet`;
      case "triage": return `${name(e.participant)} sichtet ${P(e.patient)}: ${e.sk}`;
      case "admit": return `${name(e.participant)} nimmt ${P(e.patient)} auf: ${PLACE[e.place]}`;
      case "handover": return `${name(e.participant)} übergibt ${P(e.patient)} an ${unit(e.vehicle)} → ${e.destination}`;
      case "phase": return `${P(e.patient)} wechselt in Phase ${e.to}`;
    }
  };
  // Nur echte Phasenwechsel; die Engine meldet auch erneute Regelprüfungen in derselben Phase.
  const prev: Record<string, string> = Object.fromEntries(Object.keys(s.patients).map((id) => [id, ex.defs.patients[id].start]));
  const changes = generated.filter((e) => {
    if (e.type !== "phase" || prev[e.patient] === e.to) return false;
    prev[e.patient] = e.to;
    return true;
  });
  const events = [...ex.records.filter((r) => r.t <= t).map((r) => r.event), ...changes]
    .sort((a, b) => b.t - a.t)
    .slice(0, 30)
    .map((e) => ({ t: e.t, text: text(e) }));
  return { code: ex.code, title: ex.scenario.title, status: status(ex), t, counts, patients, helpers, trupps, events };
}
