// Szenarioformat: Patientenverläufe, Maßnahmenkatalog, Szenarien.
// Alles, was von außen kommt (Bibliothek, KI-Entwürfe), läuft durch diese Schemas.
import { z } from "zod";

export const Sk = z.enum(["I", "II", "III", "IV", "EX"]);
export const Algorithm = z.enum(["mstart", "prior", "asav"]);

const findingFields = {
  walking: z.boolean(),
  lethalInjury: z.boolean(),
  breathing: z.boolean(),
  rr: z.number().min(0), // Atemfrequenz /min
  spo2: z.number().min(0).max(100),
  hr: z.number().min(0),
  bp: z.string(), // "115/90" oder "60 palp."
  radialPulse: z.boolean(),
  recap: z.number().min(0), // Rekapillarisierung in s
  gcs: z.number().int().min(3).max(15),
  followsCommands: z.boolean(),
  spurtingBleeding: z.boolean(),
  stridor: z.boolean(),
  pain: z.number().int().min(0).max(10),
  temp: z.number(),
  exam: z.record(z.string(), z.string()), // erweiterte Befunde, z. B. auscultation
};

// Basisbefunde eines Patienten: Pflichtfelder für die Sichtung, Rest optional.
export const Findings = z.object({
  ...findingFields,
  lethalInjury: findingFields.lethalInjury.default(false),
  spurtingBleeding: findingFields.spurtingBleeding.default(false),
  stridor: findingFields.stridor.default(false),
  spo2: findingFields.spo2.optional(),
  bp: findingFields.bp.optional(),
  recap: findingFields.recap.optional(),
  pain: findingFields.pain.optional(),
  temp: findingFields.temp.optional(),
  exam: findingFields.exam.default({}),
});

export const Rule = z.object({
  when: z.array(z.string()).default([]), // Maßnahmen abgeschlossen
  active: z.array(z.string()).default([]), // Maßnahmen laufen gerade
  then: z.string(),
});

export const Phase = z.object({
  minutes: z.number().positive().optional(), // sonst Phasendauer aus den Übungseinstellungen
  findings: z.object(findingFields).partial().default({}), // überschreibt die Basisbefunde
  rules: z.array(Rule).default([]), // erste passende Regel gewinnt
  else: z.string().optional(), // keine Regel passt; fehlt beides, ist die Phase ein Endzustand
  dead: z.boolean().default(false),
  left: z.boolean().default(false), // abtransportiert
});

export const Patient = z
  .object({
    id: z.string(),
    version: z.number().int().positive(),
    title: z.string(),
    picture: z.string(), // sichtbares Bild auf dem QR-Zettel
    profile: z.record(z.string(), z.unknown()).default({}), // Gesprächsprofil für den KI-Dialog (M5)
    base: Findings,
    start: z.string(),
    phases: z.record(z.string(), Phase),
  })
  .superRefine((p, ctx) => {
    const has = (id: string) => id in p.phases;
    if (!has(p.start)) ctx.addIssue({ code: "custom", message: `Startphase ${p.start} fehlt`, path: ["start"] });
    for (const [id, ph] of Object.entries(p.phases)) {
      const targets = [...ph.rules.map((r) => r.then), ...(ph.else ? [ph.else] : [])];
      for (const t of targets)
        if (!has(t)) ctx.addIssue({ code: "custom", message: `Phase ${id} verweist auf fehlende Phase ${t}`, path: ["phases", id] });
    }
  });

export const Action = z.object({
  id: z.string(),
  title: z.string(),
  minutes: z.number().positive().nullable(), // null = dauerhaft, bis der Helfer sie beendet
  material: z.record(z.string(), z.number().int().positive()).default({}),
  reveals: z.array(z.string()).default([]), // Befunde, die erst diese Maßnahme zeigt, z. B. "bp", "exam.pelvis"
  failChance: z.number().min(0).max(1).default(0), // nur mit Zufallselementen
});

export const Scenario = z.object({
  id: z.string(),
  title: z.string(),
  patients: z.array(z.string()).min(1),
  units: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        arrivesAt: z.number().min(0), // Minuten nach Übungsstart
        inventory: z.record(z.string(), z.number().int().min(0)),
      }),
    )
    .min(1),
});

export type Sk = z.infer<typeof Sk>;
export type Algorithm = z.infer<typeof Algorithm>;
export type Findings = z.infer<typeof Findings>;
export type Phase = z.infer<typeof Phase>;
export type Patient = z.infer<typeof Patient>;
export type Action = z.infer<typeof Action>;
export type Scenario = z.infer<typeof Scenario>;
