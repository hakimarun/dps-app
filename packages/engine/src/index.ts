// Simulations-Engine: reines TypeScript ohne Ein- und Ausgabe.
// Gleiches Szenario, gleicher Seed und gleiche Ereignisse ergeben immer denselben Zustand.
import type { Action, Algorithm, Findings, Patient, Phase, Place, Scenario, Sk } from "@dps/schema";

export type Settings = { algorithm: Algorithm; phaseMinutes: number; random: boolean };
export const defaultSettings: Settings = { algorithm: "mstart", phaseMinutes: 15, random: false };

// Zeit t in Minuten seit Übungsstart.
export type Event =
  | { t: number; type: "join"; participant: string; unit: string }
  | { t: number; type: "scan"; participant: string; patient: string }
  | { t: number; type: "start"; participant: string; patient: string; action: string }
  | { t: number; type: "end"; participant: string }
  | { t: number; type: "triage"; participant: string; patient: string; sk: Sk }
  | { t: number; type: "admit"; participant: string; patient: string; place: Place }
  | { t: number; type: "handover"; participant: string; patient: string; vehicle: string; destination: string; diagnosis: string }
  | { t: number; type: "phase"; patient: string; to: string };

type Running = { action: string; patient: string; until: number | null; ok: boolean };
export type PatientState = {
  phase: string;
  phaseStart: number;
  done: string[];
  triage: Sk | null;
  place: Place | "fundort" | "abtransport";
  left: boolean; // abtransportiert: läuft nicht weiter
};
export type ParticipantState = { unit: string; patient: string | null; busy: Running | null };
export type Defs = { patients: Record<string, Patient>; actions: Record<string, Action> };
export type State = {
  t: number;
  settings: Settings;
  rng: number;
  defs: Defs;
  patients: Record<string, PatientState>;
  participants: Record<string, ParticipantState>;
  units: Record<string, { arrivesAt: number; seats: number; inventory: Record<string, number> }>;
};

export function initial(scenario: Scenario, defs: Defs, settings: Settings = defaultSettings, seed = 1): State {
  const patients: State["patients"] = {};
  for (const id of scenario.patients) {
    const p = defs.patients[id];
    if (!p) throw new Error(`Patient ${id} fehlt in der Bibliothek`);
    patients[id] = { phase: p.start, phaseStart: 0, done: [], triage: null, place: "fundort", left: false };
  }
  const units: State["units"] = {};
  for (const u of scenario.units) units[u.id] = { arrivesAt: u.arrivesAt, seats: u.seats, inventory: { ...u.inventory } };
  return { t: 0, settings, rng: seed >>> 0, defs, patients, participants: {}, units };
}

// Prüft eine Absicht eines Helfers. Gibt den Grund der Ablehnung zurück oder null.
export function validate(s: State, e: Event): string | null {
  if (e.type === "phase") return "Phasenwechsel erzeugt nur die Engine";
  if (e.type === "join") return s.units[e.unit] ? (s.participants[e.participant] ? "schon beigetreten" : null) : "unbekannte Einheit";
  const h = s.participants[e.participant];
  if (!h) return "nicht beigetreten";
  if (e.type === "end") return h.busy?.until === null ? null : "keine dauerhafte Maßnahme aktiv";
  if (h.busy) return "Helfer ist beschäftigt";
  const ps = s.patients[e.patient];
  if (!ps) return "unbekannter Patient";
  if (ps.left) return "Patient ist bereits abtransportiert";
  if (e.type === "scan") return null;
  if (h.patient !== e.patient) return "erst Patient scannen";
  if (e.type === "triage" || e.type === "admit") return null;
  if (e.type === "handover") {
    const v = s.units[e.vehicle];
    if (!v) return "unbekanntes Fahrzeug";
    if (e.t < v.arrivesAt) return "Fahrzeug noch nicht eingetroffen";
    if (v.seats < 1) return "kein Platz mehr im Fahrzeug";
    if (Object.values(s.participants).some((x) => x.busy?.patient === e.patient)) return "erst laufende Maßnahmen beenden";
    return null;
  }
  const a = s.defs.actions[e.action];
  if (!a) return "unbekannte Maßnahme";
  const unit = s.units[h.unit];
  if (e.t < unit.arrivesAt) return "Einheit noch nicht eingetroffen";
  for (const [item, n] of Object.entries(a.material)) if ((unit.inventory[item] ?? 0) < n) return `kein ${item} mehr`;
  return null;
}

// Wendet ein bereits geprüftes Ereignis an. Verändert s und gibt s zurück, damit events.reduce(apply, s) funktioniert.
export function apply(s: State, e: Event): State {
  s.t = Math.max(s.t, e.t);
  switch (e.type) {
    case "join":
      s.participants[e.participant] = { unit: e.unit, patient: null, busy: null };
      break;
    case "scan":
      s.participants[e.participant].patient = e.patient;
      break;
    case "start": {
      const a = s.defs.actions[e.action];
      const h = s.participants[e.participant];
      const inv = s.units[h.unit].inventory;
      for (const [item, n] of Object.entries(a.material)) inv[item] -= n;
      const ok = !(s.settings.random && a.failChance > 0 && draw(s) < a.failChance);
      h.busy = { action: e.action, patient: e.patient, until: a.minutes === null ? null : e.t + a.minutes, ok };
      break;
    }
    case "end": {
      const h = s.participants[e.participant];
      const b = h.busy!;
      const done = s.patients[b.patient].done;
      if (b.ok && !done.includes(b.action)) done.push(b.action);
      h.busy = null;
      break;
    }
    case "triage":
      s.patients[e.patient].triage = e.sk;
      break;
    case "admit":
      s.patients[e.patient].place = e.place;
      break;
    case "handover": {
      const ps = s.patients[e.patient];
      Object.assign(ps, { left: true, place: "abtransport" });
      if (!ps.done.includes("handover")) ps.done.push("handover");
      s.units[e.vehicle].seats--;
      break;
    }
    case "phase":
      s.patients[e.patient].phase = e.to;
      s.patients[e.patient].phaseStart = e.t;
      break;
  }
  return s;
}

