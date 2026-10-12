import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientMsg, type Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { caseOfDay, control, createExercise, csv, inject, observerView, replay, soloHeader, leitungView, loadLibrary, minutes, stateAt, status, submit, truppOf, viewFor } from "../src/exercise.ts";
import { DatabaseSync } from "node:sqlite";
import { deleteExercisesBefore, loadExercises, myApprovals, newDevice, openDb, saveExercise, setApproval, userByToken } from "../src/db.ts";
import { evaluate } from "../src/evaluation.ts";

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const MIN = 60000;
const header = { code: "TEST01", owner: "u1", scenario: { ...lib.scenarios.busunfall, patients: ["p01"] }, settings: defaultSettings, seed: 1, created: 0 };
let n = 0;
const msg = (intent: Intent, at: number) => ({ type: "intent" as const, id: `intent-${++n}`, at, intent });
const running = () => {
  const ex = createExercise(header, lib.defs);
  control(ex, "start", 0);
  return ex;
};
const joined = (ex = running(), name = "Anna") => ({ ex, p: submit(ex, null, msg({ type: "join", name, unit: "rtw1" }, 0), 0).participant! });

test("Helfer tritt bei, scannt und sieht nur Aufgedecktes, nie den Titel", () => {
  const { ex, p } = joined();
  assert.equal(submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN).error, null);
  const v = viewFor(ex, stateAt(ex, 1), p);
  assert.equal(v.me?.name, "Anna");
  assert.equal(v.patient?.findings.hr, 115);
  assert.equal(v.patient?.findings.bp, undefined);
  assert.ok(!JSON.stringify(v).includes("Arterielle Blutung"));
});

test("Offline gepufferte Aktion wirkt an ihrer echten Zeit", () => {
  const { ex, p } = joined();
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  // Tourniquet bei Minute 12 angelegt (vor dem Phasenende bei 15), aber erst bei Minute 20 beim Server angekommen.
  assert.equal(submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, 12 * MIN), 20 * MIN).error, null);
  assert.equal(stateAt(ex, 20).patients.p01.phase, "2-versorgt");
});

test("Doppelt gesendete Aktion wird nur einmal gezählt", () => {
  const { ex, p } = joined();
  const scan = msg({ type: "scan", patient: "p01" }, MIN);
  submit(ex, p, scan, MIN);
  assert.equal(submit(ex, p, scan, 2 * MIN).error, null);
  assert.equal(ex.records.length, 2);
});

test("Abgelehnt: Maßnahme ohne Scan; Zeit zu weit in der Vergangenheit wird auf jetzt gesetzt", () => {
  const { ex, p } = joined();
  assert.equal(submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, MIN), MIN).error, "erst Patient scannen");
  submit(ex, p, msg({ type: "scan", patient: "p01" }, 0), 30 * MIN);
  assert.equal(ex.records.at(-1)!.t, 30);
});

test("Start, Pause, Fortsetzen: Pause hält Uhr und Aktionen an", () => {
  const ex = createExercise(header, lib.defs);
  const { p } = joined(ex);
  assert.equal(status(ex), "ready");
  assert.equal(submit(ex, p, msg({ type: "scan", patient: "p01" }, 0), 0).error, "Übung noch nicht gestartet");
  control(ex, "start", 0);
  control(ex, "pause", 10 * MIN);
  assert.equal(control(ex, "pause", 11 * MIN), "in diesem Zustand (paused) nicht möglich");
  assert.equal(submit(ex, p, msg({ type: "scan", patient: "p01" }, 12 * MIN), 12 * MIN).error, "Übung pausiert");
  control(ex, "resume", 30 * MIN);
  assert.equal(minutes(ex, 35 * MIN), 15); // 10 vor der Pause + 5 danach
  assert.equal(stateAt(ex, minutes(ex, 35 * MIN)).patients.p01.phase, "2-schock");
});

