import { test } from "node:test";
import assert from "node:assert/strict";
import { voiceFor } from "../src/voice.ts";

test("Stimme aus dem Bildtext: Geschlecht, Kind und hohes Alter", () => {
  assert.deepEqual(voiceFor("Junge Frau, ca. 25 Jahre, sitzt am Straßenrand"), { female: true, pitch: 1.15, rate: 1 });
  assert.deepEqual(voiceFor("Mann, ca. 60 Jahre, liegt auf dem Rücken"), { female: false, pitch: 0.85, rate: 1 });
  assert.equal(voiceFor("Kind, etwa 7 Jahre, weint").pitch, 1.5);
  assert.equal(voiceFor("Älterer Mann, ca. 82 Jahre, verwirrt").rate, 0.85);
  assert.equal(voiceFor("Person liegt im Gang").female, null);
});
