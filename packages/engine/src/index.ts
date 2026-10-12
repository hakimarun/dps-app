// Simulations-Engine: reines TypeScript ohne Ein- und Ausgabe.
// Gleiches Szenario, gleicher Seed und gleiche Ereignisse ergeben immer denselben Zustand.
import type { Action, Algorithm, Findings, Patient, Phase, Place, Scenario, Sk } from "@dps/schema";

// vitals: "text" zeigt Befunde wie auf der Papier-dPS ("Puls schnell und schwach") statt Zahlen (H2),
// "live" lässt die Zahlen nach einem Phasenwechsel gleiten und leicht schwanken wie am Monitor.
// late (A8, Lageänderung): Patienten, die erst ab dieser Übungsminute auftauchen; ihr Verlauf beginnt dann.
export type Settings = { algorithm: Algorithm; phaseMinutes: number; random: boolean; vitals?: "numbers" | "live" | "text"; late?: Record<string, number> };
export const defaultSettings: Settings = { algorithm: "mstart", phaseMinutes: 15, random: false };

// Nachforderung über die Leitstelle (B3): Transportplätze und Ausstattung je Fahrzeugtyp. Das Eintreffen bestätigt die Leitung, wenn das Fahrzeug wirklich da ist.
export const REINFORCEMENT = {
  rtw: { label: "RTW", seats: 1, inventory: { tourniquet: 2, dressing: 4, wendl: 1, o2_mask: 2, needle: 1, iv_cannula: 4, infusion: 4, analgesic: 2, pelvic_binder: 1, splint: 1, rescue_blanket: 4, cervical_collar: 2, vacuum_mattress: 1, bvm: 1, chest_seal: 2, hemostatic: 2, burn_dressing: 2, glucose: 1, pacer_pads: 1 } },
  nef: { label: "NEF", seats: 0, inventory: { needle: 2, ett: 2, analgesic: 4, iv_cannula: 2, infusion: 2, o2_mask: 1, bvm: 1, chest_seal: 1, hemostatic: 1, glucose: 2, pacer_pads: 1 } },
  nktw: { label: "NKTW", seats: 1, inventory: { tourniquet: 1, dressing: 4, rescue_blanket: 4, o2_mask: 2, cervical_collar: 1, bvm: 1, glucose: 1, splint: 1 } },
  ktw: { label: "KTW", seats: 1, inventory: { dressing: 4, rescue_blanket: 4, o2_mask: 1, cervical_collar: 1 } },
} as const satisfies Record<string, { label: string; seats: number; inventory: Record<string, number> }>;

// Zeit t in Minuten seit Übungsstart.
export type Event =
  | { t: number; type: "join"; participant: string; unit: string }
  | { t: number; type: "scan"; participant: string; patient: string }
  | { t: number; type: "start"; participant: string; patient: string; action: string }
  | { t: number; type: "end"; participant: string }
  // Zweiter Helfer steigt in eine wartende Zwei-Helfer-Maßnahme am Patienten ein (C7); dann startet sie für beide.
  | { t: number; type: "assist"; participant: string; patient: string }
  // Material von einem anderen Fahrzeug vor Ort in die eigene Einheit holen (C10), je ein Stück.
  | { t: number; type: "fetch"; participant: string; from: string; item: string }
  // Führung (B3): Verstärkung bei der Leitstelle nachfordern und Patienten zum Transport freigeben.
  | { t: number; type: "request"; participant: string; kind: keyof typeof REINFORCEMENT; unit: string; title: string }
  // Leitung: nachgefordertes Fahrzeug ist wirklich eingetroffen.
  | { t: number; type: "arrive"; unit: string }
  | { t: number; type: "clear"; participant: string; patient: string }
  // Leitung ändert das Temperament eines Patienten (G11); leer = zurück zum Fall.
  | { t: number; type: "mood"; patient: string; temperament: string }
  | { t: number; type: "triage"; participant: string; patient: string; sk: Sk }
  | { t: number; type: "admit"; participant: string; patient: string; place: Place }
  // Gespräch mit dem Patienten; ändert den Zustand nicht, wird für die Auswertung protokolliert.
  | { t: number; type: "ask"; participant: string; patient: string; question: string; answer: string; topics: string[] }
  | { t: number; type: "handover"; participant: string; patient: string; vehicle: string; destination: string; diagnosis: string }
  | { t: number; type: "phase"; patient: string; to: string }
  // Eingriffe der Leitung (E5): Patient von Hand in eine Phase setzen, Nachricht an alle Helfer (z. B. Lageänderung).
  | { t: number; type: "set"; patient: string; to: string }
  | { t: number; type: "message"; text: string }
  // Beobachter-Notiz (E7): zu einem Helfer, einem Patienten oder allgemein; ändert den Zustand nicht.
  | { t: number; type: "note"; by: string; text: string; kind: "note" | "gut" | "besser"; helper: string | null; patient: string | null }
  // Feedbacktext der Leitung für einen Helfer (G10); der jeweils letzte gilt. Ändert den Zustand nicht.
  | { t: number; type: "feedback"; helper: string; text: string };

