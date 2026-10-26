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

// Untersuchungsbefunde nur unter den Schlüsseln, die eine Maßnahme aufdeckt; sonst stünden sie ohne Untersuchung offen da
// und "Lunge abhören" zeigte nichts. Modelle erfinden gern eigene Schlüssel (lung, Lunge, chest, Becken …).
const EXAM_ALIAS: Record<string, string> = {
  lung: "auscultation", lungs: "auscultation", lunge: "auscultation", auskultation: "auscultation", perkussion: "percussion",
  pupil: "pupils", pupillen: "pupils", becken: "pelvis", bauch: "abdomen", ekg: "ecg", monitor: "ecg", blutzucker: "glucose", bz: "glucose", co: "spco",
  body: "bodycheck", body_check: "bodycheck", injuries: "bodycheck", chest: "bodycheck", thorax: "bodycheck", spine: "bodycheck", leg: "bodycheck",
  wrist: "bodycheck", shoulder: "bodycheck", "unterschenkel rechts": "bodycheck", "dms rechter fuß": "bodycheck",
  "auskultation lunge": "auscultation", "auskultation herz": "auscultation", rumpf: "bodycheck", unterschenkel: "bodycheck",
  "visuelle inspektion": "bodycheck", verbrennung: "burn", verbrennungen: "burn",
};
// Messnotizen, die schon ein Messwert abbildet, und Hinweise, die die Lösung verraten
const EXAM_DROP = new Set(["pulse_oximetry", "pulse_oximetry_note", "spo2_note", "spo2_hinweis", "zustand", "transport", "herzerkrankung"]);
const TEMP = new Set(["temp", "temperature", "temperatur"]);
const EXAM_KEYS = new Set(["auscultation", "percussion", "pupils", "pelvis", "abdomen", "burn", "airway", "bodycheck", "glucose", "ecg", "spco", "befast", "death", "motor"]);
export function tidyExam<F extends { exam?: Record<string, string>; temp?: number }>(f: F): F {
  if (!f.exam) return f;
  const exam: Record<string, string> = {};
  let temp = f.temp;
  for (const [key, value] of Object.entries(f.exam)) {
    const k = key.trim().toLowerCase();
    if (EXAM_DROP.has(k) || !value.trim() || k.length > 40) continue; // ganze Sätze als Schlüssel oder leere Notizen: Ausgabefehler kleiner Modelle
    if (TEMP.has(k)) { temp ??= Number(value.replace(",", ".").match(/\d+(\.\d+)?/)?.[0]) || undefined; continue; } // wird erst mit "Temperatur messen" sichtbar
    const to = EXAM_ALIAS[k] ?? (EXAM_KEYS.has(k) ? k : key);
    exam[to] = exam[to] ? `${exam[to]}; ${value}` : value;
  }
  return { ...f, exam, ...(temp !== undefined ? { temp } : {}) };
}

// Kleine Modelle benennen Phasen frei ("2-schock") und verweisen dann ungenau ("2-versorgt"):
// Phasen fortlaufend nummerieren und Verweise exakt oder über die führende Zahl zuordnen.
// Was sich gar nicht zuordnen lässt, fällt weg (Regel ohne Ziel, Phase endet dort), statt den ganzen Fall scheitern zu lassen.
export function renumber(g: GenPatient): GenPatient & { dropped: number } {
  const ids = new Map(g.phases.map((p, i) => [p.id, String(i + 1)]));
  const num = (x: string) => x.match(/^\D*(\d+)/)?.[1];
  const ref = (r: string): string | undefined => {
    const n = num(r);
    return ids.get(r) ?? ids.get(g.phases.find((p) => n !== undefined && num(p.id) === n)?.id ?? "") ?? (n && Number(n) >= 1 && Number(n) <= g.phases.length ? n : undefined);
  };
  const gcs = <T extends { gcs?: number }>(f: T) => (f.gcs === undefined ? f : { ...f, gcs: Math.min(15, Math.max(3, f.gcs)) });
  let dropped = 0;
  const phases = g.phases.map((p) => {
    const rules = p.rules.flatMap((r) => { const then = ref(r.then); return then ? [{ ...r, then }] : (dropped++, []); });
    const next = p.else === undefined ? undefined : ref(p.else);
    if (p.else !== undefined && !next) dropped++;
    return { ...p, id: ids.get(p.id)!, findings: gcs(p.findings), else: next, rules };
  });
  return { ...g, start: ref(g.start) ?? "1", base: gcs(g.base), phases, dropped };
}

