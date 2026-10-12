// G10: KI-Vorschlag für den Feedbacktext je Helfer. Die Leitung prüft und ändert ihn, erst ihre Fassung kommt in den Bericht.
// Die KI bekommt nur Fakten aus Protokoll und Auswertung, keine Namen; sie spricht den Helfer mit "du" an.
import { z } from "zod";
import type { HelperReport } from "@dps/schema/protocol";
import type { Ai } from "./ai.ts";
import type { Exercise } from "./exercise.ts";

const Suggestion = z.object({ text: z.string().max(1200) });

const SYSTEM = `Du unterstützt Praxisanleiter im Rettungsdienst nach einer MANV-Übung mit simulierten Patienten.
Schreibe ein kurzes, konkretes Feedback an einen Helfer: 3 bis 6 Sätze auf Deutsch, Du-Form, wertschätzend und ehrlich.
Beginne mit dem, was gut war, nenne dann höchstens zwei Punkte für das nächste Mal, jeweils mit Zeitpunkt oder Patient.
Gehe auf die Gesprächsführung ein, wenn Gespräche vorliegen: Hat sich der Helfer vorgestellt, offen gefragt, beruhigt, nach Schmerzen und Vorgeschichte gefragt?
Verwende nur die gelieferten Fakten. Erfinde keine Maßnahmen, Zeiten oder Befunde. Keine Namen, keine Punktzahlen.`;

const mmss = (t: number) => { const s = Math.round(t * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

export function feedbackFacts(ex: Exercise, helper: string, r: HelperReport): string {
  const own = ex.records.filter((x) => "participant" in x.event && x.event.participant === helper);
  const A = ex.defs.actions;
  const actions = own.flatMap((x) => {
    const e = x.event;
    if (e.type === "start") return [`${mmss(x.t)} ${A[e.action]?.title ?? e.action} an ${e.patient.toUpperCase()}`];
    if (e.type === "triage") return [`${mmss(x.t)} Sichtung ${e.patient.toUpperCase()}: ${e.sk}`];
    if (e.type === "handover") return [`${mmss(x.t)} Übergabe ${e.patient.toUpperCase()} (Verdacht: ${e.diagnosis || "keiner angegeben"})`];
    if (e.type === "scan") return [`${mmss(x.t)} Erstkontakt ${e.patient.toUpperCase()}`];
    return [];
  });
  const talks = own.flatMap((x) => (x.event.type === "ask" ? [`${x.event.patient.toUpperCase()} – Helfer: „${x.event.question}“ – Patient: „${x.event.answer}“`] : []));
  const list = (title: string, xs: string[]) => (xs.length ? `${title}:\n${xs.map((x) => `- ${x}`).join("\n")}` : `${title}: keine`);
  return [
    list("Gut gelaufen (aus der Auswertung)", r.good),
    list("Verbesserung (aus der Auswertung)", r.improve),
    list("Beobachtungen der Ausbilder", r.notes),
    list("Eigene Aktionen mit Zeit (Minuten:Sekunden)", actions.slice(0, 60)),
    list("Gespräche mit Patienten", talks.slice(-20)),
  ].join("\n\n");
}

export async function suggestFeedback(ai: Ai, ex: Exercise, helper: string, r: HelperReport): Promise<string> {
  const { text } = await ai.json("generator", SYSTEM, feedbackFacts(ex, helper, r), Suggestion, 1500);
  return text.trim();
}