type Running = { action: string; patient: string; until: number | null; ok: boolean; waiting?: boolean }; // waiting: wartet auf den zweiten Helfer (C7)
export type PatientState = {
  phase: string;
  phaseStart: number;
  from: string | null; // vorige Phase, für gleitende Vitalwerte
  done: string[];
  triage: Sk | null;
  place: Place | "fundort" | "abtransport";
  left: boolean; // abtransportiert: läuft nicht weiter
  cleared: boolean; // von der Führung zum Transport freigegeben (B3)
  mood: string | null; // Temperament, von der Leitung live geändert (G11); null = wie im Fall
  appears: number; // ab dieser Minute auffindbar (A8, später entdeckte Patienten)
  pace: number; // Faktor auf die Phasendauer: mit Zufall 0,8–1,2 je Patient (A8, Verlaufsvarianten)
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
  units: Record<string, { title: string; arrivesAt: number; seats: number; inventory: Record<string, number> }>;
};

export function initial(scenario: Scenario, defs: Defs, settings: Settings = defaultSettings, seed = 1): State {
  const patients: State["patients"] = {};
  for (const id of scenario.patients) {
    const p = defs.patients[id];
    if (!p) throw new Error(`Patient ${id} fehlt in der Bibliothek`);
    const appears = settings.late?.[id] ?? 0;
    const pace = settings.random ? 0.8 + 0.4 * unit(`${seed}:${id}`) : 1;
    patients[id] = { phase: p.start, phaseStart: appears, from: null, done: [], triage: null, place: "fundort", left: false, cleared: false, mood: null, appears, pace };
  }
  const units: State["units"] = {};
  for (const u of scenario.units) units[u.id] = { title: u.title, arrivesAt: u.arrivesAt, seats: u.seats, inventory: { ...u.inventory } };
  return { t: 0, settings, rng: seed >>> 0, defs, patients, participants: {}, units };
}