// Kleine Modelle halten "lethalInjury" für "schwer verletzt"; mSTaRT sichtet dann EX, obwohl der Patient lebt.
// Nur wer in der Phase tot ist, hat eine mit dem Leben nicht vereinbare Verletzung.
function lethalOnlyWhenDead(g: GenPatient): boolean {
  let changed = false;
  const startDead = !!g.phases.find((p) => p.id === g.start)?.dead;
  if (g.base.lethalInjury !== startDead) (g.base.lethalInjury = startDead), (changed = true);
  for (const p of g.phases) if (p.findings.lethalInjury !== undefined && p.findings.lethalInjury !== p.dead) (p.findings.lethalInjury = p.dead), (changed = true);
  return changed;
}
// Der Bildtext beschreibt die eine Person, nicht die Szene: er beginnt mit Geschlecht oder Alter.
export const describesPerson = (picture: string) =>
  /^(ein |eine )?(junger |junge |älterer |ältere |alter |alte |kleiner |kleines |kleine )?(mann|frau|junge|mädchen|kind|jugendliche[rn]?|teenager|säugling|baby|kleinkind|person|seniorin|senior|patient(in)?|schwangere|ca\.|etwa|\d)/i.test(picture.trim());

export function toPatient(g: GenPatient, id: string): unknown {
  g = renumber(g);
  return {
    id, version: 1, title: g.title, picture: g.picture,
    profile: { temperament: g.temperament, pitfall: g.pitfall, anamnesis: Object.fromEntries(g.anamnesis.map((a) => [a.topic, a.answer])), sources: g.sources },
    meta: { category: g.category, tags: g.tags, difficulty: g.difficulty },
    scoring: { critical: g.critical, harmful: g.harmful },
    base: tidyExam({ ...g.base, exam: kv(g.base.exam) }),
    start: g.start,
    phases: Object.fromEntries(
      g.phases.map(({ findings: { exam, ...rest }, ...p }) => [p.id, { findings: tidyExam({ ...rest, ...(exam ? { exam: kv(exam) } : {}) }), rules: p.rules, else: p.else, dead: p.dead }]),
    ),
  };
}

export type Report = { ok: boolean; errors: string[]; warnings: string[]; sk: Sk | null };

// G9: automatische Prüfung eines Falls (generiert oder von Hand); Fehler sperren die Freigabe.
// Was man sieht, ist keine Diagnose: Seiten, Körperstellen und sichtbare Befunde zählen nicht als verratene Diagnose.
const VISIBLE = /^(rechts|recht(e|er|en)|links|link(e|er|en)|beid(e|en|seits)|offen(e|er|en)?|klein(e|er|en)|gro(ß|ss)(e|er|en)|blutung|blutend(e|er)?|wunde[n]?|(ober|unter)(arm|schenkel)|schulter|handgelenk|knöchel|leiste|gesicht|brustkorb|thorax|abdomen|bauch|becken|rücken|kopfplatzwunde|schürfwunde[n]?|prellung(en)?|verbrennung(en)?|verbrühung)$/;

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
  const titleWords = p.title.toLowerCase().split(/[^a-zäöüß-]+/).filter((w) => w.length > 5 && !VISIBLE.test(w));
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