// Erzeugt und wendet alle bis `now` fälligen Ereignisse an: Maßnahmenenden vor Phasenwechseln.
export function tick(s: State, now: number): Event[] {
  const out: Event[] = [];
  for (;;) {
    let next: Event | null = null;
    for (const [id, h] of Object.entries(s.participants)) {
      const u = h.busy?.until;
      if (u != null && u <= now && (!next || u < next.t)) next = { t: u, type: "end", participant: id };
    }
    for (const [id, ps] of Object.entries(s.patients)) {
      const ph = phaseDef(s, id);
      if (ph.dead || ph.left || ps.left || (!ph.rules.length && !ph.else)) continue;
      const end = ps.phaseStart + (ph.minutes ?? s.settings.phaseMinutes);
      if (end <= now && (!next || end < next.t)) next = { t: end, type: "phase", patient: id, to: nextPhase(s, id) };
    }
    if (!next) break;
    apply(s, next);
    out.push(next);
  }
  s.t = Math.max(s.t, now);
  return out;
}

function nextPhase(s: State, id: string): string {
  const ps = s.patients[id];
  const ph = phaseDef(s, id);
  const running = Object.values(s.participants).flatMap((h) => (h.busy?.patient === id ? [h.busy.action] : []));
  const rule = ph.rules.find((r) => r.when.every((a) => ps.done.includes(a)) && r.active.every((a) => running.includes(a)));
  // Keine Regel und kein "else": Phase bleibt, die Regeln werden nach der nächsten Phasendauer erneut geprüft.
  return rule?.then ?? ph.else ?? ps.phase;
}

export function phaseDef(s: State, id: string): Phase {
  return s.defs.patients[id].phases[s.patients[id].phase];
}

export function findings(s: State, id: string): Findings {
  const p = s.defs.patients[id];
  const f = phaseDef(s, id).findings;
  return { ...p.base, ...f, exam: { ...p.base.exam, ...f.exam } };
}

// Was der Helfer sieht: Befunde, die eine Maßnahme aufdeckt, erst nach dieser Maßnahme.
export function visible(s: State, id: string): Partial<Findings> {
  const done = new Set(s.patients[id].done);
  const gates = new Map<string, string[]>();
  for (const a of Object.values(s.defs.actions)) for (const k of a.reveals) gates.set(k, [...(gates.get(k) ?? []), a.id]);
  const shown = (k: string) => !gates.has(k) || gates.get(k)!.some((a) => done.has(a));
  const { exam, ...rest } = findings(s, id);
  const out: Partial<Findings> = Object.fromEntries(Object.entries(rest).filter(([k]) => shown(k)));
  out.exam = Object.fromEntries(Object.entries(exam).filter(([k]) => shown(`exam.${k}`)));
  return out;
}

// Soll-Sichtungskategorie des aktuellen Zustands für den gewählten Algorithmus.
export function targetSk(s: State, id: string): Sk {
  const ph = phaseDef(s, id);
  return ph.dead ? "EX" : triage(findings(s, id), s.settings.algorithm);
}

const breathingDisorder = (f: Findings) => !f.breathing || f.rr < 10 || f.rr > 30 || f.stridor;
const redFlags = (f: Findings) => breathingDisorder(f) || f.spurtingBleeding || !f.radialPulse || !f.followsCommands;

export function triage(f: Findings, algorithm: Algorithm): Sk {
  switch (algorithm) {
    // mSTaRT nach Neidel und Heller 2021; Gehfähige werden gegen die Rot-Kriterien nachgesichtet.
    // Stridor: Kriterium "Inhalationstrauma mit Stridor" aus dem Original (Kanz 2006).
    // ponytail: spritzende Blutung -> rot. Quellen sind uneinheitlich (teils "Blutstillung, weiter"); fachlich prüfen.
    case "mstart":
      if (f.walking) return redFlags(f) ? "I" : "III";
      if (f.lethalInjury) return "EX";
      return redFlags(f) ? "I" : "II";
    // ASAV: wie mSTaRT, aber "Atemstörung" statt gezählter Atemfrequenz; keine Nachsichtung Gehfähiger.
    case "asav":
      if (f.walking) return "III";
      if (f.lethalInjury) return "EX";
      return redFlags(f) ? "I" : "II";
    // PRIOR: Problemorientiert nach ABCDE, ohne gezählte Vitalwerte.
    // ponytail: Schwellen sind Annahmen (bewusstlos = GCS <= 8, starke Schmerzen = NRS >= 7); fachlich prüfen.
    case "prior":
      if (f.lethalInjury) return "EX";
      if (f.gcs <= 8 || breathingDisorder(f) || !f.radialPulse || f.spurtingBleeding || !f.followsCommands || (f.pain ?? 0) >= 7)
        return "I";
      return f.walking ? "III" : "II";
  }
}

// mulberry32: kleiner, reproduzierbarer Zufallsgenerator; der Zustand liegt in s.rng.
function draw(s: State): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
