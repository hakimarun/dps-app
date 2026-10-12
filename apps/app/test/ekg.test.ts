// EKG-Generator: Befund → Rhythmus, Zahl der Kammerkomplexe und P-Wellen, nahtlose Wiederholung.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ecgValue, rhythmOf, type Rhythm } from "../src/ekg.ts";

const D = 6;
// Wie oft die Kurve eine Schwelle von unten überschreitet (z. B. R-Zacken über 0,7 mV).
function crossings(rhythm: Rhythm, hr: number, threshold: number) {
  const v = ecgValue(rhythm, hr, D);
  let n = 0;
  for (let t = 0, prev = v(0); t < D; t += 0.001) {
    const y = v(t);
    if (prev < threshold && y >= threshold) n++;
    prev = y;
  }
  return n;
}

test("EKG-Befund aus dem Fall wählt den Rhythmus", () => {
  const cases: [string, Rhythm][] = [
    ["Sinustachykardie", "sinus"], ["Asystolie (Nulllinie)", "asystole"], ["Kammerflimmern, grob", "vf"], ["Kammertachykardie", "vt"],
    ["Vorhofflimmern, Tachyarrhythmie", "af"], ["Vorhofflattern 2:1", "flutter"], ["AV-Block III (totaler AV-Block)", "av3"],
    ["AV-Block II Typ Wenckebach", "wenckebach"], ["AV-Block II Typ Mobitz II", "mobitz2"], ["AV-Block I", "av1"],
    ["STEMI (ST-Hebung V2–V4)", "stemi"], ["ST-Senkung", "st-depression"], ["Sinusrhythmus mit VES", "pvc"], ["Schrittmacherstimulation, Frequenz 70", "paced"],
  ];
  for (const [text, want] of cases) assert.equal(rhythmOf(text), want, text);
});

test("Kammerkomplexe passen zur Herzfrequenz, Blöcke lassen Überleitungen aus", () => {
  assert.equal(crossings("sinus", 90, 0.7), 9); // 90/min über 6 s
  assert.equal(crossings("af", 120, 0.7), 12);
  assert.equal(crossings("stemi", 80, 0.7), 8);
  assert.equal(crossings("vt", 180, 0.7), 18);
  assert.equal(crossings("av3", 35, 0.7), 4); // langsamer Ersatzrhythmus …
  // … unabhängig von 8 P-Wellen (80/min); manche verschwinden in der T-Welle des Ersatzschlags, wie im echten EKG
  assert.ok(crossings("av3", 35, 0.08) - crossings("av3", 35, 0.7) >= 3);
  assert.equal(crossings("wenckebach", 60, 0.7), 6); // 8 P-Wellen, jede vierte nicht übergeleitet
  assert.equal(crossings("asystole", 0, 0.1), 0);
  assert.equal(crossings("paced", 70, 1.2), 7); // je Schlag ein Stimulationsspike
});

test("Kammerflimmern: unruhig, aber ohne regelmäßige R-Zacken", () => {
  const v = ecgValue("vf", 0, D);
  const ys = Array.from({ length: 6000 }, (_, i) => v(i / 1000));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const sd = Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length);
  assert.ok(sd > 0.2, `zu flach: ${sd}`);
  assert.ok(Math.max(...ys.map(Math.abs)) < 1.2);
});

test("Streifen wiederholt sich ohne Sprung", () => {
  for (const r of ["sinus", "af", "flutter", "vf", "av3", "wenckebach", "mobitz2", "pvc", "stemi"] as Rhythm[]) {
    const v = ecgValue(r, 75, D);
    for (const t of [0.001, 0.5, 2.3]) assert.ok(Math.abs(v(t) - v(t + D)) < 1e-6, `${r} springt bei ${t}`);
  }
});
