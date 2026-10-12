// Last für den Pilot: 12 Helfer, 10 Patienten, 60 Übungsminuten, alle 20 s eine Aktion je Helfer.
// Der Server rechnet jede Sekunde den Zustand aus dem Protokoll nach; das muss auch am Ende schnell bleiben.
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultSettings } from "@dps/engine";
import { control, createExercise, leitungView, loadLibrary, stateAt, submit, submitAsk, viewFor } from "../src/exercise.ts";
import { evaluate } from "../src/evaluation.ts";

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const MIN = 60000;
const patients = lib.scenarios.busunfall.patients; // P01–P10
const actions = ["measure_bp", "pulse_oximetry", "pressure_dressing", "oxygen", "calm", "recovery_position", "warm", "iv_access"];

test("12 Helfer über 60 Minuten: Aktualisierung pro Sekunde unter 20 ms, Auswertung unter 300 ms", async () => {
  const ex = createExercise({ code: "LOAD01", owner: "u1", scenario: { ...lib.scenarios.busunfall, patients }, settings: defaultSettings, seed: 7, created: 0 }, lib.defs);
  control(ex, "start", 0);
  let n = 0;
  const msg = (intent: Parameters<typeof submit>[2]["intent"], at: number) => ({ type: "intent" as const, id: `load-${++n}-x`, at, intent });
  const units = ["rtw1", "rtw2", "nef1", "ktw1"];
  const helpers = Array.from({ length: 12 }, (_, i) => submit(ex, null, msg({ type: "join", name: `H${i}`, unit: units[i % 4] }, 0), 0).participant!);
  let accepted = 0;
  for (let at = 20_000; at <= 60 * MIN; at += 20_000)
    for (const [i, h] of helpers.entries()) {
      const p = patients[(i + Math.floor(at / (5 * MIN))) % patients.length]; // alle 5 min weiter zum nächsten Patienten
      const k = (at / 20_000 + i) % 4;
      const r = k === 0 ? submit(ex, h, msg({ type: "scan", patient: p }, at), at)
        : k === 1 ? submit(ex, h, msg({ type: "start", patient: p, action: actions[(at / 20_000 + i) % actions.length] }, at), at)
        : k === 2 ? submit(ex, h, msg({ type: "triage", patient: p, sk: "II" }, at), at)
        : await submitAsk(ex, h, msg({ type: "ask", patient: p, question: "Haben Sie Allergien?", topic: "allergies" }, at), at, null);
      if (!r.error) accepted++;
    }
  assert.ok(accepted > 500, `nur ${accepted} Aktionen angenommen`);

  // Während der Übung: Zustand, 12 Helfer-Ansichten und die Leitungsansicht – jede Sekunde.
  const avg = (f: () => void) => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) f();
    return (performance.now() - t0) / 5;
  };
  const live = avg(() => {
    const s = stateAt(ex, 60);
    for (const h of helpers) viewFor(ex, s, h);
    leitungView(ex, 60 * MIN);
  });
  assert.ok(live < 20, `Aktualisierung während der Übung: ${live.toFixed(1)} ms bei ${ex.records.length} Einträgen`);
  // Auswertung: einmal nach dem Ende (der Server speichert sie zwischen).
  const ev = avg(() => evaluate(ex, 60 * MIN));
  assert.ok(ev < 300, `Auswertung: ${ev.toFixed(1)} ms`);
});
