// Golden-Tests: Die 10 Musterverläufe aus der Anforderungsanalyse (Tab "Patientenverläufe") sind die Testfälle.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Action, Patient, Scenario, type Sk } from "@dps/schema";
import { apply, defaultSettings, describe, ecgOf, initial, liveFindings, targetSk, tick, validate, visible, type Event, type Settings, type State } from "../src/index.ts";

const lib = new URL("../../../library/", import.meta.url);
const read = (p: string) => JSON.parse(readFileSync(new URL(p, lib), "utf8"));
const actions = Object.fromEntries(Action.array().parse(read("actions.json")).map((a) => [a.id, a]));
const patients = Object.fromEntries(
  readdirSync(new URL("patients/", lib)).map((f) => {
    const p = Patient.parse(read(`patients/${f}`));
    return [p.id, p];
  }),
);
const scenario = Scenario.parse(read("scenarios/busunfall.json"));
const defs = { patients, actions };

const scan = (t: number, patient: string, participant = "h1"): Event => ({ t, type: "scan", participant, patient });
const act = (t: number, patient: string, action: string, participant = "h1"): Event => ({ t, type: "start", participant, patient, action });
const end = (t: number, participant = "h1"): Event => ({ t, type: "end", participant });
const join = (t: number, participant: string, unit: string): Event => ({ t, type: "join", participant, unit });
const handover = (t: number, patient: string, vehicle: string, participant = "h1"): Event =>
  ({ t, type: "handover", participant, patient, vehicle, destination: "Klinikum", diagnosis: "Verdacht" });

// Spielt ein Skript wie der Server: erst fällige Ereignisse, dann prüfen, dann anwenden.
function run(script: Event[], until: number, settings: Partial<Settings> = {}, seed = 1) {
  const s = initial(scenario, defs, { ...defaultSettings, ...settings }, seed);
  const log: Event[] = [];
  for (const e of [join(0, "h1", "rtw1"), join(0, "h2", "nef1"), ...script]) {
    log.push(...tick(s, e.t));
    assert.equal(validate(s, e), null, `abgelehnt: ${JSON.stringify(e)}`);
    log.push(e);
    apply(s, e);
  }
  log.push(...tick(s, until));
  return { s, log, seed, settings: { ...defaultSettings, ...settings } };
}
const phaseOf = (s: State, id: string) => s.patients[id].phase;

test("Bibliothek: alle Regeln nutzen bekannte Maßnahmen, Szenario kennt alle Patienten", () => {
  for (const p of Object.values(patients)) {
    for (const ph of Object.values(p.phases))
      for (const r of ph.rules) for (const a of [...r.when, ...r.active]) assert.ok(actions[a], `${p.id}: Maßnahme ${a} fehlt`);
    for (const a of [...p.scoring.critical.flatMap((c) => c.actions), ...p.scoring.harmful])
      assert.ok(actions[a] || a === "handover", `${p.id}: Auswertung nennt unbekannte Maßnahme ${a}`);
  }
  for (const id of scenario.patients) assert.ok(patients[id], `Szenario: ${id} fehlt`);
});

test("Schema lehnt Verweise auf fehlende Phasen ab", () => {
  const bad = { ...read("patients/p10.json"), phases: { "1": { else: "gibt-es-nicht" } } };
  assert.equal(Patient.safeParse(bad).success, false);
});

test("Soll-SK nach mSTaRT stimmt mit den Verlaufstabellen überein", () => {
  const expected: Record<string, Record<string, Sk>> = {
    p01: { "1": "I", "4-tot": "EX" },
    p02: { "1": "I", "2": "I", "3": "I" },
    p03: { "1": "I" },
    p04: { "1": "II", "2": "II", "3": "I" },
    p05: { "1": "I" },
    p06: { "1": "III", "2": "I" },
    p07: { "1": "II", "2": "II", "3": "II", "4": "II" },
    p08: { "1": "III", "2": "III", "3": "II", "4": "I" },
    p09: { "1": "III" },
    p10: { "1": "EX" },
    p11: { "1": "III", "2": "II", "3": "EX" }, // gehfähig: die Falle zeigt erst das EKG
    p12: { "1": "I", "2": "I", "versorgt": "II" },
    p13: { "1": "II", "2": "I", "stimuliert": "II", "3": "EX" },
  };
  const s = initial(scenario, defs);
  for (const [id, phases] of Object.entries(expected))
    for (const [phase, sk] of Object.entries(phases)) {
      s.patients[id].phase = phase;
      assert.equal(targetSk(s, id), sk, `${id} Phase ${phase}`);
    }
});

