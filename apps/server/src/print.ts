// QR-Zettel als Druckseite: zwei A5-Zettel pro A4-Seite; "Drucken → Als PDF speichern" ergibt das PDF.
import QRCode from "qrcode";
import type { Exercise } from "./exercise.ts";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function printPage(ex: Exercise): Promise<string> {
  const qr = (text: string) => QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  const cards = await Promise.all(
    ex.scenario.patients.map(async (id) => `
      <section class="card">
        <h1>${id.toUpperCase()}</h1>
        <div class="qr">${await qr(`dps:${ex.code}:${id}`)}</div>
        <p>${esc(ex.defs.patients[id].picture)}</p>
        <footer>Übung ${ex.code} · nur in dieser Übung gültig · Nummer ohne Kamera: ${Number(id.slice(1))}</footer>
      </section>`),
  );
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>QR-Zettel ${ex.code}</title>
<style>
  @page { size: A4; margin: 0; }
  :root { color-scheme: light; }
  body { margin: 0; font: 16px/1.4 system-ui, sans-serif; color: #111; background: #fff; }
  .card { box-sizing: border-box; height: 148.5mm; padding: 12mm 18mm; border-bottom: 1px dashed #999; display: flex; flex-direction: column; align-items: center; break-inside: avoid; }
  h1 { margin: 0 0 4mm; font-size: 32pt; }
  .qr svg { width: 75mm; height: 75mm; }
  p { margin: 6mm 0 0; font-size: 13pt; text-align: center; max-width: 150mm; }
  footer { margin-top: auto; font-size: 9pt; color: #555; }
  .join h1 { font-size: 24pt; } .join .code { font-size: 48pt; font-weight: 700; letter-spacing: 4pt; margin: 10mm 0; }
  @media screen { .hint { padding: 12px 18px; background: #f2f2f2; } }
  @media print { .hint { display: none; } }
</style></head><body>
<div class="hint">Drucken oder „Als PDF speichern“ (Strg/Cmd + P). Zettel an der gestrichelten Linie trennen und auf dem Gelände verteilen.</div>
<section class="card join"><h1>${esc(ex.scenario.title)}</h1><div>Beitrittscode für die Helfer-App</div><div class="code">${ex.code}</div>
<p>${ex.scenario.patients.length} Patienten · Zettel nur für diese Übung</p></section>
${cards.join("")}
</body></html>`;
}