test("Live-Lage: Soll-SK, Untertriage, Helfer ohne Kontakt, Ereignisse", () => {
  const { ex, p } = joined();
  assert.match(leitungView(ex, 6 * MIN).patients[0].alert ?? "", /ohne Helfer/);
  submit(ex, p, msg({ type: "scan", patient: "p01" }, 7 * MIN), 7 * MIN);
  submit(ex, p, msg({ type: "triage", patient: "p01", sk: "II" }, 8 * MIN), 8 * MIN);
  const v = leitungView(ex, 9 * MIN);
  assert.equal(v.patients[0].target, "I");
  assert.equal(v.patients[0].triage, "II");
  assert.equal(v.patients[0].alert, "Untertriage (Soll I)");
  assert.equal(v.counts.II, 1);
  assert.deepEqual(v.helpers.map((h) => [h.name, h.patient]), [["Anna", "p01"]]);
  assert.equal(v.events[0].text, "Anna sichtet P01: II");
  assert.ok(leitungView(ex, 16 * MIN).events.some((e) => e.text === "P01 wechselt in Phase 2-schock"));
});

test("Ohne Konten: jedes Gerät bekommt einen eigenen Schlüssel, auch in älteren Datenbanken mit E-Mail-Spalte", () => {
  const db = openDb(":memory:");
  const a = newDevice(db, 0), b = newDevice(db, 0);
  assert.notEqual(userByToken(db, a)?.id, userByToken(db, b)?.id);
  assert.equal(userByToken(db, "erfunden"), null);
  const old = new DatabaseSync(":memory:");
  old.exec("create table users (id text primary key, email text unique not null, created integer not null)");
  old.exec("create table sessions (token_hash blob primary key, user_id text not null, created integer not null)");
  assert.ok(userByToken(old as never, newDevice(old as never, 0)));
});

test("Freigaben und Übungen überstehen einen Neustart", () => {
  const db = openDb(":memory:");
  setApproval(db, "u1", "p01", 1, true, 0);
  assert.equal(myApprovals(db, "u1").get("p01"), 1);
  const trupp = { code: "TRUPPX", name: "Behandlungstrupp 1", role: "behandlung" as const, unit: "rtw1" };
  const ex = saveExercise(db, { ...header, trupps: [trupp] }, lib.defs);
  control(ex, "start", 0);
  const p = submit(ex, null, msg({ type: "join", name: "Eva" }, 0), 0, trupp).participant!;
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, 2 * MIN), 2 * MIN);
  const [again] = loadExercises(db, lib.defs);
  assert.equal(status(again), "running");
  assert.deepEqual(stateAt(again, 20).patients, stateAt(ex, 20).patients);
  assert.equal(again.names.get(p), "Eva");
  assert.equal(truppOf(again, p)?.name, "Behandlungstrupp 1"); // Trupp-Zugehörigkeit bleibt erhalten
});

test("Ungültige Client-Nachrichten werden abgelehnt", () => {
  assert.equal(ClientMsg.safeParse({ type: "intent", id: "x", at: 0, intent: { type: "scan" } }).success, false);
  assert.equal(ClientMsg.safeParse({ type: "intent", id: "abcdefgh", at: 0, intent: { type: "triage", patient: "p01", sk: "V" } }).success, false);
  assert.equal(ClientMsg.safeParse({ type: "hello", exercise: "DEMO", participant: null }).success, true);
});

test("Vitalwerte-Modus Text: Handy bekommt Befundtext statt Zahlen", () => {
  const ex = createExercise({ ...header, code: "TEXT01", settings: { ...defaultSettings, vitals: "text" } }, lib.defs);
  control(ex, "start", 0);
  const p = submit(ex, null, msg({ type: "join", name: "Anna", unit: "rtw1" }, 0), 0).participant!;
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  const v = viewFor(ex, stateAt(ex, 1), p).patient!;
  assert.equal(v.findings.hr, undefined);
  assert.equal(v.findings.rr, undefined);
  assert.equal(v.vitalsText?.hr, "schnell");
  assert.ok(!/\b115\b/.test(JSON.stringify(v)), "keine Zahl im Datenstrom");
});

