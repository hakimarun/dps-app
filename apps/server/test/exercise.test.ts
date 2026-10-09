import { test } from "node:test";
import assert from "node:assert/strict";
import { ClientMsg, type Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { control, createExercise, leitungView, loadLibrary, minutes, stateAt, status, submit, truppOf, viewFor } from "../src/exercise.ts";
import { loadExercises, myApprovals, openDb, requestLogin, saveExercise, setApproval, userByToken, verifyLogin } from "../src/db.ts";

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

test("Anmeldung: Code nur einmal gültig, höchstens 5 Fehlversuche, kurze Sperre für neue Codes", () => {
  const db = openDb(":memory:");
  const r = requestLogin(db, "Anna@Example.org", 0);
  assert.ok("code" in r);
  assert.deepEqual(requestLogin(db, "anna@example.org", 30_000), { error: "Bitte eine Minute warten" });
  const wrong = r.code === "000000" ? "111111" : "000000";
  assert.equal(verifyLogin(db, "anna@example.org", wrong, 1000), null);
  const ok = verifyLogin(db, "anna@example.org", r.code, 2000);
  assert.ok(ok);
  assert.equal(userByToken(db, ok.token)?.email, "anna@example.org");
  assert.equal(verifyLogin(db, "anna@example.org", r.code, 3000), null); // schon benutzt
  const r2 = requestLogin(db, "ben@example.org", 0);
  for (let i = 0; i < 5; i++) verifyLogin(db, "ben@example.org", "999999" === (r2 as { code: string }).code ? "888888" : "999999", 1000);
  assert.equal(verifyLogin(db, "ben@example.org", (r2 as { code: string }).code, 2000), null); // gesperrt
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
