// KI-Funktionen mit einer Test-KI (keine echten Aufrufe, keine Kosten).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import type { Intent } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { caseOf, control, createExercise, loadLibrary, stateAt, submit, submitAsk, viewFor } from "../src/exercise.ts";
import { evaluate } from "../src/evaluation.ts";
import { local, type Ai } from "../src/ai.ts";
import { check, generate, generateFrame, tidyExam, toPatient, type GenPatient } from "../src/generator.ts";

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

test("Szenario-Rahmen: Einsatzmittel aus Vorlagen, eines ab Minute 0, Patienten genau nach Sichtungsmix", async () => {
  const frame = {
    title: "Brand im Pflegeheim", situation: "Nachts brennt ein Pflegeheim.",
    units: [{ kind: "NEF", arrivesAt: 8 }, { kind: "RTW", arrivesAt: 5.4 }, { kind: "RTW", arrivesAt: 90 }, { kind: "KTW", arrivesAt: 20 }],
    patients: [{ sk: "II", brief: "Bewohnerin, 84, Rauchgas" }, { sk: "III", brief: "Pfleger, 30, Verbrennung Hand" }, { sk: "I", brief: "Bewohner, 90, bewusstlos" }],
  };
  const { scenario, briefs } = await generateFrame(fake(frame), "Pflegeheimbrand", { I: 1, III: 1 }, lib.scenarios.busunfall);
  assert.deepEqual(briefs.map((b) => b.sk), ["I", "III"]); // genau nach Mix, die II bleibt weg
  assert.match(briefs[0].brief, /^Lage: Nachts brennt ein Pflegeheim\.\nPatient: Bewohner, 90, bewusstlos\nSichtungskategorie zu Beginn nach mSTaRT: I/);
  const topped = await generateFrame(fake(frame), "Pflegeheimbrand", { II: 2, III: 2 }, lib.scenarios.busunfall); // fehlende je Kategorie nachgefordert
  assert.deepEqual(topped.briefs.map((b) => b.sk), ["II", "II", "III", "III"]);
  assert.deepEqual(scenario.units.map((u) => [u.id, u.title, u.arrivesAt, u.seats]), [["rtw1", "RTW 1", 0, 1], ["nef1", "NEF 1", 8, 0], ["ktw1", "KTW 1", 20, 2], ["rtw2", "RTW 2", 60, 1]]);
  assert.deepEqual(scenario.units[1].inventory, lib.scenarios.busunfall.units.find((u) => u.id === "nef1")!.inventory);
  assert.match(scenario.id, /^ki-s/);
});

