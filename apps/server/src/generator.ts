// KI-Fallgenerator (G8) und automatische Prüfung (G9). Strukturierte Ausgaben erlauben keine freien
// Schlüssel-Wert-Objekte, darum liefert die KI Listen, die hier ins Bibliotheksformat umgewandelt werden.
import { z } from "zod";
import { Patient, type Action, type Scenario, type Sk } from "@dps/schema";
import { triage } from "@dps/engine";
import type { Ai } from "./ai.ts";

const Kv = z.object({ key: z.string(), value: z.string() });
const vitals = {
  walking: z.boolean(), breathing: z.boolean(), rr: z.number(), spo2: z.number(), hr: z.number(), bp: z.string(),
  radialPulse: z.boolean(), recap: z.number(), gcs: z.number(), followsCommands: z.boolean(),
  spurtingBleeding: z.boolean(), stridor: z.boolean(), lethalInjury: z.boolean(), pain: z.number(), exam: z.array(Kv),
};
const GenPhase = z.object({
  id: z.string(),
  findings: z.object(vitals).partial(), // nur was sich gegenüber der Ausgangslage ändert
  rules: z.array(z.object({ when: z.array(z.string()), active: z.array(z.string()), then: z.string() })),
  else: z.string().optional(),
  dead: z.boolean(),
});
export const GenPatient = z.object({
  title: z.string(),
  picture: z.string(),
  category: z.enum(["Trauma", "Internistisch", "Neurologisch", "Pädiatrie", "Geriatrie", "Verbrennung", "Intoxikation", "Umwelt", "Psychiatrie", "Gynäkologie/Geburt", "CBRN"]),
  tags: z.array(z.string()),
  difficulty: z.enum(["einsteiger", "fortgeschritten", "experte"]),
  temperament: z.string(),
  pitfall: z.string(),
  anamnesis: z.array(z.object({ topic: z.enum(["symptoms", "allergies", "medication", "history", "lastMeal", "event", "risk"]), answer: z.string() })),
  base: z.object(vitals),
  start: z.string(),
  phases: z.array(GenPhase),
  critical: z.array(z.object({ actions: z.array(z.string()), within: z.number() })),
  harmful: z.array(z.string()),
  sources: z.array(z.string()), // Leitlinien/Quellen, die der Autor prüfen soll
});
export type GenPatient = z.infer<typeof GenPatient>;

const kv = (list: { key: string; value: string }[] | undefined) => Object.fromEntries((list ?? []).map((e) => [e.key, e.value]));

// Kleine Modelle benennen Phasen frei ("2-schock") und verweisen dann ungenau ("2-versorgt"):
// Phasen fortlaufend nummerieren und Verweise exakt oder über die führende Zahl zuordnen.
function renumber(g: GenPatient): GenPatient {
  const ids = new Map(g.phases.map((p, i) => [p.id, String(i + 1)]));
  const num = (x: string) => x.match(/^\d+/)?.[0];
  const ref = (r: string) => ids.get(r) ?? ids.get(g.phases.find((p) => num(r) !== undefined && num(p.id) === num(r))?.id ?? "") ?? r;
  const gcs = <T extends { gcs?: number }>(f: T) => (f.gcs === undefined ? f : { ...f, gcs: Math.min(15, Math.max(3, f.gcs)) });
  return {
    ...g, start: ref(g.start), base: gcs(g.base),
    phases: g.phases.map((p) => ({ ...p, id: ids.get(p.id)!, findings: gcs(p.findings), else: p.else && ref(p.else), rules: p.rules.map((r) => ({ ...r, then: ref(r.then) })) })),
  };
}

export function toPatient(g: GenPatient, id: string): unknown {
  g = renumber(g);
  return {
    id, version: 1, title: g.title, picture: g.picture,
    profile: { temperament: g.temperament, pitfall: g.pitfall, anamnesis: Object.fromEntries(g.anamnesis.map((a) => [a.topic, a.answer])), sources: g.sources },
    meta: { category: g.category, tags: g.tags, difficulty: g.difficulty },
    scoring: { critical: g.critical, harmful: g.harmful },
    base: { ...g.base, exam: kv(g.base.exam) },
    start: g.start,
    phases: Object.fromEntries(
      g.phases.map((p) => [p.id, { findings: { ...p.findings, ...(p.findings.exam ? { exam: kv(p.findings.exam) } : {}) }, rules: p.rules, else: p.else, dead: p.dead }]),
    ),
  };
}

export type Report = { ok: boolean; errors: string[]; warnings: string[]; sk: Sk | null };