export async function generate(ai: Ai, brief: string, actions: Record<string, Action>, example: unknown, target?: Sk, audience: Audience = "rs"): Promise<{ raw: unknown; report: Report }> {
  const system = [
    "Du erstellst einen Übungspatienten für eine Simulation von Großschadenslagen (MANV) im deutschen Rettungsdienst.",
    "Der Patient läuft in Phasen von 15 Minuten. Jede Phase hat Befunde (nur Änderungen gegenüber der Ausgangslage), Regeln (wenn Maßnahmen erledigt bzw. gerade laufen, dann Folgephase) und eine Folgephase 'else', wenn keine Regel greift. Unbehandelt soll sich ein kritischer Patient verschlechtern; mit den richtigen Maßnahmen stabilisieren. Ohne 'else' und Regeln ist eine Phase ein Endzustand. Tote Phasen: dead=true, keine Atmung, Puls 0.",
    "Vitalwerte: rr = Atemzüge pro Minute (normal 12–20, kritisch unter 10 oder über 30, nie über 60), hr = Herzschläge pro Minute (0–200), spo2 in Prozent (50–100), gcs 3–15, recap = Rekapillarisierungszeit in Sekunden (1–6), pain 0–10.",
    "Untersuchungsbefunde in exam nur unter diesen Schlüsseln, sie werden erst durch die passende Maßnahme sichtbar: auscultation (Lunge abhören), percussion, pupils, pelvis, abdomen, burn, airway, bodycheck (Verletzungen am Körper), glucose, ecg, spco (CO-Messung), befast (Schlaganfall-Test), death (Todeszeichen). Was man ohne Untersuchung sieht (Haut, Verhalten, Geruch), unter kurzen deutschen Schlüsseln; Körpertemperatur als Zahl im Feld temp.",
    "Ein EKG-Befund gehört in exam unter dem Schlüssel 'ecg'. Der Monitor kennt: Sinusrhythmus, Sinustachykardie, Sinusbradykardie, Vorhofflimmern, Vorhofflattern, AV-Block I, AV-Block II Typ Wenckebach, AV-Block II Typ Mobitz II, AV-Block III, Kammertachykardie, Kammerflimmern, STEMI (ST-Hebung), ST-Senkung, VES, Asystolie. Ohne Angabe gilt ein Sinusrhythmus passend zur Herzfrequenz; Blutzucker unter 'glucose' (z. B. \"45 mg/dl\"), sonst normal.",
    "Phasen-IDs sind fortlaufende Zahlen als Text: \"1\", \"2\", \"3\" … 'start', 'then' und 'else' nennen nur IDs, die es unter 'phases' gibt.",
    "Sichtung nach mSTaRT: gehfähig = III (Gehfähige werden gegen Rot-Kriterien nachgesichtet); tödliche Verletzung = EX; keine Atmung, AF unter 10 oder über 30, spritzende Blutung, kein Radialispuls oder befolgt keine Aufforderungen = I; sonst II.",
    "Nutze in Regeln, kritischen und schädlichen Maßnahmen nur diese IDs (plus 'handover' für die Übergabe zum Abtransport):",
    ...Object.values(actions).map((a) => `- ${a.id}: ${a.title} (${a.minutes === null ? "dauerhaft" : `${a.minutes} min`})`),
    "Anamnese-Antworten schreibst du als ganze Sätze in Ich-Form, wie der Patient sie sagen würde (z. B. „Ich nehme einen Blutverdünner.“).",
    AUDIENCES[audience].prompt,
    "Titel: kurz das Verletzungs- oder Krankheitsbild (z. B. „Offene Unterschenkelfraktur mit Schock“), ohne Personennamen und ohne Ort.",
    "Das sichtbare Bild beschreibt nur diese eine Person, wie Helfer sie vorfinden: beginne mit Geschlecht und geschätztem Alter (z. B. „Junge, ca. 14 Jahre, liegt …“), dann Haltung, sichtbare Verletzungen, Verhalten und was sie sagt. Keine Fahrzeuge, keine Unfallszene, keine anderen Personen, keine Diagnose.",
    "lethalInjury (mit dem Leben nicht vereinbare Verletzung) ist nur bei toten Patienten wahr; schwer Verletzte, die atmen, haben lethalInjury=false.",
    "Das sichtbare Bild beschreibt nur, was Helfer sehen, ohne Diagnose. Werte medizinisch plausibel und konservativ nach gängigen deutschen Leitlinien (S3 Polytrauma, ERC). Nenne unter 'sources' die Leitlinien oder Quellen, auf die du dich stützt; der Fall wird vor dem Einsatz von einem Praxisanleiter oder Arzt geprüft.",
    `Beispiel eines fertigen Falls im Zielformat der Bibliothek (zur Orientierung; dein Format sind Listen statt Objekte): ${JSON.stringify(example)}`,
  ].join("\n");
  const id = `ki-${crypto.randomUUID().slice(0, 6)}`;
  let user = `Fallidee: ${brief}`;
  // Ein zweiter Versuch mit dem Prüfbericht; kleine lokale Modelle verweisen z. B. gern auf fehlende Phasen.
  for (let attempt = 1; ; attempt++) {
    const g = await ai.json("generator", system, user, GenPatient, 16000);
    const removed = prune(g, actions);
    const lethalFixed = lethalOnlyWhenDead(g);
    const outOfScope = withinAudience(g, audience);
    const dropped = renumber(g).dropped;
    const raw = toPatient(g, id);
    const report = check(raw, actions);
    if (dropped) report.warnings.push(`${dropped} Verweis(e) auf fehlende Phasen entfernt`);
    if (removed.length) report.warnings.push(`unbekannte Maßnahmen entfernt (Regeln dazu fehlen jetzt): ${removed.join(", ")}`);
    if (lethalFixed) report.warnings.push("„tödliche Verletzung“ bei lebendem Patienten entfernt");
    if (outOfScope) report.warnings.push(`kritische Maßnahmen außerhalb des Rahmens ${AUDIENCES[audience].label} entfernt`);
    const scene = !describesPerson(g.picture);
    if (scene) report.warnings.push("Bildtext beschreibt nicht die Person (sollte mit Geschlecht oder Alter beginnen)");
    const offTarget = target && report.sk && report.sk !== target;
    if (offTarget) report.warnings.push(`Sichtung zu Beginn ${report.sk} statt gewünscht ${target}`);
    if ((report.ok && !scene && !offTarget) || attempt === 2) return { raw, report };
    const problems = [...report.errors, ...(scene ? ["Das sichtbare Bild beschreibt die Szene statt der Person. Beginne mit Geschlecht und Alter und beschreibe nur diese eine Person."] : []),
      ...(offTarget ? [`Der Patient soll zu Beginn nach mSTaRT Kategorie ${target} sein, ist nach deinen Ausgangswerten aber ${report.sk}. Passe Ausgangswerte und Startphase an (${SK_HINT[target]}).`] : [])];
    user = `${user}\n\nDein letzter Entwurf hatte Fehler. Behebe sie und gib den ganzen Fall neu aus:\n${problems.join("\n")}\n\nLetzter Entwurf: ${JSON.stringify(g)}`;
  }
}