test("PRIOR und ASAV liefern eigene Soll-SK aus denselben Befunden", () => {
  const sk = (algorithm: Settings["algorithm"], id: string) => targetSk(initial(scenario, defs, { ...defaultSettings, algorithm }), id);
  assert.equal(sk("prior", "p07"), "I"); // starke Schmerzen: PRIOR sichtet höher
  assert.equal(sk("asav", "p07"), "II");
  assert.equal(sk("asav", "p06"), "III");
});

const paths: [string, Event[], number, Record<string, string>][] = [
  ["unbehandelt", [], 60, { p01: "4-tot", p02: "4-tot", p03: "4-tot", p04: "tot", p05: "tot", p06: "4", p07: "4", p08: "4", p09: "1", p10: "1" }],
  ["P01 Tourniquet, Volumen, Analgesie", [scan(0, "p01"), act(0.5, "p01", "tourniquet"), act(2, "p01", "iv_access"), act(5, "p01", "fluids"), act(50, "p01", "analgesia")], 60, { p01: "4-analgesie" }],
  ["P01 Tourniquet erst in Phase 2", [scan(0, "p01"), act(20, "p01", "tourniquet")], 60, { p01: "2-schock-gestillt" }],
  ["P02 Auskultation und Entlastung", [scan(0, "p02"), act(1, "p02", "auscultate"), act(3, "p02", "needle_decompression")], 60, { p02: "3-entlastet" }],
  ["P03 Atemweg, O2, Intubation durch NEF", [scan(0, "p03"), act(0.5, "p03", "airway_open"), act(1, "p03", "oxygen"), scan(11, "p03", "h2"), act(11, "p03", "intubation", "h2")], 60, { p03: "intubiert" }],
  ["P04 Beckengurt, Volumen, Transport", [scan(0, "p04"), act(0.5, "p04", "examine_pelvis"), act(1, "p04", "pelvic_binder"), act(4, "p04", "iv_access"), act(7, "p04", "fluids"), handover(20, "p04", "rtw1")], 60, { p04: "2-versorgt" }],
  ["P04 Beckengurt ohne Transport bremst nur", [scan(0, "p04"), act(1, "p04", "pelvic_binder"), act(4, "p04", "iv_access"), act(7, "p04", "fluids")], 60, { p04: "4" }],
  ["P05 Atemweg frei, aber nicht gehalten", [scan(0, "p05"), act(1, "p05", "airway_open")], 60, { p05: "tot" }],
  ["P05 Atemweg dauerhaft gehalten", [scan(0, "p05"), act(1, "p05", "airway_open"), act(2, "p05", "airway_hold")], 45, { p05: "3" }],
  ["P05 Halten beendet: erneute Verlegung", [scan(0, "p05"), act(1, "p05", "airway_open"), act(2, "p05", "airway_hold"), end(40)], 54, { p05: "1-wieder" }],
  ["P05 Wendl-Tubus", [scan(0, "p05"), act(1, "p05", "airway_open"), act(2, "p05", "wendl")], 60, { p05: "3" }],
  ["P11 unbehandelt: Kammerflimmern", [], 45, { p11: "3" }],
  ["P11 EKG erkennt den Infarkt, Übergabe", [scan(0, "p11"), act(1, "p11", "ecg"), handover(20, "p11", "rtw1")], 60, { p11: "2-erkannt" }],
  ["P11 EKG erkannt, aber nicht transportiert", [scan(0, "p11"), act(1, "p11", "ecg")], 45, { p11: "3" }],
  ["P12 Blutzucker und Glukose", [scan(0, "p12"), act(1, "p12", "blood_glucose"), act(3, "p12", "glucose")], 60, { p12: "versorgt" }],
  ["P12 unbehandelt: bewusstlos, aber am Leben", [], 60, { p12: "3" }],
  ["P13 Schrittmacher durch NEF", [scan(0, "p13"), act(1, "p13", "ecg"), scan(11, "p13", "h2"), act(11, "p13", "pacing", "h2")], 60, { p13: "stimuliert" }],
  ["P13 unbehandelt: Asystolie", [], 45, { p13: "3" }],
  ["P05 stabile Seitenlage hält den Atemweg frei", [scan(0, "p05"), act(1, "p05", "airway_open"), act(2, "p05", "recovery_position")], 60, { p05: "3" }],
  ["P03 Seitenlage und Sauerstoff statt Esmarch", [scan(0, "p03"), act(1, "p03", "recovery_position"), act(3, "p03", "oxygen")], 15, { p03: "2-versorgt" }],
  ["P06 O2, Wärme, Zugang, Intubation", [scan(0, "p06"), act(0.5, "p06", "oxygen"), act(2, "p06", "warm"), act(3, "p06", "iv_access"), scan(16, "p06", "h2"), act(16, "p06", "intubation", "h2")], 60, { p06: "intubiert" }],
  ["P06 großflächig gekühlt", [scan(0, "p06"), act(1, "p06", "cool_large")], 15, { p06: "2-unterkuehlt" }],
  ["P07 Schiene und Analgesie", [scan(0, "p07"), act(1, "p07", "splint"), act(6, "p07", "analgesia")], 60, { p07: "versorgt" }],
  ["P08 nachgesichtet und transportiert", [scan(0, "p08"), act(1, "p08", "examine_abdomen"), handover(20, "p08", "ktw1")], 60, { p08: "2" }],
  ["P09 beruhigt", [scan(0, "p09"), act(1, "p09", "calm")], 60, { p09: "ruhig" }],
  ["P09 Tütenrückatmung", [scan(0, "p09"), act(1, "p09", "bag_rebreathing")], 15, { p09: "falsch-behandelt" }],
];

