import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, complete, current } from "../src/streak.ts";

test("Serie: Tage am Stück, einmal je Tag, reißt ohne Pause, hält mit Pause", () => {
  let s = complete(EMPTY, "2026-10-12");
  assert.equal(s.days, 1);
  assert.equal(complete(s, "2026-10-12").days, 1); // zweimal am selben Tag
  s = complete(s, "2026-10-13");
  assert.equal(s.days, 2);
  assert.equal(current(s, "2026-10-14"), 2); // heute noch offen
  assert.equal(current(s, "2026-10-15"), 0); // gestern ausgelassen
  assert.equal(complete(s, "2026-10-15").days, 1);
  const paused = { ...s, paused: true };
  assert.equal(current(paused, "2026-10-20"), 2);
  assert.deepEqual(complete(paused, "2026-10-20"), { last: "2026-10-20", days: 3, paused: false });
  assert.equal(complete(EMPTY, "2027-01-01").days, 1);
  assert.equal(current(complete(EMPTY, "2026-12-31"), "2027-01-01"), 1); // Jahreswechsel
});
