// Formular-Editor: Ein Fall übersteht Laden → Formular → Speichern unverändert (bis auf Felder, die das Formular nicht kennt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { Patient } from "@dps/schema";
import { EMPTY, fromPatient, toPatient } from "../src/caseform.ts";

const dir = new URL("../../../library/patients/", import.meta.url);
const cases = readdirSync(dir).map((f) => Patient.parse(JSON.parse(readFileSync(new URL(f, dir), "utf8"))));
// Leere Texte schreibt das Formular als "", fehlende Profilfelder sind also gleichwertig zu "".
const comparable = (p: Patient) => ({ ...p, profile: { ...p.profile, temperament: p.profile.temperament ?? "", pitfall: p.profile.pitfall ?? "", anamnesis: p.profile.anamnesis ?? {} } });

test("Rundlauf: alle Musterfälle bleiben nach Formular und Zurückwandeln gleich, samt Quellen im Profil", () => {
  assert.ok(cases.length >= 13);
  for (const p of cases) {
    const back = Patient.parse({ ...toPatient(fromPatient(p)), id: p.id, version: p.version });
    assert.deepEqual(comparable(back), comparable(p), p.id);
  }
});

test("Neuer Fall: leere Felder fallen weg, Zahlen werden Zahlen, unveränderte Phasenwerte bleiben weg", () => {
  const form = structuredClone(EMPTY);
  form.title = "Test";
  form.picture = "Mann liegt am Boden.";
  form.nums.rr = "28";
  form.nums.temp = "36,8";
  form.phases[0].nums = { hr: "120", rr: "" };
  form.phases[0].bools = { walking: "nein", stridor: "" };
  const p = Patient.parse(toPatient(form));
  assert.equal(p.base.rr, 28);
  assert.equal(p.base.temp, 36.8);
  assert.deepEqual(p.phases["1"].findings, { hr: 120, walking: false });
  assert.deepEqual(p.base.exam, {});
});