for (const [name, script, until, want] of paths)
  test(`Verlauf: ${name}`, () => {
    const { s } = run(script, until);
    for (const [id, phase] of Object.entries(want)) assert.equal(phaseOf(s, id), phase, id);
  });

test("Befunde: erweiterte Diagnostik erst nach der Maßnahme sichtbar", () => {
  const { s } = run([scan(0, "p04")], 0);
  assert.equal(visible(s, "p04").bp, undefined);
  assert.equal(visible(s, "p04").exam?.pelvis, undefined);
  assert.equal(visible(s, "p04").hr, 105);
  const t = run([scan(0, "p04"), act(0, "p04", "measure_bp"), act(1, "p04", "examine_pelvis")], 2).s;
  assert.equal(visible(t, "p04").bp, "120/80");
  assert.equal(visible(t, "p04").exam?.pelvis, "instabil, Druckschmerz");
});

test("Prüfungen: Scan, beschäftigt, Material, Eintreffzeit, Phasenwechsel", () => {
  const { s } = run([scan(0, "p04"), act(1, "p04", "pelvic_binder")], 1);
  assert.equal(validate(s, act(1, "p04", "measure_bp")), "Helfer ist beschäftigt");
  tick(s, 4);
  assert.equal(validate(s, act(4, "p04", "pelvic_binder")), "kein pelvic_binder mehr");
  assert.equal(validate(s, act(4, "p01", "tourniquet")), "erst Patient scannen");
  apply(s, scan(4, "p02", "h2"));
  assert.equal(validate(s, act(4, "p02", "needle_decompression", "h2")), "Einheit noch nicht eingetroffen");
  assert.equal(validate(s, { t: 4, type: "phase", patient: "p01", to: "4-tot" }), "Phasenwechsel erzeugt nur die Engine");
});

test("Reproduzierbar: das Protokoll ergibt denselben Zustand", () => {
  const { s, log, settings, seed } = run(paths[1][1], 60);
  const replayed = log.reduce(apply, initial(scenario, defs, settings, seed));
  assert.deepEqual(replayed.patients, s.patients);
  assert.deepEqual(replayed.units, s.units);
});

