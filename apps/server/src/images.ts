// Patientenbilder mit einem lokalen Bildmodell: mflux mit FLUX.2 Klein 4B (Apache 2.0) auf Apple Silicon.
// Optional wie die KI: IMAGE_GEN=mflux, Pfad zum Programm über MFLUX_BIN. Der Bildtext des Falls bleibt maßgeblich;
// kleine Bildmodelle zeichnen Haltung und Umgebung gut, Verletzungsdetails aber unzuverlässig.
import { execFile } from "node:child_process";
import { randomInt } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// Fester Stil für Übungszettel; der deutsche Bildtext versteht das Modell direkt.
export const STYLE = "Flat vector illustration for a first aid training card, simple shapes, flat colors, light grey background, exactly one person, no text, no blood pools.";
export const imagePrompt = (picture: string) => `${STYLE} ${picture.trim()}`;

export type ImageGen = { name: string; generate(picture: string, out: string): Promise<void> };

export function mflux(bin: string): ImageGen {
  return {
    name: "mflux",
    async generate(picture, out) {
      const tmp = `${out}.tmp.png`; // erst nach Erfolg das alte Bild ersetzen
      try {
        await run(bin, [
          "--model", "flux2-klein-4b", "--steps", "4", "--width", "768", "--height", "768", "--seed", String(randomInt(1_000_000)),
          "-q", "8", "--low-ram", "--output", tmp, "--prompt", imagePrompt(picture),
        ], { timeout: 600_000 }); // erster Lauf lädt das Modell (~15 GB)
        await rename(tmp, out);
      } finally {
        await rm(tmp, { force: true });
      }
    },
  };
}

export function imageGenFromEnv(env: NodeJS.ProcessEnv = process.env): ImageGen | null {
  if (env.IMAGE_GEN !== "mflux") return null;
  return mflux(env.MFLUX_BIN ?? join(homedir(), ".local/bin/mflux-generate-flux2"));
}
