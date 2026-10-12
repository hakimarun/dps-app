// QR-Zettel als Druckseite: zwei A5-Zettel pro A4-Seite; "Drucken → Als PDF speichern" ergibt das PDF.
import QRCode from "qrcode";
import { AXES, ROLE_TASK, type Axis, type Evaluation, type HelperReport } from "@dps/schema/protocol";
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
        <footer>Übungspatient · Übung ${ex.code} · nur in dieser Übung gültig · ohne Kamera eintippen: ${/^p\d+$/.test(id) ? Number(id.slice(1)) : id.toUpperCase()}</footer>
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
<div class="hint">Drucken oder „Als PDF speichern“ (Strg/Cmd + P). Zettel an der gestrichelten Linie trennen und auf dem Gelände verteilen. Übungsmaterial – nicht im Realeinsatz verwenden.</div>
<section class="card join"><h1>${esc(ex.scenario.title)}</h1><div>Beitrittscode für die Helfer-App</div><div class="code">${ex.code}</div>
<p>${ex.scenario.patients.length} Patienten · Zettel nur für diese Übung</p></section>
${ex.trupps!.map((tr) => `<section class="card join"><h1>${esc(tr.name)}</h1><div>${esc(ex.scenario.units.find((u) => u.id === tr.unit)?.title ?? tr.unit)} · ${ROLE_TASK[tr.role]}</div><div class="code">${tr.code}</div>
<p>Diesen Code in der Helfer-App eingeben: Trupp, Einheit und Funktion sind dann schon gesetzt.</p></section>`).join("")}
${cards.join("")}
</body></html>`;
}

// F6: Bericht der Übung als Druckseite ("Als PDF speichern"): Team, Kennzahlen, Patienten, Helfer und das ganze Protokoll.
// Enthält Namen und Leistungen, darum nur mit Anmeldung der Leitung abrufbar.
export function reportPage(ex: Exercise, ev: Evaluation, events: { t: number; text: string }[]): string {
  const m = (t: number | null) => { if (t === null) return "–"; const s = Math.round(t * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const li = (items: string[]) => (items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  const AX: Record<Axis, string> = { sichtung: "Sichtung", blutung: "Blutung", atemweg: "Atemweg", kommunikation: "Kommunikation", ressourcen: "Ressourcen" };
  const skills = (s: HelperReport["skills"]) => AXES.filter((x) => s[x].total).map((x) => `${AX[x]} ${s[x].ok}/${s[x].total}`).join(" · ");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Bericht ${ex.code}</title>
<style>
  @page { size: A4; margin: 15mm; }
  :root { color-scheme: light; }
  body { margin: 0 auto; max-width: 180mm; font: 11pt/1.45 system-ui, sans-serif; color: #111; background: #fff; padding: 0 4mm; }
  h1 { font-size: 20pt; margin: 6mm 0 1mm; } h2 { font-size: 14pt; margin: 7mm 0 2mm; border-bottom: 2px solid #46178F; }
  .meta { color: #555; } .stars { font-size: 22pt; color: #C9A400; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; vertical-align: top; padding: 1.5mm 2mm; border-bottom: 1px solid #ddd; }
  th { font-size: 9pt; color: #555; } .helper { break-inside: avoid; margin-bottom: 4mm; } ul { margin: 1mm 0; padding-left: 5mm; }
  .log td:first-child { width: 14mm; font-variant-numeric: tabular-nums; }
  @media screen { .hint { padding: 12px 18px; background: #f2f2f2; margin: 0 -4mm; } }
  @media print { .hint { display: none; } }
</style></head><body>
<div class="hint">Drucken oder „Als PDF speichern“ (Strg/Cmd + P).</div>
<h1>${esc(ex.scenario.title)}</h1>
<div class="meta">Übung ${ex.code} · ${new Date(ex.created).toLocaleDateString("de-DE")} · Dauer ${m(ev.t)} min · ${ex.scenario.patients.length} Patienten · ${ev.helpers.length} Helfer · Algorithmus ${esc(ex.settings.algorithm)}</div>
<h2>Team</h2>
<div class="stars">${"★".repeat(ev.team.stars)}${"☆".repeat(3 - ev.team.stars)}</div>
<p>${ev.team.survived} von ${ev.team.eligible} Patienten überlebt · kritische Maßnahmen: ${ev.critical.timely} rechtzeitig, ${ev.critical.late} zu spät, ${ev.critical.missed} verpasst ·
erste Sichtung: ${ev.triage.correct} korrekt, ${ev.triage.over} Übertriage, ${ev.triage.under} Untertriage</p>
${ev.trupps.length ? `<p>${ev.trupps.map((tr) => `${esc(tr.name)}: ${tr.points} Punkte (${tr.members.map(esc).join(", ") || "ohne Mitglieder"})`).join("<br>")}</p>` : ""}
<h2>Patienten</h2>
<table><tr><th>Patient</th><th>Ergebnis</th><th>Erstkontakt</th><th>Sichtung</th><th>Übergabe</th></tr>
${ev.patients.map((p) => `<tr><td><b>${p.id.toUpperCase()}</b> ${esc(p.title)}${p.missed.length ? `<br><small>verpasst: ${esc(p.missed.join(", "))}</small>` : ""}</td>
<td>${p.outcome}</td><td>${m(p.firstContact)}</td><td>${m(p.firstTriage)}${p.triage ? ` (${p.triage})` : ""}</td>
<td>${p.handover ? `${m(p.handover.t)} ${esc(p.handover.vehicle)} → ${esc(p.handover.destination)}${p.handover.missing.length ? `<br><small>fehlte: ${esc(p.handover.missing.join(", "))}</small>` : ""}` : "–"}</td></tr>`).join("")}
</table>
<h2>Helfer</h2>
${ev.helpers.map((h) => `<div class="helper"><b>${esc(h.name)}</b> (${esc(h.unit)}) · ${h.points} Punkte · ${Math.round(h.busyShare * 100)} % in Maßnahmen${h.badges.length ? ` · ${h.badges.map(esc).join(", ")}` : ""}
${skills(h.skills) ? `<div class="meta">${skills(h.skills)}</div>` : ""}
${h.feedback ? `<p><i>Rückmeldung:</i> ${esc(h.feedback)}</p>` : ""}${h.good.length ? `Gut gelaufen:${li(h.good)}` : ""}${h.improve.length ? `Nächstes Mal:${li(h.improve)}` : ""}${h.notes.length ? `Beobachtet:${li(h.notes)}` : ""}</div>`).join("") || "<p>keine Helfer</p>"}
<h2>Protokoll</h2>
<table class="log">${events.map((e) => `<tr><td>${m(e.t)}</td><td>${esc(e.text)}</td></tr>`).join("")}</table>
</body></html>`;
}
