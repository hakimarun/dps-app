// KI-Funktionen mit einer Test-KI (keine echten Aufrufe, keine Kosten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { z } from "zod";
import type { Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { control, createExercise, loadLibrary, stateAt, submit, submitAsk, viewFor } from "../src/exercise.ts";
import { evaluate } from "../src/evaluation.ts";
import { local, type Ai } from "../src/ai.ts";
import { check, generate, generateFrame, toPatient, type GenPatient } from "../src/generator.ts";

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const MIN = 60000;
let n = 0;
const fake = (reply: unknown): Ai & { calls: number } => ({ name: "test", calls: 0, async json(_t, _s, _u, schema) { this.calls++; return schema.parse(reply); } });

function setup(patients: string[]) {
  const ex = createExercise({ code: "AI0001", owner: "u1", scenario: { ...lib.scenarios.busunfall, patients }, settings: defaultSettings, seed: 1, created: 0 }, lib.defs);
  control(ex, "start", 0);
  const p = submit(ex, null, { type: "intent", id: `a-${++n}`, at: 0, intent: { type: "join", name: "Ali", unit: "rtw1" } }, 0).participant!;
  const intent = (min: number, i: Intent) => ({ type: "intent" as const, id: `a-${++n}`, at: min * MIN, intent: i });
  for (const id of patients) submit(ex, p, intent(1, { type: "scan", patient: id }), MIN);
  return { ex, p, intent };
}

test("Bewusstlose antworten nicht, auch nicht über die KI", async () => {
  const { ex, p, intent } = setup(["p03"]);
  const ai = fake({ answer: "Hallo", topics: [] });
  assert.equal((await submitAsk(ex, p, intent(2, { type: "ask", patient: "p03", question: "Wie heißen Sie?" }), 2 * MIN, ai)).error, null);
  assert.equal(ai.calls, 0);
  assert.deepEqual(viewFor(ex, stateAt(ex, 2), p).patient?.dialog, [{ q: "Wie heißen Sie?", a: "(keine Reaktion)" }]);
});

test("Themenliste ohne KI: Antwort aus dem Profil, bei Luftnot nur der erste Satzteil", async () => {
  const { ex, p, intent } = setup(["p04", "p02"]); // steht zuletzt bei P02
  submit(ex, p, intent(2, { type: "scan", patient: "p04" }), 2 * MIN);
  assert.equal((await submitAsk(ex, p, intent(2, { type: "ask", patient: "p04", topic: "medication" }), 2 * MIN, null)).error, null);
  submit(ex, p, intent(2, { type: "scan", patient: "p02" }), 2 * MIN);
  assert.equal((await submitAsk(ex, p, intent(3, { type: "ask", patient: "p02", topic: "history" }), 3 * MIN, null)).error, null);
  const s = stateAt(ex, 3);
  assert.deepEqual(viewFor(ex, s, p).patient?.dialog, [{ q: "Vorerkrankungen", a: "Ich habe Asthma … (ringt nach Luft)" }]);
  submit(ex, p, intent(3, { type: "scan", patient: "p04" }), 3 * MIN);
  assert.deepEqual(viewFor(ex, stateAt(ex, 3), p).patient?.dialog, [{ q: "Medikamente", a: "Ich nehme einen Blutverdünner, Apixaban heißt der." }]);
  assert.match((await submitAsk(ex, p, intent(4, { type: "ask", patient: "p04", question: "Was ist passiert?" }), 4 * MIN, null)).error ?? "", /KI nicht eingerichtet/);
});

test("KI-Antwort: Diagnose wird abgefangen, Themen zählen für Punkte und Abzeichen", async () => {
  const { ex, p, intent } = setup(["p01"]);
  await submitAsk(ex, p, intent(2, { type: "ask", patient: "p01", question: "Was haben Sie?" }), 2 * MIN, fake({ answer: "Eine arterielle Blutung!", topics: ["symptoms"] }));
  await submitAsk(ex, p, intent(3, { type: "ask", patient: "p01", question: "Allergien, Medikamente, Vorerkrankungen, Essen?" }), 3 * MIN,
    fake({ answer: "Penicillin, sonst nichts, gegessen vor zwei Stunden.", topics: ["allergies", "medication", "history", "lastMeal"] }));
  const dialog = viewFor(ex, stateAt(ex, 3), p).patient!.dialog;
  assert.equal(dialog[0].a, "Ich weiß nicht, was mit mir los ist. Helfen Sie mir bitte.");
  assert.equal(dialog[1].a, "Penicillin, sonst nichts, gegessen vor zwei Stunden.");
  const me = evaluate(ex, 4 * MIN).helpers[0];
  assert.equal(me.points, 5);
  assert.ok(me.badges.includes("Gute Frage"));
});

test("Wiederholte Fragen: Antworten variieren, ab dem vierten Mal genervt; die KI bekommt den Verlauf", async () => {
  const { ex, p, intent } = setup(["p01"]);
  for (let i = 0; i < 5; i++) await submitAsk(ex, p, intent(2, { type: "ask", patient: "p01", question: "Haben Sie Allergien?", topic: "allergies" }), 2 * MIN, null);
  const answers = viewFor(ex, stateAt(ex, 2), p).patient!.dialog.map((d) => d.a);
  assert.equal(answers[0], "Ja, ich vertrage kein Penicillin.");
  assert.equal(new Set(answers.slice(0, 4)).size, 4);
  assert.match(answers[4], /5\. Mal/);
  let seen = "";
  const ai0: Ai = { name: "test", async json(_t, _s, user, schema) { seen = user; return schema.parse({ answer: "Penicillin.", topics: ["allergies"] }); } };
  await submitAsk(ex, p, intent(3, { type: "ask", patient: "p01", question: "Haben Sie Allergien?", topic: "allergies" }), 3 * MIN, ai0);
  assert.match(seen, /Was du dazu weißt .*: Ja, ich vertrage kein Penicillin\./);
  const ai: Ai = { name: "test", async json(_t, _s, user, schema) { seen = user; return schema.parse({ answer: "Penicillin! Zum sechsten Mal!", topics: ["allergies"] }); } };
  await submitAsk(ex, p, intent(3, { type: "ask", patient: "p01", question: "Allergien?" }), 3 * MIN, ai);
  assert.match(seen, /Helfer: Haben Sie Allergien\?/);
  assert.match(seen, /"allergies":6/);
  assert.equal(viewFor(ex, stateAt(ex, 3), p).patient!.dialog.at(-1)!.a, "(genervt) Das habe ich Ihnen jetzt schon so oft gesagt! Penicillin! Zum sechsten Mal!");
});

const gen: GenPatient = {
  title: "Stichverletzung Oberschenkel", picture: "Junger Mann, hält sich das Bein, Hose blutdurchtränkt.",
  category: "Trauma", tags: ["Blutung"], difficulty: "einsteiger", temperament: "ängstlich", pitfall: "redet viel",
  anamnesis: [{ topic: "allergies", answer: "Keine." }],
  base: { walking: false, breathing: true, rr: 24, spo2: 96, hr: 118, bp: "110/80", radialPulse: true, recap: 3, gcs: 15, followsCommands: true, spurtingBleeding: true, stridor: false, lethalInjury: false, pain: 7, exam: [] },
  start: "1",
  phases: [
    { id: "1", findings: {}, rules: [{ when: ["tourniquet"], active: [], then: "2" }], else: "3", dead: false },
    { id: "2", findings: { spurtingBleeding: false, hr: 105 }, rules: [], dead: false },
    { id: "3", findings: { breathing: false, rr: 0, hr: 0, gcs: 3 }, rules: [], dead: true },
  ],
  critical: [{ actions: ["tourniquet"], within: 15 }], harmful: [], sources: ["S3-Leitlinie Polytrauma"],
};

test("Generator: gültiger Fall besteht die Prüfung, Fehler und Warnungen werden gemeldet", () => {
  const ok = check(toPatient(gen, "ki-test01"), lib.defs.actions);
  assert.deepEqual(ok, { ok: true, errors: [], warnings: [], sk: "I" });
  const broken = structuredClone(gen);
  broken.phases[0].rules[0].when = ["zaubertrank"];
  broken.phases.push({ id: "4", findings: {}, rules: [], dead: false });
  broken.picture = "Stichverletzung am Bein.";
  const r = check(toPatient(broken, "ki-test02"), lib.defs.actions);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ["unbekannte Maßnahme: zaubertrank"]);
  assert.deepEqual(r.warnings, ["Phase 4 ist nie erreichbar", "Das sichtbare Bild nennt die Diagnose"]);
});