test("Aufbewahrungsfrist: alte Übungen verschwinden samt Protokoll, neue bleiben", () => {
  const db = openDb(":memory:");
  const old = saveExercise(db, { ...header, code: "ALT001", created: 1_000 }, lib.defs);
  saveExercise(db, { ...header, code: "NEU001", created: 5_000 }, lib.defs);
  control(old, "start", 0);
  submit(old, null, msg({ type: "join", name: "Anna", unit: "rtw1" }, 0), 0);
  const records = () => (db.prepare("select count(*) as n from records where code = 'ALT001'").get() as { n: number }).n;
  assert.ok(records() > 0);
  assert.deepEqual(deleteExercisesBefore(db, 2_000), ["ALT001"]);
  assert.deepEqual(loadExercises(db, lib.defs).map((ex) => ex.code), ["NEU001"]);
  assert.equal(records(), 0);
});

test("Live-Lage: Trend je Patient und Leerlauf je Helfer", () => {
  const { ex, p } = joined();
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  submit(ex, p, msg({ type: "start", patient: "p01", action: "measure_bp" }, 2 * MIN), 2 * MIN); // 1 min
  const early = leitungView(ex, 5 * MIN);
  assert.equal(early.patients[0].trend, "gleich");
  assert.equal(early.helpers[0].idle, 2); // Messung endete bei 3 min
  const late = leitungView(ex, 70 * MIN); // P01 unbehandelt verstorben
  assert.equal(late.patients[0].trend, "schlechter");
});

test("Zwischenstand liefert denselben Zustand wie komplettes Neurechnen, auch nach verspäteter Offline-Aktion", () => {
  const { ex, p } = joined();
  const fresh = (t: number) => (delete ex.cache, stateAt(ex, t));
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  stateAt(ex, 5); // legt Zwischenstand bei 5 min an
  submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, 6 * MIN), 6 * MIN);
  const cached = stateAt(ex, 20);
  assert.deepEqual(cached.patients, fresh(20).patients);
  stateAt(ex, 30);
  // Offline gepuffert: Druckverband bei 3 min, kommt erst jetzt an
  submit(ex, p, msg({ type: "start", patient: "p01", action: "pressure_dressing" }, 3 * MIN), 31 * MIN);
  const after = stateAt(ex, 40);
  assert.ok(after.patients.p01.done.includes("pressure_dressing"));
  assert.deepEqual(after.patients, fresh(40).patients);
  assert.deepEqual(after.participants, fresh(40).participants);
});

test("Replay: je Minute die Lage, Phasenwechsel sichtbar; CSV mit entschärften Formeln", () => {
  const { ex, p } = joined(running(), "=HYPERLINK(\"x\")");
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  const r = replay(ex, 20 * MIN);
  assert.equal(r.frames.length, 21);
  assert.equal(r.frames[0].patients[0].phase, lib.defs.patients.p01.start);
  assert.notEqual(r.frames[20].patients[0].phase, r.frames[0].patients[0].phase);
  assert.ok(r.events.some((e) => e.type === "scan"));
  const lines = csv(ex, 20 * MIN).split("\r\n");
  assert.ok(lines[0].startsWith("﻿Minute;Ereignis"));
  assert.ok(lines.some((l) => l.startsWith("0:00;join;;\"'=HYPERLINK(\"\"x\"\")\";")), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("1:00;scan;P01;")));
});

test("Fall des Tages: gleicher Tag gleicher Fall, nächster Tag anderer, nie tot aufgefunden", () => {
  const day = 86_400_000;
  const a = caseOfDay(lib, 20_000 * day + 5), b = caseOfDay(lib, 20_000 * day + day - 1), c = caseOfDay(lib, 20_001 * day);
  assert.equal(a, b);
  assert.notEqual(a, c);
  for (let d = 0; d < 30; d++) {
    const p = lib.defs.patients[caseOfDay(lib, d * day)];
    assert.ok(!p.phases[p.start].dead, p.id);
  }
  const ex = createExercise(soloHeader(lib, "SOLO01", 0, 1), lib.defs);
  control(ex, "start", 0);
  const p = submit(ex, null, msg({ type: "join", name: "Ich", unit: "rtw1" }, 0), 0).participant!;
  assert.equal(submit(ex, p, msg({ type: "scan", patient: ex.scenario.patients[0] }, 0), 0).error, null);
  assert.equal(stateAt(ex, 0).units.nef1.arrivesAt, 0); // NEF-Material sofort verfügbar
});