// G9: automatische Prüfung eines Falls (generiert oder von Hand); Fehler sperren die Freigabe.
export function check(raw: unknown, actions: Record<string, Action>): Report {
  const parsed = Patient.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), warnings: [], sk: null };
  const p = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const used = [
    ...Object.values(p.phases).flatMap((ph) => ph.rules.flatMap((r) => [...r.when, ...r.active])),
    ...p.scoring.critical.flatMap((c) => c.actions),
    ...p.scoring.harmful,
  ];
  for (const a of new Set(used)) if (!actions[a] && a !== "handover") errors.push(`unbekannte Maßnahme: ${a}`);
  const seen = new Set([p.start]);
  for (const queue = [p.start]; queue.length; ) {
    const ph = p.phases[queue.shift()!];
    for (const next of [...ph.rules.map((r) => r.then), ...(ph.else ? [ph.else] : [])]) if (!seen.has(next)) seen.add(next), queue.push(next);
  }
  for (const id of Object.keys(p.phases)) if (!seen.has(id)) warnings.push(`Phase ${id} ist nie erreichbar`);
  if (!Object.values(p.phases).some((ph) => ph.dead || ph.left || (!ph.rules.length && !ph.else))) warnings.push("kein Endzustand (tot, abtransportiert oder stabil)");
  for (const [id, ph] of Object.entries(p.phases)) {
    const f = { ...p.base, ...ph.findings };
    if (f.rr > 70 || f.hr > 250 || f.spo2 !== undefined && f.spo2 > 100) errors.push(`Phase ${id}: Vitalwert außerhalb des möglichen Bereichs`);
    if (ph.dead && (f.hr > 0 || f.breathing)) warnings.push(`Phase ${id}: tot, aber noch Puls oder Atmung`);
  }
  const titleWords = p.title.toLowerCase().split(/[^a-zäöüß-]+/).filter((w) => w.length > 5);
  if (titleWords.some((w) => p.picture.toLowerCase().includes(w))) warnings.push("Das sichtbare Bild nennt die Diagnose");
  if (!p.scoring.critical.length) warnings.push("keine kritischen Maßnahmen angegeben");
  const sk = p.phases[p.start].dead ? "EX" : triage({ ...p.base, ...p.phases[p.start].findings, exam: {} }, "mstart");
  return { ok: errors.length === 0, errors, warnings, sk };
}

// Erfundene Maßnahmen-IDs: Regeln damit fallen weg (der Patient folgt dann seinem Verlauf ohne Behandlung),
// aus kritischen und schädlichen Listen werden sie gestrichen. Gibt die entfernten IDs zurück.
function prune(g: GenPatient, actions: Record<string, Action>): string[] {
  const removed = new Set<string>();
  const known = (a: string) => (actions[a] || a === "handover" ? true : (removed.add(a), false));
  for (const p of g.phases) p.rules = p.rules.filter((r) => [...r.when, ...r.active].every(known));
  g.critical = g.critical.map((c) => ({ ...c, actions: c.actions.filter(known) })).filter((c) => c.actions.length);
  g.harmful = g.harmful.filter(known);
  return [...removed];
}

export async function generate(ai: Ai, brief: string, actions: Record<string, Action>, example: unknown): Promise<{ raw: unknown; report: Report }> {
  const system = [
    "Du erstellst einen Übungspatienten für eine Simulation von Großschadenslagen (MANV) im deutschen Rettungsdienst.",
    "Der Patient läuft in Phasen von 15 Minuten. Jede Phase hat Befunde (nur Änderungen gegenüber der Ausgangslage), Regeln (wenn Maßnahmen erledigt bzw. gerade laufen, dann Folgephase) und eine Folgephase 'else', wenn keine Regel greift. Unbehandelt soll sich ein kritischer Patient verschlechtern; mit den richtigen Maßnahmen stabilisieren. Ohne 'else' und Regeln ist eine Phase ein Endzustand. Tote Phasen: dead=true, keine Atmung, Puls 0.",
    "Vitalwerte: rr = Atemzüge pro Minute (normal 12–20, kritisch unter 10 oder über 30, nie über 60), hr = Herzschläge pro Minute (0–200), spo2 in Prozent (50–100), gcs 3–15, recap = Rekapillarisierungszeit in Sekunden (1–6), pain 0–10.",
    "Phasen-IDs sind fortlaufende Zahlen als Text: \"1\", \"2\", \"3\" … 'start', 'then' und 'else' nennen nur IDs, die es unter 'phases' gibt.",
    "Sichtung nach mSTaRT: gehfähig = III (Gehfähige werden gegen Rot-Kriterien nachgesichtet); tödliche Verletzung = EX; keine Atmung, AF unter 10 oder über 30, spritzende Blutung, kein Radialispuls oder befolgt keine Aufforderungen = I; sonst II.",
    "Nutze in Regeln, kritischen und schädlichen Maßnahmen nur diese IDs (plus 'handover' für die Übergabe zum Abtransport):",
    ...Object.values(actions).map((a) => `- ${a.id}: ${a.title} (${a.minutes === null ? "dauerhaft" : `${a.minutes} min`})`),
    "Anamnese-Antworten schreibst du als ganze Sätze in Ich-Form, wie der Patient sie sagen würde (z. B. „Ich nehme einen Blutverdünner.“).",
    "Das sichtbare Bild beschreibt nur, was Helfer sehen, ohne Diagnose. Werte medizinisch plausibel und konservativ nach gängigen deutschen Leitlinien (S3 Polytrauma, ERC). Nenne unter 'sources' die Leitlinien oder Quellen, auf die du dich stützt; der Fall wird vor dem Einsatz von einem Praxisanleiter oder Arzt geprüft.",
    `Beispiel eines fertigen Falls im Zielformat der Bibliothek (zur Orientierung; dein Format sind Listen statt Objekte): ${JSON.stringify(example)}`,
  ].join("\n");
  const id = `ki-${crypto.randomUUID().slice(0, 6)}`;
  let user = `Fallidee: ${brief}`;
  // Ein zweiter Versuch mit dem Prüfbericht; kleine lokale Modelle verweisen z. B. gern auf fehlende Phasen.
  for (let attempt = 1; ; attempt++) {
    const g = await ai.json("generator", system, user, GenPatient, 16000);
    const removed = prune(g, actions);
    const raw = toPatient(g, id);
    const report = check(raw, actions);
    if (removed.length) report.warnings.push(`unbekannte Maßnahmen entfernt (Regeln dazu fehlen jetzt): ${removed.join(", ")}`);
    if (report.ok || attempt === 2) return { raw, report };
    user = `${user}\n\nDein letzter Entwurf hatte Fehler. Behebe sie und gib den ganzen Fall neu aus:\n${report.errors.join("\n")}\n\nLetzter Entwurf: ${JSON.stringify(g)}`;
  }
}