test("Generator: freie Phasen-IDs und GCS 0 werden normalisiert", () => {
  const messy = structuredClone(gen);
  messy.start = "1-blutung";
  messy.phases[0].id = "1-blutung";
  messy.phases[0].rules[0].then = "2-versorgt"; // gemeint ist "2-gestillt"
  messy.phases[0].else = "3-tot";
  messy.phases[1].id = "2-gestillt";
  messy.phases[2].id = "3-tot";
  messy.phases[2].findings.gcs = 0;
  const p = toPatient(messy, "ki-test03") as { start: string; phases: Record<string, { rules: { then: string }[]; else?: string; findings: { gcs?: number } }> };
  assert.equal(p.start, "1");
  assert.deepEqual(Object.keys(p.phases), ["1", "2", "3"]);
  assert.equal(p.phases["1"].rules[0].then, "2");
  assert.equal(p.phases["1"].else, "3");
  assert.equal(p.phases["3"].findings.gcs, 3);
  assert.equal(check(p, lib.defs.actions).ok, true);
});

test("Generator: erfundene Maßnahmen werden entfernt und gemeldet", async () => {
  const odd = structuredClone(gen);
  odd.phases[0].rules.push({ when: ["coughing"], active: [], then: "2" });
  odd.harmful = ["coughing"];
  const r = await generate(fake(odd), "Stichverletzung", lib.defs.actions, lib.defs.patients.p01);
  assert.equal(r.report.ok, true);
  assert.deepEqual(r.report.warnings, ["unbekannte Maßnahmen entfernt (Regeln dazu fehlen jetzt): coughing"]);
  assert.equal((r.raw as { phases: Record<string, { rules: unknown[] }> }).phases["1"].rules.length, 1);
});