test("Fall des Tages: früh abschließen zählt den Verlauf bis Minute 10 (unversorgte Blutung stirbt)", () => {
  const day = 86_400_000;
  const d = Array.from({ length: 40 }, (_, i) => i).find((i) => caseOfDay(lib, i * day) === "p01")!;
  const ex = createExercise(soloHeader(lib, "SOLO02", d * day, 1), lib.defs);
  control(ex, "start", d * day);
  control(ex, "end", d * day + 12_000);
  const ev = evaluate(ex, d * day + 12_000);
  assert.equal(ev.patients[0].outcome, "verstorben");
  assert.equal(ev.team.stars, 0);
});

test("Eingriffe der Leitung: Phase setzen läuft von dort weiter, Nachricht erreicht alle Helfer, beides im Protokoll", () => {
  const { ex, p } = joined();
  assert.equal(inject(ex, { type: "set", patient: "p01", to: "3-schock" }, 2 * MIN), null);
  assert.equal(stateAt(ex, 3).patients.p01.phase, "3-schock");
  assert.equal(stateAt(ex, 2 + 15).patients.p01.phase, "4-tot"); // eigener Takt ab dem Setzen
  assert.equal(inject(ex, { type: "set", patient: "p01", to: "erfunden" }, 3 * MIN), "unbekannte Phase");
  assert.equal(inject(ex, { type: "message", text: "Zweiter Bus gefunden, 4 weitere Verletzte" }, 4 * MIN), null);
  assert.deepEqual(viewFor(ex, stateAt(ex, 5), p).messages.map((m) => m.text), ["Zweiter Bus gefunden, 4 weitere Verletzte"]);
  const texts = leitungView(ex, 5 * MIN).events.map((e) => e.text);
  assert.ok(texts.includes("Leitung setzt P01 in Phase 3-schock"));
  assert.ok(texts.includes("Leitung an alle: Zweiter Bus gefunden, 4 weitere Verletzte"));
  assert.ok(leitungView(ex, 5 * MIN).patients[0].phases.includes("2-versorgt"));
  const fresh = createExercise(header, lib.defs);
  assert.equal(inject(fresh, { type: "message", text: "x" }, 0), "Übung noch nicht gestartet");
});

test("Beobachter-Notizen: im Protokoll, in der Beobachter-Sicht und im Bericht der Person, auch nach dem Ende", async () => {
  const { evaluate } = await import("../src/evaluation.ts");
  const { ex, p } = joined();
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  assert.equal(inject(ex, { type: "note", by: "Mara", text: "Tourniquet sauber und schnell", kind: "gut", helper: p, patient: "p01" }, 3 * MIN), null);
  assert.equal(inject(ex, { type: "note", by: "Mara", text: "x", kind: "note", helper: "niemand", patient: null }, 3 * MIN), "unbekannter Helfer");
  control(ex, "end", 10 * MIN);
  assert.equal(inject(ex, { type: "note", by: "Mara", text: "Übergabe zu leise", kind: "besser", helper: p, patient: null }, 11 * MIN), null);
  const v = observerView(ex, 11 * MIN);
  assert.equal(v.notes[0].text, "Beobachtung besser (Mara) zu Anna: Übergabe zu leise");
  assert.equal(v.notes[1].text, "Beobachtung gut (Mara) zu Anna an P01: Tourniquet sauber und schnell");
  assert.deepEqual(evaluate(ex, 11 * MIN).helpers[0].notes, ["Gut: P01: Tourniquet sauber und schnell", "Besser: Übergabe zu leise"]);
  assert.equal(inject(ex, { type: "message", text: "zu spät" }, 11 * MIN), "Übung beendet");
});

test("Bericht als Druckseite: Kennzahlen, Helfer und Protokoll, Namen escaped", async () => {
  const { evaluate } = await import("../src/evaluation.ts");
  const { reportPage } = await import("../src/print.ts");
  const { timeline } = await import("../src/exercise.ts");
  const { ex, p } = joined(running(), "<img src=x onerror=alert(1)>");
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, 2 * MIN), 2 * MIN);
  control(ex, "end", 20 * MIN);
  const html = reportPage(ex, evaluate(ex, 20 * MIN), timeline(ex, 20));
  assert.ok(!html.includes("<img src=x"), "Name nicht escaped");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.match(html, /Tourniquet anlegen an P01/);
  assert.match(html, /<td>20:00<\/td>|<td>1:00<\/td>/);
});