// Ganze Szenarien: Die KI entwirft Lage, Einsatzmittel und eine Skizze je Patient; die Patienten selbst
// entstehen danach einzeln mit generate(), damit jeder Fall dieselbe Prüfung und Freigabe durchläuft.
export const KINDS = ["RTW", "NEF", "KTW"] as const;
export type Kind = (typeof KINDS)[number];

// Fahrzeuge nach Typ mit Beladung und Plätzen aus der Vorlage (z. B. Busunfall); eines trifft bei 0 min ein.
export function buildUnits(list: { kind: Kind; arrivesAt: number }[], template: Scenario): Scenario["units"] {
  const like = (kind: string) => template.units.find((u) => u.title.startsWith(kind)) ?? template.units[0];
  const n: Record<string, number> = {};
  const units = list
    .map((u) => {
      n[u.kind] = (n[u.kind] ?? 0) + 1;
      const base = like(u.kind);
      return { id: `${u.kind.toLowerCase()}${n[u.kind]}`, title: `${u.kind} ${n[u.kind]}`, arrivesAt: Math.min(60, Math.max(0, Math.round(u.arrivesAt))), seats: base.seats, inventory: { ...base.inventory } };
    })
    .sort((a, b) => a.arrivesAt - b.arrivesAt);
  if (units.length) units[0].arrivesAt = 0;
  return units;
}
// Grenzen an Listen und Texten: lokale Modelle wiederholen sich sonst, bis das Token-Limit das JSON abschneidet.
const GenFrame = z.object({
  title: z.string().max(120),
  situation: z.string().max(800),
  units: z.array(z.object({ kind: z.enum(KINDS), arrivesAt: z.number() })).max(10),
  patients: z.array(z.object({ sk: z.enum(["I", "II", "III", "EX"]), brief: z.string().max(700) })).max(15),
});
// Wie ein Patient zu Beginn aussehen muss, damit mSTaRT die gewünschte Kategorie ergibt.
export const SK_HINT: Record<Sk, string> = {
  I: "rot: z. B. spritzende Blutung, Atemfrequenz unter 10 oder über 30, kein Radialispuls oder befolgt keine Aufforderungen",
  II: "gelb: nicht gehfähig, aber atmet normal, Radialispuls tastbar, befolgt Aufforderungen, keine spritzende Blutung",
  III: "grün: gehfähig, leicht verletzt",
  IV: "blau: abwartende Behandlung",
  EX: "tot: Startphase dead=true, keine Atmung, Puls 0, lethalInjury=true",
};
export type Mix = Partial<Record<"I" | "II" | "III" | "EX", number>>;