// Prüft eine Absicht eines Helfers. Gibt den Grund der Ablehnung zurück oder null.
export function validate(s: State, e: Event): string | null {
  if (e.type === "phase") return "Phasenwechsel erzeugt nur die Engine";
  if (e.type === "arrive") return !s.units[e.unit] ? "unbekanntes Fahrzeug" : s.units[e.unit].arrivesAt <= e.t ? "Fahrzeug ist schon da" : null;
  if (e.type === "message") return e.text.trim() ? null : "Nachricht fehlt";
  if (e.type === "mood") return s.patients[e.patient] ? null : "unbekannter Patient";
  if (e.type === "feedback") return !s.participants[e.helper] ? "unbekannter Helfer" : null;
  if (e.type === "note")
    return !e.text.trim() ? "Notiz fehlt" : e.helper && !s.participants[e.helper] ? "unbekannter Helfer" : e.patient && !s.patients[e.patient] ? "unbekannter Patient" : null;
  if (e.type === "set") return !s.patients[e.patient] ? "unbekannter Patient" : !s.defs.patients[e.patient].phases[e.to] ? "unbekannte Phase" : null;
  if (e.type === "join") return s.units[e.unit] ? (s.participants[e.participant] ? "schon beigetreten" : null) : "unbekannte Einheit";
  const h = s.participants[e.participant];
  if (!h) return "nicht beigetreten";
  if (e.type === "end") return h.busy?.until === null ? null : "keine dauerhafte Maßnahme aktiv";
  // Führungsaufgaben gehen auch während einer Maßnahme und ohne gescannten Patienten.
  if (e.type === "request") return REINFORCEMENT[e.kind] ? (s.units[e.unit] ? "Fahrzeug gibt es schon" : null) : "unbekannter Fahrzeugtyp";
  if (e.type === "clear") return !s.patients[e.patient] ? "unbekannter Patient" : s.patients[e.patient].left ? "Patient ist bereits abtransportiert" : !s.patients[e.patient].triage ? "Patient ist noch nicht gesichtet" : null;
  if (h.busy && !(e.type === "ask" && h.patient === e.patient)) return "Helfer ist beschäftigt"; // reden geht auch während einer Maßnahme
  if (e.type === "fetch") {
    const from = s.units[e.from];
    if (!from || e.from === h.unit) return "unbekanntes Fahrzeug";
    if (e.t < from.arrivesAt) return "Fahrzeug noch nicht eingetroffen";
    if (!(e.item in from.inventory)) return "dieses Material gibt es auf dem Fahrzeug nicht";
    return from.inventory[e.item] < 1 ? `kein ${e.item} mehr auf diesem Fahrzeug` : null;
  }
  const ps = s.patients[e.patient];
  if (!ps) return "unbekannter Patient";
  if (e.t < ps.appears) return "Diesen Patienten gibt es hier noch nicht";
  if (ps.left) return "Patient ist bereits abtransportiert";
  if (e.type === "scan") return null;
  if (h.patient !== e.patient) return "erst Patient scannen";
  if (e.type === "triage" || e.type === "admit" || e.type === "ask") return null;
  if (e.type === "assist") {
    const w = Object.values(s.participants).find((x) => x.busy?.waiting && x.busy.patient === e.patient);
    if (!w) return "keine Maßnahme wartet auf Hilfe";
    for (const [item, n] of Object.entries(s.defs.actions[w.busy!.action].material)) if ((s.units[w.unit].inventory[item] ?? 0) < n) return `kein ${item} mehr`;
    return null;
  }
  if (e.type === "handover") {
    const v = s.units[e.vehicle];
    if (!v) return "unbekanntes Fahrzeug";
    if (e.t < v.arrivesAt) return "Fahrzeug noch nicht eingetroffen";
    if (v.seats < 1) return "kein Platz mehr im Fahrzeug";
    const busy = Object.values(s.participants).find((x) => x.busy?.patient === e.patient)?.busy;
    if (busy) return `erst laufende Maßnahme beenden: ${s.defs.actions[busy.action]?.title ?? busy.action}`;
    return null;
  }
  const a = s.defs.actions[e.action];
  if (!a) return "unbekannte Maßnahme";
  const unit = s.units[h.unit];
  if (e.t < unit.arrivesAt) return Number.isFinite(unit.arrivesAt) ? `Euer Fahrzeug ${unit.title} trifft erst ab Minute ${Math.ceil(unit.arrivesAt)} ein` : `Euer Fahrzeug ${unit.title} ist noch nicht da`;
  for (const [item, n] of Object.entries(a.material))
    if ((unit.inventory[item] ?? 0) < n) return item in unit.inventory ? `kein ${item} mehr` : `kein ${item} an Bord, von einem anderen Fahrzeug holen`;
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
      if (a.helpers > 1) {
        h.busy = { action: e.action, patient: e.patient, until: null, ok: true, waiting: true }; // Material erst beim echten Start
        break;
      }
      const inv = s.units[h.unit].inventory;
      for (const [item, n] of Object.entries(a.material)) inv[item] -= n;
      const ok = !(s.settings.random && a.failChance > 0 && draw(s) < a.failChance);
      h.busy = { action: e.action, patient: e.patient, until: a.minutes === null ? null : e.t + a.minutes, ok };
      break;
    }
    case "assist": {
      const w = Object.values(s.participants).find((x) => x.busy?.waiting && x.busy.patient === e.patient)!;
      const a = s.defs.actions[w.busy!.action];
      const inv = s.units[w.unit].inventory;
      for (const [item, n] of Object.entries(a.material)) inv[item] -= n;
      const ok = !(s.settings.random && a.failChance > 0 && draw(s) < a.failChance);
      const busy = { action: a.id, patient: e.patient, until: a.minutes === null ? null : e.t + a.minutes, ok };
      w.busy = { ...busy };
      s.participants[e.participant].busy = { ...busy };
      break;
    }
    case "end": {
      const h = s.participants[e.participant];
      const b = h.busy!;
      const done = s.patients[b.patient].done;
      if (b.ok && !b.waiting && !done.includes(b.action)) done.push(b.action); // abgebrochenes Warten zählt nicht
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
    case "request": {
      const r = REINFORCEMENT[e.kind];
      s.units[e.unit] = { title: e.title, arrivesAt: Infinity, seats: r.seats, inventory: { ...r.inventory } }; // bis die Leitung das Eintreffen bestätigt
      break;
    }
    case "clear":
      s.patients[e.patient].cleared = true;
      break;
    case "mood":
      s.patients[e.patient].mood = e.temperament.trim() || null;
      break;
    case "fetch": {
      const own = s.units[s.participants[e.participant].unit].inventory;
      s.units[e.from].inventory[e.item]--;
      own[e.item] = (own[e.item] ?? 0) + 1;
      break;
    }
    case "arrive":
      s.units[e.unit].arrivesAt = e.t;
      break;
    case "message":
    case "note":
    case "feedback":
      break;
    case "set":
    case "phase":
      s.patients[e.patient].from = s.patients[e.patient].phase;
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
      const end = ps.phaseStart + (ph.minutes ?? s.settings.phaseMinutes) * ps.pace;
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
  const running = Object.values(s.participants).flatMap((h) => (h.busy?.patient === id && !h.busy.waiting ? [h.busy.action] : []));
  const rule = ph.rules.find((r) => r.when.every((a) => ps.done.includes(a)) && r.active.every((a) => running.includes(a)));
  // Keine Regel und kein "else": Phase bleibt, die Regeln werden nach der nächsten Phasendauer erneut geprüft.
  return rule?.then ?? ph.else ?? ps.phase;
}