test("Zufall: Entlastung misslingt manchmal, aber gleich je Seed", () => {
  const script = [scan(0, "p02"), act(1, "p02", "needle_decompression")];
  const outcome = (seed: number) => phaseOf(run(script, 15, { random: true }, seed).s, "p02");
  const results = Array.from({ length: 60 }, (_, i) => outcome(i + 1));
  assert.ok(results.includes("2") && results.includes("2-entlastet"), "beide Ausgänge kommen vor");
  assert.equal(outcome(7), outcome(7));
});

test("Aufnahme und Übergabe: Ort, Fahrzeugplätze, Eintreffen, Stillstand nach Abtransport", () => {
  const { s } = run([scan(0, "p04"), { t: 1, type: "admit", participant: "h1", patient: "p04", place: "bhp" }], 2);
  assert.equal(s.patients.p04.place, "bhp");
  assert.equal(validate(s, handover(2, "p04", "rtw2")), "Fahrzeug noch nicht eingetroffen");
  assert.equal(validate(s, handover(2, "p04", "nef1")), "Fahrzeug noch nicht eingetroffen");
  apply(s, handover(2, "p04", "rtw1"));
  assert.equal(s.patients.p04.left, true);
  assert.equal(s.patients.p04.place, "abtransport");
  assert.equal(validate(s, scan(3, "p04")), "Patient ist bereits abtransportiert");
  apply(s, scan(3, "p01"));
  assert.equal(validate(s, handover(3, "p01", "rtw1")), "kein Platz mehr im Fahrzeug");
  tick(s, 60);
  assert.equal(s.patients.p04.phase, "1"); // läuft nach dem Abtransport nicht weiter
});

test("Übergabe nur ohne laufende Maßnahme am Patienten", () => {
  const { s } = run([scan(0, "p05"), act(1, "p05", "airway_open"), act(2, "p05", "airway_hold"), scan(2, "p05", "h2")], 3);
  assert.equal(validate(s, handover(3, "p05", "rtw1", "h2")), "erst laufende Maßnahmen beenden");
});

test("Messgeräte: EKG aus der Herzfrequenz, Blutzucker und Temperatur, sofern der Fall nichts festlegt", () => {
  const { s } = run([scan(0, "p01"), act(1, "p01", "ecg"), act(5, "p01", "blood_glucose"), act(7, "p01", "measure_temp")], 9);
  const f = visible(s, "p01");
  assert.equal(f.exam?.ecg, ecgOf(f.hr!));
  assert.equal(f.exam?.glucose, "98 mg/dl");
  assert.equal(f.temp, 36.5);
  const p04 = run([scan(0, "p04"), act(1, "p04", "ecg")], 5).s;
  assert.equal(visible(p04, "p04").exam?.ecg, "Vorhofflimmern, Tachyarrhythmie");
  assert.equal(visible(run([scan(0, "p01")], 1).s, "p01").exam?.ecg, undefined); // erst nach der Messung
  assert.deepEqual([ecgOf(0), ecgOf(45), ecgOf(80), ecgOf(130)], ["Asystolie (Nulllinie)", "Sinusbradykardie", "Sinusrhythmus", "Sinustachykardie"]);
});

test("Befundtext statt Zahlen (Papier-dPS)", () => {
  assert.deepEqual(describe({ rr: 32, hr: 135, radialPulse: false, bp: "80/50", spo2: 88, gcs: 13, recap: 4, temp: 34.2, exam: { glucose: "38 mg/dl" } }), {
    rr: "sehr schnell", hr: "sehr schnell, Radialispuls nicht tastbar", bp: "niedrig", spo2: "deutlich erniedrigt", gcs: "benommen", recap: "verlängert", temp: "unterkühlt", glucose: "niedrig",
  });
  assert.deepEqual(describe({ rr: 16, hr: 80, radialPulse: true, gcs: 15 }), { rr: "normal", hr: "normal", gcs: "wach, orientiert" });
  assert.deepEqual(describe({ breathing: false, rr: 0, hr: 0 }), { rr: "keine Atmung", hr: "kein Puls" });
});