test("KI-Feedback: Fakten ohne Namen, Vorschlag über die KI, gespeicherter Text im Bericht und nicht im Protokoll", async () => {
  const { evaluate } = await import("../src/evaluation.ts");
  const { feedbackFacts, suggestFeedback } = await import("../src/feedback.ts");
  const { ex, p } = joined(running(), "Anna");
  submit(ex, p, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  submit(ex, p, msg({ type: "start", patient: "p01", action: "tourniquet" }, 2 * MIN), 2 * MIN);
  control(ex, "end", 20 * MIN);
  const r = evaluate(ex, 20 * MIN).helpers[0];
  const facts = feedbackFacts(ex, p, r);
  assert.match(facts, /2:00 Tourniquet anlegen an P01/);
  assert.ok(!facts.includes("Anna"), "kein Name an die KI");
  let seen = "";
  const fake = { name: "fake", json: async (_t: string, _s: string, user: string) => ((seen = user), { text: " Gut gemacht. " }) } as never;
  assert.equal(await suggestFeedback(fake, ex, p, r), "Gut gemacht.");
  assert.equal(seen, facts);
  assert.equal(inject(ex, { type: "feedback", helper: p, text: "Tourniquet nach 2 min, stark." }, 21 * MIN), null);
  assert.equal(evaluate(ex, 21 * MIN).helpers[0].feedback, "Tourniquet nach 2 min, stark.");
  assert.ok(!leitungView(ex, 21 * MIN).events.some((e) => /Feedback/.test(e.text)));
});

test("Tempo der Übungszeit: 2× lässt Übungsminuten doppelt so schnell laufen, Pause bleibt Pause, überlebt einen Neustart", () => {
  const db = openDb(":memory:");
  const ex = saveExercise(db, { ...header, code: "SPEED1" }, lib.defs);
  control(ex, "start", 0);
  assert.equal(control(ex, "speed", 10 * MIN, 2), null);
  assert.equal(minutes(ex, 15 * MIN), 10 + 10); // 10 min normal, 5 min doppelt
  assert.equal(status(ex), "running"); // Tempo ändert den Status nicht
  control(ex, "pause", 15 * MIN);
  assert.equal(minutes(ex, 30 * MIN), 20);
  control(ex, "resume", 30 * MIN);
  assert.equal(minutes(ex, 31 * MIN), 22); // weiter mit 2×
  control(ex, "speed", 31 * MIN, 1);
  assert.equal(minutes(ex, 33 * MIN), 24);
  assert.equal(stateAt(ex, 20).patients.p01.phase, "2-schock"); // Phasen laufen in Übungsminuten
  const again = loadExercises(db, lib.defs).find((x) => x.code === "SPEED1")!;
  assert.equal(minutes(again, 33 * MIN), 24);
  control(ex, "end", 34 * MIN);
  assert.equal(control(ex, "speed", 35 * MIN, 4), "in diesem Zustand (ended) nicht möglich");
});

test("Funkrufnamen: je Fahrzeugklasse eigene Kennzahl, kein Rufname doppelt, auch wenn der Zufall sich wiederholt", async () => {
  const { callsign, withCallsigns } = await import("../src/exercise.ts");
  const named = withCallsigns(lib.scenarios.busunfall.units);
  assert.deepEqual(named.map((u) => u.title.replace(/ \d+\//, " W/").replace(/\/\d$/, "/n")), ["RTW W/83/n", "NEF W/82/n", "RTW W/83/n", "KTW W/85/n"]);
  assert.equal(new Set(named.map((u) => u.title)).size, named.length);
  const rolls = [70, 1, 70, 1, 70, 1, 41, 2]; // Zufall liefert zweimal dasselbe
  const used = new Set<string>();
  const rnd = () => rolls.shift()!;
  assert.equal(callsign("RTW", used, rnd), "70/83/1");
  assert.equal(callsign("RTW", used, rnd), "41/83/2"); // 70/83/1 übersprungen
  assert.equal(withCallsigns([{ title: "NKTW 1" }])[0].title.split("/")[1], "26"); // Notfall-KTW
});