// Aktuelles Temperament: von der Leitung geändert oder wie im Fall.
export const temperament = (s: State, id: string) => s.patients[id].mood ?? String(s.defs.patients[id].profile.temperament ?? "kooperativ");

export function phaseDef(s: State, id: string): Phase {
  return s.defs.patients[id].phases[s.patients[id].phase];
}

export function findings(s: State, id: string, phase = s.patients[id].phase): Findings {
  const p = s.defs.patients[id];
  const f = p.phases[phase].findings;
  return { ...p.base, ...f, exam: { ...p.base.exam, ...f.exam } };
}

// Vitalwerte im Modus "live": nach einem Phasenwechsel GLIDE_MIN Minuten linear vom alten zum neuen Wert,
// dazu kleine Schwankungen je Minute. Deterministisch (Hash aus Patient, Wert und Minute), damit Replay und Tests stabil bleiben.
// Nur Anzeige: Soll-Sichtung und Auswertung rechnen weiter mit den Werten der Phase.
const GLIDE_MIN = 3;
const JITTER = { hr: 2, rr: 1, spo2: 1, sys: 3, dia: 2 } as const;
function noise(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 2001) / 1000 - 1; // -1 … 1
}
const bpParts = (bp: string) => bp.match(/^(\d+)\/(\d+)$/)?.slice(1).map(Number) as [number, number] | undefined;
export function liveFindings(s: State, id: string, t = s.t): Findings {
  const ps = s.patients[id];
  const f = findings(s, id);
  if (phaseDef(s, id).dead) return f;
  const k = ps.from ? Math.min(1, (t - ps.phaseStart) / GLIDE_MIN) : 1;
  const prev = ps.from ? findings(s, id, ps.from) : f;
  const minute = Math.floor(t);
  const at = (key: string, a: number, b: number, amp: number) => {
    const v = a + (b - a) * k;
    return v <= 0 ? 0 : Math.max(0, Math.round(v + amp * noise(`${id}:${key}:${minute}`)));
  };
  const out = { ...f, hr: at("hr", prev.hr, f.hr, JITTER.hr), rr: at("rr", prev.rr, f.rr, JITTER.rr) };
  if (f.spo2 !== undefined) out.spo2 = Math.min(100, at("spo2", prev.spo2 ?? f.spo2, f.spo2, JITTER.spo2));
  const [a, b] = [bpParts(prev.bp ?? ""), bpParts(f.bp ?? "")];
  if (b) out.bp = `${at("sys", (a ?? b)[0], b[0], JITTER.sys)}/${at("dia", (a ?? b)[1], b[1], JITTER.dia)}`;
  if (f.temp !== undefined) out.temp = Math.round(((prev.temp ?? f.temp) + (f.temp - (prev.temp ?? f.temp)) * k) * 10) / 10;
  return out;
}