// Zielgruppe des generierten Falls: bestimmt Komplexität, Fallen und welche Maßnahmen als kritisch gelten dürfen.
const SANH_ACTIONS = ["airway_open", "airway_hold", "recovery_position", "oxygen", "bag_rebreathing", "tourniquet", "pressure_dressing", "shock_position", "upper_body_up",
  "wound_dressing", "burn_dressing", "cool_large", "rinse", "warm", "calm", "cpr", "measure_bp", "pulse_oximetry", "blood_glucose", "body_check", "check_pupils",
  "examine_pelvis", "examine_abdomen", "inspect_burn", "auscultate", "measure_temp", "handover"];
const RS_ACTIONS = [...SANH_ACTIONS, "wendl", "bag_valve", "chest_seal", "pelvic_binder", "splint", "cervical_collar", "vacuum_mattress", "glucose", "ecg"];
export const AUDIENCES = {
  sanh: { label: "Sanitätshelfer (SanH)", difficulty: "einsteiger", critical: SANH_ACTIONS,
    prompt: "Zielgruppe Sanitätshelfer (SanH): eindeutige Verletzungsbilder mit deutlichen Leitsymptomen, wenig Fallen, Verlauf eher langsam; kritisch sind nur Basismaßnahmen (Atemweg, Lagerung, Blutstillung, Wärmeerhalt, Betreuung, Reanimation)." },
  rs: { label: "Rettungssanitäter (RS)", difficulty: "fortgeschritten", critical: RS_ACTIONS,
    prompt: "Zielgruppe Rettungssanitäter (RS): typische Notfallbilder, eine Falle je Fall (z. B. Schmerz verdeckt Verletzung), kritisch sind Basismaßnahmen plus Immobilisation, Beckengurt, Beatmung mit Beutel und Chest Seal." },
  notsan: { label: "Notfallsanitäter (NotSan)", difficulty: "experte", critical: null,
    prompt: "Zielgruppe Notfallsanitäter (NotSan): komplexe Verläufe, versteckte Befunde (innere Blutung, Spannungspneumothorax, Hypoglykämie hinter Verwirrtheit), Untertriage-Fallen, schneller Verfall; kritisch dürfen auch invasive Maßnahmen sein (Zugang, Infusion, Analgesie, Entlastungspunktion, Wundtamponade)." },
} as const;
export type Audience = keyof typeof AUDIENCES;
// Kritische Maßnahmen außerhalb des Kompetenzrahmens der Zielgruppe streichen; gibt zurück, ob etwas wegfiel.
function withinAudience(g: GenPatient, audience: Audience): boolean {
  const allowed = AUDIENCES[audience].critical as readonly string[] | null;
  g.difficulty = AUDIENCES[audience].difficulty;
  if (!allowed) return false;
  const before = JSON.stringify(g.critical);
  g.critical = g.critical.map((c) => ({ ...c, actions: c.actions.filter((a) => allowed.includes(a)) })).filter((c) => c.actions.length);
  return JSON.stringify(g.critical) !== before;
}
export const mixTotal = (m: Mix) => Object.values(m).reduce((a, b) => a + (b ?? 0), 0);

