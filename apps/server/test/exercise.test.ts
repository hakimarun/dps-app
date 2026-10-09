import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientMsg, type Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { createExercise, loadExercise, loadLibrary, stateAt, submit, viewFor } from "../src/exercise.ts";

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const MIN = 60000;
const header = { code: "T", scenario: { ...lib.scenarios.busunfall, patients: ["p01"] }, settings: defaultSettings, seed: 1, startedAt: 0 };
let n = 0;
const msg = (intent: Intent, at: number) => ({ type: "intent" as const, id: `intent-${++n}`, at, intent });

test("Helfer tritt bei, scannt und sieht nur Aufgedecktes, nie den Titel", () => {
  const ex = createExercise(header, lib.defs);
  const { participant } = submit(ex, null, msg({ type: "join", name: "Anna", unit: "rtw1" }, 0), 0);
  assert.ok(participant);
  assert.equal(submit(ex, participant, msg({ type: "scan", patient: "p01" }, MIN), MIN).error, null);
  const v = viewFor(ex, stateAt(ex, 1), participant);
  assert.equal(v.me?.name, "Anna");
  assert.equal(v.patient?.findings.hr, 115);
  assert.equal(v.patient?.findings.bp, undefined);
  assert.ok(!JSON.stringify(v).includes("Arterielle Blutung"));
});

test("Offline gepufferte Aktion wirkt an ihrer echten Zeit", () => {
  const ex = createExercise(header, lib.defs);
  const { participant } = submit(ex, null, msg({ type: "join", name: "Ben", unit: "rtw1" }, 0), 0);
  submit(ex, participant!, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  // Tourniquet bei Minute 12 angelegt (vor dem Phasenende bei 15), aber erst bei Minute 20 beim Server angekommen.
  assert.equal(submit(ex, participant!, msg({ type: "start", patient: "p01", action: "tourniquet" }, 12 * MIN), 20 * MIN).error, null);
  assert.equal(stateAt(ex, 20).patients.p01.phase, "2-versorgt");
});

test("Doppelt gesendete Aktion wird nur einmal gezählt", () => {
  const ex = createExercise(header, lib.defs);
  const join = msg({ type: "join", name: "Cem", unit: "rtw1" }, 0);
  const { participant } = submit(ex, null, join, 0);
  const scan = msg({ type: "scan", patient: "p01" }, MIN);
  submit(ex, participant!, scan, MIN);
  assert.equal(submit(ex, participant!, scan, 2 * MIN).error, null);
  assert.equal(ex.records.length, 2);
});

test("Abgelehnt: Maßnahme ohne Scan, Zeit zu weit in der Vergangenheit wird auf jetzt gesetzt", () => {
  const ex = createExercise(header, lib.defs);
  const { participant } = submit(ex, null, msg({ type: "join", name: "Dana", unit: "rtw1" }, 0), 0);
  assert.equal(submit(ex, participant!, msg({ type: "start", patient: "p01", action: "tourniquet" }, MIN), MIN).error, "erst Patient scannen");
  submit(ex, participant!, msg({ type: "scan", patient: "p01" }, 0), 30 * MIN);
  assert.equal(ex.records.at(-1)!.t, 30);
});

test("Übung übersteht einen Neustart des Servers", () => {
  const file = join(mkdtempSync(join(tmpdir(), "dps-")), "T.jsonl");
  const ex = createExercise(header, lib.defs, file);
  const { participant } = submit(ex, null, msg({ type: "join", name: "Eva", unit: "rtw1" }, 0), 0);
  submit(ex, participant!, msg({ type: "scan", patient: "p01" }, MIN), MIN);
  submit(ex, participant!, msg({ type: "start", patient: "p01", action: "tourniquet" }, 2 * MIN), 2 * MIN);
  const again = loadExercise(file, lib.defs);
  assert.deepEqual(stateAt(again, 20).patients, stateAt(ex, 20).patients);
  assert.equal(again.names.get(participant!), "Eva");
});

test("Ungültige Client-Nachrichten werden abgelehnt", () => {
  assert.equal(ClientMsg.safeParse({ type: "intent", id: "x", at: 0, intent: { type: "scan" } }).success, false);
  assert.equal(ClientMsg.safeParse({ type: "intent", id: "abcdefgh", at: 0, intent: { type: "triage", patient: "p01", sk: "V" } }).success, false);
  assert.equal(ClientMsg.safeParse({ type: "hello", exercise: "DEMO", participant: null }).success, true);
});
