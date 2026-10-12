// Bilderzeugung mit einem Ersatzprogramm statt mflux: Aufruf, Ausgabe, Fehlerfall.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STYLE, imageGenFromEnv, mflux } from "../src/images.ts";

// Schreibt seine Argumente als JSON in die Ausgabedatei; mit FAIL im Prompt bricht es ab.
function fakeBin(dir: string) {
  const bin = join(dir, "fake-mflux");
  writeFileSync(bin, `#!/usr/bin/env node
const a = process.argv.slice(2);
if (a[a.indexOf("--prompt") + 1].includes("FAIL")) process.exit(1);
require("node:fs").writeFileSync(a[a.indexOf("--output") + 1], JSON.stringify(a));
`);
  chmodSync(bin, 0o755);
  return bin;
}

test("Bild: mflux bekommt Modell, Größe und Stil plus deutschen Bildtext", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dps-img-"));
  const out = join(dir, "p12.png");
  await mflux(fakeBin(dir)).generate("Junge Frau sitzt am Straßenrand.", out);
  const args = JSON.parse(readFileSync(out, "utf8")) as string[];
  assert.equal(args[args.indexOf("--model") + 1], "flux2-klein-4b");
  assert.equal(args[args.indexOf("--width") + 1], "768");
  assert.equal(args[args.indexOf("--prompt") + 1], `${STYLE} Junge Frau sitzt am Straßenrand.`);
  assert.deepEqual(readdirSync(dir).filter((f) => f.includes("tmp")), []);
});

test("Bild: Fehler lässt das alte Bild stehen, ohne Reste", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dps-img-"));
  const out = join(dir, "p07.png");
  writeFileSync(out, "altes Bild");
  await assert.rejects(mflux(fakeBin(dir)).generate("FAIL", out));
  assert.equal(readFileSync(out, "utf8"), "altes Bild");
  assert.ok(!existsSync(`${out}.tmp.png`));
});

test("Bild: nur mit IMAGE_GEN=mflux eingeschaltet", () => {
  assert.equal(imageGenFromEnv({}), null);
  assert.equal(imageGenFromEnv({ IMAGE_GEN: "mflux" })?.name, "mflux");
});