// mix: gewünschte Zahl Patienten je Sichtungskategorie zu Beginn; jeder Patient bekommt seine Kategorie als Vorgabe mit.
export async function generateFrame(ai: Ai, brief: string, mix: Mix, template: Scenario, id = `ki-s${crypto.randomUUID().slice(0, 5)}`, audience: Audience = "rs"): Promise<{ scenario: Scenario & { situation: string }; briefs: { brief: string; sk: Sk }[] }> {
  const count = mixTotal(mix);
  const wanted = (["I", "II", "III", "EX"] as const).filter((k) => mix[k]).map((k) => `${mix[k]}× Kategorie ${k} (${SK_HINT[k]})`).join(", ");
  const system = [
    "Du entwirfst eine Übungslage für eine Simulation von Großschadenslagen (MANV) im deutschen Rettungsdienst.",
    `Liefere einen Titel, die Lage in zwei bis drei Sätzen, die anrückenden Einsatzmittel (RTW, NEF, KTW mit Eintreffzeit in Minuten nach Übungsstart, mindestens eines bei 0) und genau ${count} Patienten.`,
    `Sichtungskategorien zu Beginn nach mSTaRT, genau so verteilt: ${wanted}. Gib bei jedem Patienten die Kategorie im Feld sk an.`,
    "Jeder Patient ist eine Skizze in zwei bis vier Sätzen: Alter, Geschlecht, was Helfer sehen, Verletzung oder Erkrankung, Verlauf ohne Behandlung und Temperament.",
    AUDIENCES[audience].prompt,
    "Keine Patienten doppelt.",
  ].join("\n");
  const g = await ai.json("generator", system, `Szenario-Idee: ${brief}`, GenFrame, 4000);
  // Je Kategorie so viele Skizzen wie bestellt; kleine Modelle liefern oft zu wenige oder falsch verteilt: bis zu zweimal nachfordern.
  const pick = () => (["I", "II", "III", "EX"] as const).flatMap((k) => g.patients.filter((p) => p.sk === k).slice(0, mix[k] ?? 0));
  for (let i = 0; i < 2 && pick().length < count; i++) {
    const missing = (["I", "II", "III", "EX"] as const).map((k) => [k, (mix[k] ?? 0) - g.patients.filter((p) => p.sk === k).length] as const).filter(([, n]) => n > 0);
    const more = await ai.json("generator", system, `Szenario-Idee: ${brief}\nLage: ${g.situation}\nBisherige Patienten:\n${g.patients.map((p) => `- (${p.sk}) ${p.brief}`).join("\n")}\n\nGib weitere, andere Patienten aus: ${missing.map(([k, n]) => `${n}× Kategorie ${k}`).join(", ")} (Titel, Lage und Einsatzmittel wie oben).`, GenFrame, 4000);
    g.patients.push(...more.patients);
  }
  const units = buildUnits(g.units.length ? g.units : template.units.map((u) => ({ kind: u.title.slice(0, 3) as Kind, arrivesAt: u.arrivesAt })), template);
  const scenario = { id, title: g.title, situation: g.situation, patients: [], units };
  return { scenario, briefs: pick().map((p) => ({ sk: p.sk, brief: `Lage: ${g.situation}\nPatient: ${p.brief}\nSichtungskategorie zu Beginn nach mSTaRT: ${p.sk} (${SK_HINT[p.sk]})` })) };
}
