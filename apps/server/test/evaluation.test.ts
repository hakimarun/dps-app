import { test } from "node:test";
import assert from "node:assert/strict";
import type { Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { control, createExercise, loadLibrary, status, submit } from "../src/exercise.ts";
import { evaluate } from "../src/evaluation.ts";

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const MIN = 60000;
let n = 0;

function exercise(patients: string[]) {
  const ex = createExercise({ code: "EVAL01", owner: "u1", scenario: { ...lib.scenarios.busunfall, patients }, settings: defaultSettings, seed: 1, created: 0 }, lib.defs);
  control(ex, "start", 0);
  const join = (name: string) => submit(ex, null, { type: "intent", id: `e-${++n}`, at: 0, intent: { type: "join", name, unit: "rtw1" } }, 0).participant!;
  const act = (who: string, min: number, intent: Intent) => {
    const r = submit(ex, who, { type: "intent", id: `e-${++n}`, at: min * MIN, intent }, min * MIN);
    assert.equal(r.error, null, JSON.stringify(intent));
  };
  return { ex, join, act };
}

test("Punkte, Abzeichen, Bericht und Team-Sterne aus dem Protokoll", () => {
  const { ex, join, act } = exercise(["p01", "p04", "p09", "p10"]);
  const anna = join("Anna");
  const ben = join("Ben");
  act(anna, 1, { type: "scan", patient: "p01" });
  act(anna, 2, { type: "start", patient: "p01", action: "tourniquet" });
  act(anna, 3, { type: "triage", patient: "p01", sk: "I" });
  act(ben, 1, { type: "scan", patient: "p04" });
  act(ben, 2, { type: "triage", patient: "p04", sk: "III" }); // Untertriage, Soll II
  act(ben, 5, { type: "triage", patient: "p04", sk: "II" }); // Nachsichtung korrigiert
  act(ben, 6, { type: "scan", patient: "p09" });
  act(ben, 6, { type: "start", patient: "p09", action: "calm" });
  control(ex, "end", 61 * MIN);

  const ev = evaluate(ex, 61 * MIN);
  const a = ev.helpers.find((h) => h.name === "Anna")!;
  const b = ev.helpers.find((h) => h.name === "Ben")!;
  assert.equal(a.points, 15 + 10);
  assert.deepEqual(a.badges, ["Blutstiller", "Ressourcenprofi"]); // knappes Tourniquet richtig eingesetzt
  assert.match(a.good[0], /Tourniquet anlegen an P01 rechtzeitig/);
  assert.equal(b.points, -10 + 8 + 5);
  assert.deepEqual(b.badges.sort(), ["Ruhepol", "Scharfblick"]);
  assert.ok(b.improve.some((i) => /Beckengurt anlegen an P04 fehlte/.test(i)));
  assert.ok(b.improve.some((i) => /P04 als III gesichtet, Soll war II/.test(i)));
  assert.ok(b.improve.length <= 3);

  const outcome = Object.fromEntries(ev.patients.map((p) => [p.id, p.outcome]));
  assert.deepEqual(outcome, { p01: "vor Ort", p04: "verstorben", p09: "vor Ort", p10: "tot aufgefunden" });
  assert.deepEqual(ev.team, { stars: 1, survived: 2, eligible: 3 });
  assert.deepEqual(ev.critical, { timely: 1, late: 0, missed: 2 });
  assert.deepEqual(ev.triage, { correct: 1, over: 0, under: 1 });
});

test("Verspätete und schädliche Maßnahmen", () => {
  const { ex, join, act } = exercise(["p01", "p06"]);
  const c = join("Cem");
  act(c, 1, { type: "scan", patient: "p06" });
  act(c, 1, { type: "start", patient: "p06", action: "cool_large" });
  act(c, 20, { type: "scan", patient: "p01" });
  act(c, 20, { type: "start", patient: "p01", action: "tourniquet" }); // Soll bis 15 min
  const r = evaluate(ex, 29 * MIN).helpers[0]; // vor den P06-Fristen bei 30 min
  assert.equal(r.points, -10 + 5);
  assert.ok(r.improve.some((i) => /Großflächig kühlen bei P06 schadet/.test(i)));
  assert.ok(r.improve.some((i) => /Tourniquet anlegen an P01 erst nach 21:00 min \(Soll: bis 15:00 min\)/.test(i)));
});

test("Berichte freigeben: nur nach Ende und nur einmal; Zustand bleibt beendet", () => {
  const { ex } = exercise(["p01"]);
  assert.match(control(ex, "release", MIN) ?? "", /nicht möglich/);
  control(ex, "end", 2 * MIN);
  assert.equal(control(ex, "release", 3 * MIN), null);
  assert.match(control(ex, "release", 4 * MIN) ?? "", /nicht möglich/);
  assert.equal(status(ex), "ended");
  assert.equal(evaluate(ex, 5 * MIN).released, true);
});

test("Trupps: Beitritt per Trupp-Code, Sichtungstrupp sichtet nur, Auswertung je Trupp und Funktion", () => {
  const trupps = [
    { code: "SICHT1", name: "Sichtungstrupp 1", role: "sichtung" as const, unit: "rtw1" },
    { code: "BEHAN1", name: "Behandlungstrupp 1", role: "behandlung" as const, unit: "rtw1" },
  ];
  const ex = createExercise({ code: "TRUPP1", owner: "u1", scenario: { ...lib.scenarios.busunfall, patients: ["p01", "p04"] }, settings: defaultSettings, seed: 1, created: 0, trupps }, lib.defs);
  control(ex, "start", 0);
  const join = (name: string, tr: (typeof trupps)[number]) =>
    submit(ex, null, { type: "intent", id: `t-${++n}`, at: 0, intent: { type: "join", name } }, 0, tr).participant!;
  const send = (who: string, min: number, intent: Intent) => submit(ex, who, { type: "intent", id: `t-${++n}`, at: min * MIN, intent }, min * MIN).error;
  const s = join("Sina", trupps[0]);
  const b = join("Bob", trupps[1]);
  assert.equal(ex.names.get(s), "Sina");
  assert.equal(send(s, 1, { type: "scan", patient: "p01" }), null);
  assert.match(send(s, 1, { type: "start", patient: "p01", action: "iv_access" }) ?? "", /Sichtungstrupps sichten/);
  assert.equal(send(s, 2, { type: "triage", patient: "p01", sk: "I" }), null);
  assert.equal(send(s, 3, { type: "start", patient: "p01", action: "tourniquet" }), null); // lebensrettende Sofortmaßnahme erlaubt
  assert.equal(send(b, 3, { type: "scan", patient: "p04" }), null);
  assert.equal(send(b, 3, { type: "admit", patient: "p04", place: "bhp" }), null);
  assert.equal(send(b, 4, { type: "triage", patient: "p04", sk: "III" }), null);
  const ev = evaluate(ex, 12 * MIN);
  assert.deepEqual(ev.triageByRole.sichtung, { correct: 1, over: 0, under: 0 });
  assert.deepEqual(ev.triageByRole.behandlung, { correct: 0, over: 0, under: 1 });
  assert.deepEqual(ev.trupps.map((t) => [t.name, t.members, t.points]), [["Sichtungstrupp 1", ["Sina"], 25], ["Behandlungstrupp 1", ["Bob"], -10]]);
});

test("Übergabe: vollständig, unvollständig und Transportreihenfolge", () => {
  const { ex, join, act } = exercise(["p04", "p08"]);
  const a = join("Ada");
  const b = join("Bo");
  act(b, 1, { type: "scan", patient: "p04" }); // P04 (Soll II) wartet mit Kontakt
  act(a, 1, { type: "scan", patient: "p08" });
  act(a, 2, { type: "handover", patient: "p08", vehicle: "rtw1", destination: "Klinikum Nord", diagnosis: "" });
  act(b, 2, { type: "triage", patient: "p04", sk: "II" });
  act(b, 3, { type: "start", patient: "p04", action: "measure_bp" });
  act(b, 4, { type: "start", patient: "p04", action: "pulse_oximetry" });
  act(b, 5, { type: "start", patient: "p04", action: "pelvic_binder" });
  act(b, 16, { type: "handover", patient: "p04", vehicle: "rtw2", destination: "Uniklinik", diagnosis: "instabile Beckenfraktur" });
  const ev = evaluate(ex, 20 * MIN);
  const p08 = ev.patients.find((p) => p.id === "p08")!;
  assert.equal(p08.outcome, "abtransportiert");
  assert.deepEqual(p08.handover?.missing, ["Sichtungskategorie", "Verdacht", "Blutdruck", "SpO₂", "Bauch untersuchen"]);
  const ada = ev.helpers.find((h) => h.name === "Ada")!;
  assert.ok(ada.improve.some((i) => /P08 \(Soll III\) vor P04 \(Soll II\) abtransportiert/.test(i)));
  const bo = ev.helpers.find((h) => h.name === "Bo")!;
  assert.equal(bo.points, 15 + 15 + 10 + 5); // Beckengurt, Übergabe rechtzeitig, Sichtung, Übergabe vollständig
  assert.equal(ev.patients.find((p) => p.id === "p04")!.handover?.vehicle, "RTW 2");
});