// Ganze Szenarien: Die KI entwirft Lage, Einsatzmittel und eine Skizze je Patient; die Patienten selbst
// entstehen danach einzeln mit generate(), damit jeder Fall dieselbe Prüfung und Freigabe durchläuft.
const KINDS = ["RTW", "NEF", "KTW"] as const;
// Grenzen an Listen und Texten: lokale Modelle wiederholen sich sonst, bis das Token-Limit das JSON abschneidet.
const GenFrame = z.object({
  title: z.string().max(120),
  situation: z.string().max(800),
  units: z.array(z.object({ kind: z.enum(KINDS), arrivesAt: z.number() })).max(10),
  patients: z.array(z.object({ brief: z.string().max(700) })).max(15),
});

export async function generateFrame(ai: Ai, brief: string, count: number, template: Scenario): Promise<{ scenario: Scenario & { situation: string }; briefs: string[] }> {
  const system = [
    "Du entwirfst eine Übungslage für eine Simulation von Großschadenslagen (MANV) im deutschen Rettungsdienst.",
    `Liefere einen Titel, die Lage in zwei bis drei Sätzen, die anrückenden Einsatzmittel (RTW, NEF, KTW mit Eintreffzeit in Minuten nach Übungsstart, mindestens eines bei 0) und genau ${count} Patienten.`,
    "Jeder Patient ist eine Skizze in zwei bis vier Sätzen: Alter, Geschlecht, was Helfer sehen, Verletzung oder Erkrankung, Verlauf ohne Behandlung, Soll-Sichtungskategorie nach mSTaRT und Temperament.",
    "Mische die Sichtungskategorien realistisch (meist viele Leichtverletzte, wenige Schwerstverletzte) und baue mindestens eine Falle ein, z. B. eine Untertriage-Gefahr. Keine Patienten doppelt.",
  ].join("\n");
  const g = await ai.json("generator", system, `Szenario-Idee: ${brief}`, GenFrame, 4000);
  // Kleine Modelle liefern oft weniger Patienten als bestellt: bis zu zweimal nachfordern.
  for (let i = 0; i < 2 && g.patients.length < count; i++) {
    const more = await ai.json("generator", system, `Szenario-Idee: ${brief}\nLage: ${g.situation}\nBisherige Patienten:\n${g.patients.map((p) => `- ${p.brief}`).join("\n")}\n\nGib ${count - g.patients.length} weitere, andere Patienten aus (Titel, Lage und Einsatzmittel wie oben).`, GenFrame, 4000);
    g.patients.push(...more.patients);
  }
  const like = (kind: string) => template.units.find((u) => u.title.startsWith(kind)) ?? template.units[0];
  const n: Record<string, number> = {};
  const units = (g.units.length ? g.units : template.units.map((u) => ({ kind: u.title.slice(0, 3) as (typeof KINDS)[number], arrivesAt: u.arrivesAt })))
    .map((u) => {
      n[u.kind] = (n[u.kind] ?? 0) + 1;
      const base = like(u.kind);
      return { id: `${u.kind.toLowerCase()}${n[u.kind]}`, title: `${u.kind} ${n[u.kind]}`, arrivesAt: Math.min(60, Math.max(0, Math.round(u.arrivesAt))), seats: base.seats, inventory: { ...base.inventory } };
    })
    .sort((a, b) => a.arrivesAt - b.arrivesAt);
  units[0].arrivesAt = 0;
  const scenario = { id: `ki-s${crypto.randomUUID().slice(0, 5)}`, title: g.title, situation: g.situation, patients: [], units };
  return { scenario, briefs: g.patients.slice(0, count).map((p) => `Lage: ${g.situation}\nPatient: ${p.brief}`) };
}
