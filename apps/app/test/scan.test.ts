import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScan } from "../src/scan.ts";

test("Scan: QR-Codes, Nummern und IDs eigener Fälle", () => {
  assert.deepEqual(parseScan("dps:ABC123:p07", "abc123"), { id: "p07" });
  assert.deepEqual(parseScan("dps:ABC123:eigen-71a2fc", "ABC123"), { id: "eigen-71a2fc" });
  assert.deepEqual(parseScan("dps:XYZ999:p07", "ABC123"), { error: "QR-Code gehört zu einer anderen Übung" });
  assert.deepEqual(parseScan("7", "ABC123"), { id: "p07" });
  assert.deepEqual(parseScan(" P12 ", "ABC123"), { id: "p12" });
  assert.deepEqual(parseScan("EIGEN-71A2FC", "ABC123"), { id: "eigen-71a2fc" });
  assert.deepEqual(parseScan("dps:ABC123", "ABC123"), { error: "kein Patienten-Code" }); // Beitritts-QR, kein Patient
  assert.deepEqual(parseScan("hallo", "ABC123"), { error: "kein Patienten-Code" });
});
