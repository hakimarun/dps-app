// Fall ↔ Formular für den Editor (A1). Ohne React, damit sich die Umwandlung mit Node testen lässt.
import type { Patient } from "@dps/schema";

export const CATEGORIES = ["Trauma", "Internistisch", "Neurologisch", "Pädiatrie", "Geriatrie", "Verbrennung", "Intoxikation", "Umwelt", "Psychiatrie", "Gynäkologie/Geburt", "CBRN"];
export const DIFFS: [string, string][] = [["einsteiger", "Einsteiger"], ["fortgeschritten", "Fortgeschritten"], ["experte", "Experte"]];
export const TOPICS: [string, string][] = [
  ["symptoms", "Beschwerden"], ["allergies", "Allergien"], ["medication", "Medikamente"], ["history", "Vorerkrankungen"],
  ["lastMeal", "Letzte Mahlzeit"], ["event", "Hergang"], ["risk", "Risikofaktoren"],
];
export const NUMS: [string, string][] = [["rr", "AF /min"], ["hr", "HF /min"], ["bp", "RR mmHg, z. B. 120/80"], ["spo2", "SpO₂ %"], ["recap", "Rekap s"], ["gcs", "GCS 3–15"], ["pain", "Schmerz 0–10"], ["temp", "Temperatur °C"]];
export const BOOLS: [string, string][] = [
  ["walking", "gehfähig"], ["breathing", "atmet"], ["radialPulse", "Radialispuls tastbar"], ["followsCommands", "befolgt Aufforderungen"],
  ["spurtingBleeding", "spritzende Blutung"], ["stridor", "Stridor"], ["lethalInjury", "tödliche Verletzung"],
];
export const EXAMS: [string, string][] = [
  ["ecg", "EKG, z. B. Sinustachykardie, STEMI, Kammerflimmern"], ["glucose", "Blutzucker, z. B. 38 mg/dl"], ["auscultation", "Auskultation"],
  ["percussion", "Perkussion"], ["pupils", "Pupillen"], ["motor", "Motorik"], ["pelvis", "Becken"], ["abdomen", "Bauch"], ["burn", "Verbrennung"],
  ["airway", "Atemweg"], ["bodycheck", "Bodycheck"],
];

// Formularzustand: alles als Text, damit halbe Eingaben nicht verloren gehen. "" heißt leer bzw. unverändert.
export type Tri = "" | "ja" | "nein";
export type Rule = { when: string[]; active: string[]; then: string };
export type Phase = { id: string; minutes: string; dead: boolean; nums: Record<string, string>; bools: Record<string, Tri>; exam: Record<string, string>; rules: Rule[]; else: string };
export type Form = {
  extra?: Record<string, unknown>; // Profilfelder, die das Formular nicht kennt (z. B. Quellen): unverändert mitnehmen
  id?: string; title: string; picture: string; category: string; difficulty: string; tags: string; temperament: string; pitfall: string;
  anamnesis: Record<string, string>; nums: Record<string, string>; bools: Record<string, boolean>; exam: Record<string, string>;
  phases: Phase[]; critical: { actions: string[]; within: string }[]; harmful: string[];
};

export const emptyPhase = (id: string): Phase => ({ id, minutes: "", dead: false, nums: {}, bools: {}, exam: {}, rules: [], else: "" });
export const EMPTY: Form = {
  title: "", picture: "", category: "Trauma", difficulty: "fortgeschritten", tags: "", temperament: "kooperativ", pitfall: "", anamnesis: {},
  nums: { rr: "16", hr: "90", bp: "130/80", spo2: "97", recap: "2", gcs: "15", pain: "3" },
  bools: { walking: false, breathing: true, radialPulse: true, followsCommands: true, spurtingBleeding: false, stridor: false, lethalInjury: false },
  exam: {}, phases: [emptyPhase("1")], critical: [], harmful: [],
};

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const num = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(",", ".")));

export function fromPatient(p: Patient): Form {
  const prof = p.profile as { temperament?: string; pitfall?: string; anamnesis?: Record<string, string> };
  const f = p.base as Record<string, unknown>;
  const order = [p.start, ...Object.keys(p.phases).filter((id) => id !== p.start)];
  const { temperament: _t, pitfall: _p, anamnesis: _a, ...extra } = p.profile;
  return {
    extra, id: p.id, title: p.title, picture: p.picture, category: p.meta.category, difficulty: p.meta.difficulty, tags: p.meta.tags.join(", "),
    temperament: str(prof.temperament), pitfall: str(prof.pitfall), anamnesis: { ...(prof.anamnesis ?? {}) },
    nums: Object.fromEntries(NUMS.map(([k]) => [k, str(f[k])])),
    bools: Object.fromEntries(BOOLS.map(([k]) => [k, Boolean(f[k])])),
    exam: { ...p.base.exam },
    phases: order.map((id) => {
      const ph = p.phases[id];
      const pf = ph.findings as Record<string, unknown>;
      return {
        id, minutes: str(ph.minutes), dead: ph.dead, exam: { ...(ph.findings.exam ?? {}) }, else: ph.else ?? "",
        nums: Object.fromEntries(NUMS.filter(([k]) => pf[k] !== undefined).map(([k]) => [k, str(pf[k])])),
        bools: Object.fromEntries(BOOLS.filter(([k]) => pf[k] !== undefined).map(([k]) => [k, pf[k] ? "ja" : "nein"])),
        rules: ph.rules.map((r) => ({ when: [...r.when], active: [...r.active], then: r.then })),
      };
    }),
    critical: p.scoring.critical.map((c) => ({ actions: [...c.actions], within: String(c.within) })),
    harmful: [...p.scoring.harmful],
  };
}

// Formular → Bibliotheksformat; leere Felder fallen weg.
export function toPatient(f: Form): Record<string, unknown> {
  const clean = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
  const nums = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, k === "bp" ? v.trim() : num(v)]));
  return {
    id: f.id ?? "neu", version: 1, title: f.title.trim(), picture: f.picture.trim(),
    profile: { ...f.extra, temperament: f.temperament.trim(), pitfall: f.pitfall.trim(), anamnesis: clean(f.anamnesis) },
    meta: { category: f.category, difficulty: f.difficulty, tags: f.tags.split(",").map((x) => x.trim()).filter(Boolean) },
    scoring: { critical: f.critical.filter((c) => c.actions.length).map((c) => ({ actions: c.actions, within: num(c.within) ?? 15 })), harmful: f.harmful },
    base: { ...nums(f.nums), ...f.bools, exam: clean(f.exam) },
    start: f.phases[0]?.id ?? "1",
    phases: Object.fromEntries(f.phases.map((ph) => [ph.id, {
      ...(num(ph.minutes) ? { minutes: num(ph.minutes) } : {}),
      findings: { ...nums(ph.nums), ...Object.fromEntries(Object.entries(ph.bools).filter(([, v]) => v).map(([k, v]) => [k, v === "ja"])), ...(Object.keys(clean(ph.exam)).length ? { exam: clean(ph.exam) } : {}) },
      rules: ph.rules.filter((r) => (r.when.length || r.active.length) && r.then),
      ...(ph.else ? { else: ph.else } : {}),
      dead: ph.dead,
    }])),
  };
}