test("Generator: verfehlt der Patient die gewünschte Sichtung, gibt es einen zweiten Versuch mit Hinweis", async () => {
  const prompts: string[] = [];
  const ai: Ai = { name: "test", async json(_t, _s, user, schema) { prompts.push(user); return schema.parse(gen); } }; // gen ist SK I
  const r = await generate(ai, "Stichverletzung", lib.defs.actions, lib.defs.patients.p01, "III");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /soll zu Beginn nach mSTaRT Kategorie III sein, ist nach deinen Ausgangswerten aber I/);
  assert.ok(r.report.warnings.includes("Sichtung zu Beginn I statt gewünscht III"));
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

test("Generator: tödliche Verletzung nur bei Toten, Bildtext muss die Person beschreiben", async () => {
  const lethal = structuredClone(gen);
  lethal.base.lethalInjury = true; // kleines Modell: "schwer verletzt" = tödlich
  const scene = structuredClone(gen);
  scene.picture = "Ein Kleinbus liegt neben einem Baum, Einsatzkräfte bergen Verletzte.";
  const prompts: string[] = [];
  const replies = [scene, lethal];
  const ai: Ai = { name: "test", async json(_t, _s, user, schema) { prompts.push(user); return schema.parse(replies[prompts.length - 1]); } };
  const r = await generate(ai, "Stichverletzung", lib.defs.actions, lib.defs.patients.p01);
  assert.equal(prompts.length, 2); // Szene statt Person: zweiter Versuch
  assert.match(prompts[1], /beschreibt die Szene statt der Person/);
  assert.equal(r.report.sk, "I"); // nicht EX
  assert.ok(r.report.warnings.includes("„tödliche Verletzung“ bei lebendem Patienten entfernt"));
});

test("Generator: Verweis auf eine nicht vorhandene Phase fällt weg, statt den Fall scheitern zu lassen", async () => {
  const dangling = structuredClone(gen);
  dangling.phases[1].else = "5-stabilisierungsmaßnahmen"; // gibt es nicht
  dangling.phases[0].rules.push({ when: ["oxygen"], active: [], then: "phase-9" });
  const r = await generate(fake(dangling), "Stichverletzung", lib.defs.actions, lib.defs.patients.p01);
  assert.equal(r.report.ok, true);
  assert.ok(r.report.warnings.includes("2 Verweis(e) auf fehlende Phasen entfernt"));
});

test("Generator: Zielgruppe SanH streicht kritische Maßnahmen außerhalb des Rahmens und setzt die Schwierigkeit", async () => {
  const g = structuredClone(gen);
  g.critical = [{ actions: ["tourniquet"], within: 10 }, { actions: ["iv_access", "fluids"], within: 20 }];
  const sanh = await generate(fake(g), "Stichverletzung", lib.defs.actions, lib.defs.patients.p01, undefined, "sanh");
  const p = sanh.raw as { scoring: { critical: { actions: string[] }[] }; meta: { difficulty: string } };
  assert.deepEqual(p.scoring.critical.map((c) => c.actions), [["tourniquet"]]);
  assert.equal(p.meta.difficulty, "einsteiger");
  assert.ok(sanh.report.warnings.includes("kritische Maßnahmen außerhalb des Rahmens Sanitätshelfer (SanH) entfernt"));
  const notsan = await generate(fake(g), "Stichverletzung", lib.defs.actions, lib.defs.patients.p01, undefined, "notsan");
  assert.equal((notsan.raw as typeof p).scoring.critical.length, 2); // NotSan darf invasive Maßnahmen
  assert.equal((notsan.raw as typeof p).meta.difficulty, "experte");
});

test("Bibliothek: jeder Fall besteht die Fallprüfung, jedes Szenario kennt seine Patienten und hat Fahrzeuge", () => {
  const ideas = new Map((JSON.parse(readFileSync(new URL("../../../library/ideas/cases.json", import.meta.url), "utf8")) as { id: string; sk: string }[]).map((i) => [i.id, i.sk]));
  for (const p of Object.values(lib.defs.patients)) {
    const r = check(p, lib.defs.actions);
    assert.deepEqual(r.errors, [], p.id);
    const want = ideas.get(p.id);
    if (want) assert.equal(r.sk, want === "IV" ? "I" : want, `${p.id}: Sichtung zu Beginn wie in der Idee`); // mSTaRT kennt kein IV
  }
  for (const s of Object.values(lib.scenarios)) {
    for (const id of s.patients) assert.ok(lib.defs.patients[caseOf(lib.defs, id)], `${s.id}: Patient ${id} fehlt`);
    assert.ok(s.units.some((u) => u.arrivesAt === 0), `${s.id}: ein Fahrzeug ist von Anfang an da`);
  }
});

test("Bibliothek und Import-Dateien: jede genannte Maßnahme gibt es, ihr Material liegt auf einem Fahrzeug, Untersuchungen zeigen einen Befund", () => {
  const dir = new URL("../../../library/import/", import.meta.url);
  const imported = readdirSync(dir).flatMap((f) => (JSON.parse(readFileSync(new URL(f, dir), "utf8")) as { patients: unknown[] }).patients) as typeof all;
  const all = Object.values(lib.defs.patients);
  const stock = new Set(Object.values(lib.scenarios).flatMap((s) => s.units.flatMap((u) => Object.keys(u.inventory).filter((k) => u.inventory[k] > 0))));
  for (const p of [...all, ...imported]) {
    assert.deepEqual(check(p, lib.defs.actions).errors, [], p.id); // u. a. unbekannte Maßnahmen
    const exams = new Set([p.base.exam, ...Object.values(p.phases).map((ph) => ph.findings.exam ?? {})].flatMap((e) => Object.keys(e ?? {})));
    const needed = [...Object.values(p.phases).flatMap((ph) => ph.rules.flatMap((r) => [...r.when, ...r.active])), ...p.scoring.critical.flatMap((c) => c.actions)];
    for (const a of new Set([...needed, ...p.scoring.harmful])) {
      if (a === "handover") continue;
      for (const m of Object.keys(lib.defs.actions[a].material)) assert.ok(stock.has(m), `${p.id}: ${a} braucht ${m}, das auf keinem Fahrzeug liegt`);
    }
    for (const a of new Set(needed)) {
      const shows = (lib.defs.actions[a]?.reveals ?? []).filter((r) => r.startsWith("exam."));
      if (shows.length) assert.ok(shows.some((r) => exams.has(r.slice(5))), `${p.id}: ${a} wird verlangt, zeigt aber keinen Befund`);
    }
    for (const e of [p.base, ...Object.values(p.phases).map((ph) => ph.findings)]) assert.deepEqual(tidyExam(e as never), e, `${p.id}: Befundschlüssel nicht vereinheitlicht`);
  }
});

test("Befundschlüssel: Untersuchungen unter festen Schlüsseln, Temperatur als Messwert, Lösungshinweise fallen weg", () => {
  assert.deepEqual(tidyExam({ exam: { Lunge: "Giemen", chest: "Prellmarke", thorax: "stabil", Haut: "blass", Zustand: "braucht Notarzt", temperature: "35,6 °C (Ohr)" } }), {
    exam: { auscultation: "Giemen", bodycheck: "Prellmarke; stabil", Haut: "blass" }, temp: 35.6,
  });
  assert.deepEqual(tidyExam({ exam: { "Schwere Blutung am Unterschenkel. Pupillen reagieren auf Licht.": "normal", "Versuch der Analgesie": "", "Auskultation Lunge": "Rasseln" } }), { exam: { auscultation: "Rasseln" } });
});