test("Generator: fehlerhafter Entwurf wird einmal mit dem Prüfbericht nachgebessert", async () => {
  const broken = structuredClone(gen);
  broken.phases[0].findings.rr = 90;
  const prompts: string[] = [];
  const replies = [broken, gen, gen];
  const ai: Ai = { name: "test", async json(_t, _s, user, schema) { prompts.push(user); return schema.parse(replies[prompts.length - 1]); } };
  const r = await generate(ai, "Stichverletzung", lib.defs.actions, lib.defs.patients.p01);
  assert.equal(r.report.ok, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /Phase 1: Vitalwert außerhalb/);
});

test("KI fällt aus: Vorschläge antworten aus dem Profil, freie Fragen melden den Fehler", async () => {
  const { ex, p, intent } = setup(["p01"]);
  const down: Ai = { name: "test", async json() { throw new Error("Ollama nicht erreichbar"); } };
  assert.equal((await submitAsk(ex, p, intent(2, { type: "ask", patient: "p01", question: "Haben Sie Allergien?", topic: "allergies" }), 2 * MIN, down)).error, null);
  assert.equal(viewFor(ex, stateAt(ex, 2), p).patient!.dialog[0].a, "Ja, ich vertrage kein Penicillin.");
  assert.match((await submitAsk(ex, p, intent(2, { type: "ask", patient: "p01", question: "Wie heißen Sie?" }), 2 * MIN, down)).error ?? "", /Ollama/);
});

test("Szenario-Rahmen: Einsatzmittel aus Vorlagen, eines ab Minute 0, genau so viele Patientenskizzen wie bestellt", async () => {
  const frame = {
    title: "Brand im Pflegeheim", situation: "Nachts brennt ein Pflegeheim.",
    units: [{ kind: "NEF", arrivesAt: 8 }, { kind: "RTW", arrivesAt: 5.4 }, { kind: "RTW", arrivesAt: 90 }, { kind: "KTW", arrivesAt: 20 }],
    patients: [{ brief: "Bewohnerin, 84, Rauchgas" }, { brief: "Pfleger, 30, Verbrennung Hand" }, { brief: "Bewohner, 90, verwirrt" }],
  };
  const { scenario, briefs } = await generateFrame(fake(frame), "Pflegeheimbrand", 2, lib.scenarios.busunfall);
  const topped = await generateFrame(fake(frame), "Pflegeheimbrand", 5, lib.scenarios.busunfall); // 3 + 3 nachgefordert, 5 genutzt
  assert.equal(topped.briefs.length, 5);
  assert.deepEqual(scenario.units.map((u) => [u.id, u.title, u.arrivesAt, u.seats]), [["rtw1", "RTW 1", 0, 1], ["nef1", "NEF 1", 8, 0], ["ktw1", "KTW 1", 20, 2], ["rtw2", "RTW 2", 60, 1]]);
  assert.deepEqual(scenario.units[1].inventory, lib.scenarios.busunfall.units.find((u) => u.id === "nef1")!.inventory);
  assert.equal(briefs.length, 2);
  assert.match(briefs[0], /^Lage: Nachts brennt ein Pflegeheim\.\nPatient: Bewohnerin, 84/);
  assert.match(scenario.id, /^ki-s/);
});

test("Lokales Modell über OpenAI-kompatible Schnittstelle, auch mit Text um das JSON und nach kaputtem JSON", async () => {
  let calls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const sent = JSON.parse(body);
      assert.equal(sent.model, "testmodell");
      assert.equal(sent.response_format.type, "json_schema");
      // erster Aufruf: kaputtes JSON, zweiter: JSON mit Text drumherum
    res.end(JSON.stringify({ choices: [{ message: { content: ++calls === 1 ? '{"answer": "Mein' : 'Gern: {"answer": "Mein Bein!", "topics": ["symptoms"]} Fertig.' } }] }));
    });
  }).listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const r = await local(`http://localhost:${port}`, "testmodell").json("dialog", "s", "u", z.object({ answer: z.string(), topics: z.array(z.string()) }), 100);
    assert.deepEqual(r, { answer: "Mein Bein!", topics: ["symptoms"] });
    assert.equal(calls, 2);
  } finally {
    server.close();
  }
});
