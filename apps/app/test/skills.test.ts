import { test } from "node:test";
import assert from "node:assert/strict";
import type { HelperReport, Team } from "@dps/schema/protocol";
import { EMPTY_PROFILE, level, record, toNext } from "../src/skills.ts";

const zero = { ok: 0, total: 0 };
const report = (stars: Team["stars"], sichtung = { ok: 1, total: 2 }) => ({
  team: { stars, survived: 1, eligible: 1 },
  me: { badges: ["Blutstiller"], skills: { sichtung, blutung: { ok: 1, total: 1 }, atemweg: zero, kommunikation: zero, ressourcen: zero } } as unknown as HelperReport,
});

test("Profil: summiert Achsen und Abzeichen, jede Übung einmal, Stufe nach 3 guten Übungen", () => {
  let p = record(EMPTY_PROFILE, "a", report(3));
  assert.equal(record(p, "a", report(3)), p); // doppelt angekommen
  p = record(p, "b", report(1, { ok: 2, total: 2 }));
  assert.deepEqual(p.skills.sichtung, { ok: 3, total: 4 });
  assert.equal(p.badges.Blutstiller, 2);
  assert.equal(p.exercises, 2);
  assert.equal(level(p), "Einsteiger");
  assert.equal(toNext(p), 2);
  p = record(record(p, "c", report(2)), "d", report(3));
  assert.equal(level(p), "Fortgeschritten");
});