// Was der Helfer sieht: Befunde, die eine Maßnahme aufdeckt, erst nach dieser Maßnahme.
// Messwerte, die ein Fall nicht eigens festlegt: EKG aus der Herzfrequenz, Blutzucker und Temperatur im Normbereich.
export function ecgOf(hr: number): string {
  if (hr === 0) return "Asystolie (Nulllinie)";
  if (hr < 60) return "Sinusbradykardie";
  if (hr > 100) return "Sinustachykardie";
  return "Sinusrhythmus";
}
const withDefaults = (f: Findings): Findings => ({
  ...f, temp: f.temp ?? 36.5, exam: { ecg: ecgOf(f.hr), glucose: "98 mg/dl", ...f.exam },
});

export function visible(s: State, id: string): Partial<Findings> {
  const done = new Set(s.patients[id].done);
  const gates = new Map<string, string[]>();
  for (const a of Object.values(s.defs.actions)) for (const k of a.reveals) gates.set(k, [...(gates.get(k) ?? []), a.id]);
  const shown = (k: string) => !gates.has(k) || gates.get(k)!.some((a) => done.has(a));
  const { exam, ...rest } = withDefaults(s.settings.vitals === "live" ? liveFindings(s, id) : findings(s, id));
  const out: Partial<Findings> = Object.fromEntries(Object.entries(rest).filter(([k]) => shown(k)));
  out.exam = Object.fromEntries(Object.entries(exam).filter(([k]) => shown(`exam.${k}`)));
  return out;
}

// Soll-Sichtungskategorie des aktuellen Zustands für den gewählten Algorithmus.
export function targetSk(s: State, id: string): Sk {
  const ph = phaseDef(s, id);
  return ph.dead ? "EX" : triage(findings(s, id), s.settings.algorithm);
}

// Kinder: Atemgrenzen nach JumpSTART (Romig 2002), unter 15 oder über 45/min; Erwachsene unter 10 oder über 30/min.
const breathingDisorder = (f: Findings) => !f.breathing || (f.child ? f.rr < 15 || f.rr > 45 : f.rr < 10 || f.rr > 30) || f.stridor;
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

// Fester Zufallswert 0…1 aus einem Text (FNV-1a), unabhängig von s.rng, damit die übrigen Zufallsereignisse gleich bleiben.
function unit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// mulberry32: kleiner, reproduzierbarer Zufallsgenerator; der Zustand liegt in s.rng.
function draw(s: State): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// H2: Befundtext statt Zahlen, wie auf den Papier-Patientenkarten. Nur für sichtbare Werte.
export function describe(f: Partial<Findings>): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.rr !== undefined) out.rr = f.breathing === false || f.rr === 0 ? "keine Atmung" : f.rr < 10 ? "sehr langsam" : f.rr <= 20 ? "normal" : f.rr <= 30 ? "schnell" : "sehr schnell";
  if (f.hr !== undefined)
    out.hr = f.hr === 0 ? "kein Puls" : `${f.hr < 50 ? "sehr langsam" : f.hr < 60 ? "langsam" : f.hr <= 100 ? "normal" : f.hr <= 130 ? "schnell" : "sehr schnell"}${f.radialPulse === false ? ", Radialispuls nicht tastbar" : ""}`;
  if (f.bp !== undefined) {
    const sys = Number(f.bp.split("/")[0]);
    out.bp = !sys ? "nicht messbar" : sys < 90 ? "niedrig" : sys <= 140 ? "normal" : "hoch";
  }
  if (f.spo2 !== undefined) out.spo2 = f.spo2 >= 95 ? "normal" : f.spo2 >= 90 ? "leicht erniedrigt" : "deutlich erniedrigt";
  if (f.gcs !== undefined) out.gcs = f.gcs === 15 ? "wach, orientiert" : f.gcs >= 13 ? "benommen" : f.gcs >= 9 ? "eingetrübt" : "bewusstlos";
  if (f.recap !== undefined) out.recap = f.recap <= 2 ? "normal" : "verlängert";
  if (f.temp !== undefined) out.temp = f.temp < 35 ? "unterkühlt" : f.temp > 38 ? "Fieber" : "normal";
  const bz = Number(f.exam?.glucose?.match(/\d+/)?.[0]);
  if (bz) out.glucose = bz < 70 ? "niedrig" : bz > 200 ? "hoch" : "normal";
  return out;
}