test("Gleitende Vitalwerte: nach dem Phasenwechsel vom alten zum neuen Wert, danach kleine Schwankung; Soll-SK bleibt an der Phase", () => {
  const { s } = run([], 16.5, { vitals: "live" });
  assert.equal(phaseOf(s, "p01"), "2-schock"); // HF 115 → 135, RR 115/90 → 85/60
  const mid = liveFindings(s, "p01");
  assert.ok(mid.hr >= 123 && mid.hr <= 127, `HF mitten im Gleiten: ${mid.hr}`);
  const [sys] = mid.bp!.split("/").map(Number);
  assert.ok(sys >= 97 && sys <= 103, `RR mitten im Gleiten: ${mid.bp}`);
  assert.deepEqual(liveFindings(s, "p01"), mid); // gleiche Minute, gleiche Werte
  const hrs = [20, 21, 22, 23, 24, 25].map((t) => liveFindings(s, "p01", t).hr);
  assert.ok(hrs.every((v) => Math.abs(v - 135) <= 2) && new Set(hrs).size > 1, `Schwankung um 135: ${hrs}`);
  assert.equal(visible(s, "p01").hr, mid.hr); // Helfer sehen im Modus "live" die gleitenden Werte
  assert.equal(targetSk(s, "p01"), targetSk(run([], 16.5).s, "p01"));
  const dead = run([], 50, { vitals: "live" }).s;
  assert.equal(liveFindings(dead, "p01").hr, 0); // tot bleibt Nulllinie
  assert.equal(visible(run([], 16.5).s, "p01").hr, 135); // ohne "live" stufenweise wie bisher
});

test("Zwei-Helfer-Maßnahme: wartet auf den zweiten Helfer, startet dann für beide; Abbrechen zählt nicht", () => {
  const assist = (t: number, patient: string, participant: string): Event => ({ t, type: "assist", participant, patient });
  // Vakuummatratze (5 min, 2 Helfer): Material erst beim echten Start
  const { s } = run([scan(1, "p04"), act(2, "p04", "vacuum_mattress"), scan(3, "p04", "h2")], 3.5);
  assert.equal(s.participants.h1.busy?.waiting, true);
  assert.equal(s.units.rtw1.inventory.vacuum_mattress, 1);
  assert.equal(validate(s, assist(4, "p04", "h2")), null);
  apply(s, assist(4, "p04", "h2"));
  assert.equal(s.units.rtw1.inventory.vacuum_mattress, 0);
  assert.equal(s.participants.h1.busy?.until, 9);
  assert.equal(s.participants.h2.busy?.until, 9);
  tick(s, 9);
  assert.ok(s.patients.p04.done.includes("vacuum_mattress"));
  assert.equal(s.participants.h1.busy, null);
  assert.equal(s.participants.h2.busy, null);
  // ohne zweiten Helfer: Warten abbrechen, nichts erledigt
  const alone = run([scan(1, "p04"), act(2, "p04", "vacuum_mattress"), end(6)], 20).s;
  assert.ok(!alone.patients.p04.done.includes("vacuum_mattress"));
  assert.equal(validate(alone, assist(21, "p04", "h1")), "keine Maßnahme wartet auf Hilfe");
});

test("Material holen: von einem anderen Fahrzeug vor Ort in die eigene Einheit, je ein Stück", () => {
  const fetch = (t: number, from: string, item: string, participant = "h1"): Event => ({ t, type: "fetch", participant, from, item });
  const { s } = run([], 5);
  assert.equal(validate(s, fetch(5, "nef1", "needle")), "Fahrzeug noch nicht eingetroffen");
  assert.equal(validate(s, fetch(5, "rtw1", "needle")), "unbekanntes Fahrzeug"); // nicht von sich selbst
  tick(s, 11);
  assert.equal(validate(s, fetch(11, "nef1", "needle")), null);
  apply(s, fetch(11, "nef1", "needle"));
  assert.equal(s.units.rtw1.inventory.needle, 2);
  assert.equal(s.units.nef1.inventory.needle, 1);
  assert.equal(validate(s, fetch(11, "nef1", "tourniquet")), "kein tourniquet mehr auf diesem Fahrzeug");
});
