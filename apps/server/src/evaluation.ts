// Auswertung einer Übung aus dem Protokoll: Team-Sterne, Kennzahlen, Punkte, Abzeichen, Bericht je Helfer.
// Punktewerte nach der Punktetabelle im Systementwurf (Startwerte, im Pilot kalibrieren).
import type { Sk } from "@dps/schema";
import type { Evaluation, HelperReport, Role, Team } from "@dps/schema/protocol";
import { phaseDef, targetSk, type Event } from "@dps/engine";
import { minutes, released, roleOf, stateAt, truppOf, type Exercise, type Rec } from "./exercise.ts";

const POINTS = { criticalTimely: 15, criticalLate: 5, triageCorrect: 10, triageCorrection: 8, overOne: 3, under: -10, harmful: -10, calm: 5, deadPatient: -5, handoverComplete: 5 };
const RANK: Record<Sk, number> = { EX: 0, IV: 1, III: 2, II: 3, I: 4 };
const SCARCE = ["tourniquet", "pelvic_binder", "needle", "wendl", "ett"];
const fmt = (min: number) => `${Math.floor(min)}:${String(Math.round((min % 1) * 60)).padStart(2, "0")}`;

type Acc = { report: HelperReport; good: [number, string][]; improve: [number, string][]; patients: Set<string>; badges: Set<string>; scarce: { used: boolean; wasted: boolean } };

const cache = new WeakMap<Exercise, { key: string; ev: Evaluation }>();

export function evaluate(ex: Exercise, now: number): Evaluation {
  const t = minutes(ex, now);
  const key = `${ex.records.length}/${ex.controls.length}/${Math.floor(t)}`;
  const hit = cache.get(ex);
  if (hit?.key === key) return hit.ev;
  const ev = compute(ex, t);
  cache.set(ex, { key, ev });
  return ev;
}

function compute(ex: Exercise, T: number): Evaluation {
  const end = stateAt(ex, T);
  const P = ex.defs.patients;
  const A = ex.defs.actions;
  const scale = ex.settings.phaseMinutes / 15;
  const title = (a: string) => A[a]?.title ?? (a === "handover" ? "Übergabe zum Abtransport" : a);
  const at = (r: Rec) => stateAt(ex, r.t); // Zustand zum Zeitpunkt einer Aktion
  const acc = new Map<string, Acc>();
  for (const [id, h] of Object.entries(end.participants))
    acc.set(id, {
      report: { id, name: ex.names.get(id) ?? "?", unit: ex.scenario.units.find((u) => u.id === h.unit)?.title ?? h.unit, points: 0, badges: [], patients: 0, actions: 0, triages: 0, busyShare: 0, good: [], improve: [] },
      good: [], improve: [], patients: new Set(), badges: new Set(), scarce: { used: false, wasted: false },
    });
  const add = (who: string, pts: number, good?: string, improve?: [number, string]) => {
    const a = acc.get(who);
    if (!a) return;
    a.report.points += pts;
    if (good) a.good.push([pts, good]);
    if (improve) a.improve.push(improve);
  };

  const recs = ex.records;
  const ofType = <K extends Event["type"]>(k: K) => recs.filter((r): r is Rec & { event: Extract<Event, { type: K }> } => r.event.type === k);
  const starts = ofType("start");
  const triages = ofType("triage");
  const handovers = ofType("handover");
  for (const r of [...ofType("scan"), ...starts, ...triages, ...ofType("admit"), ...handovers]) acc.get(r.event.participant)?.patients.add(r.event.patient);

  // Kritische Maßnahmen je Patient: rechtzeitig, zu spät oder verpasst.
  const critical = { timely: 0, late: 0, missed: 0 };
  const missedByPatient = new Map<string, string[]>();
  for (const id of ex.scenario.patients) {
    for (const c of P[id].scoring.critical) {
      const deadline = c.within * scale;
      const names = c.actions.map(title).join(" oder ");
      const done = [
        ...starts
          .filter((r) => r.event.patient === id && c.actions.includes(r.event.action))
          // erledigt: abgeschlossen (steht in done) oder dauerhafte Maßnahme, die ab Start wirkt
          .filter((r) => A[r.event.action].minutes === null || end.patients[id].done.includes(r.event.action))
          .map((r) => ({ who: r.event.participant, action: r.event.action, at: r.t + (A[r.event.action].minutes ?? 0) })),
        ...(c.actions.includes("handover") ? handovers.filter((r) => r.event.patient === id).map((r) => ({ who: r.event.participant, action: "handover", at: r.t })) : []),
      ]
        .filter((x) => x.at <= T)
        .sort((a, b) => a.at - b.at)[0];
      if (done && done.at <= deadline) {
        critical.timely++;
        add(done.who, POINTS.criticalTimely, `${names} an ${id.toUpperCase()} rechtzeitig (${fmt(done.at)} min)`);
        if (done.action === "tourniquet") acc.get(done.who)?.badges.add("Blutstiller");
        if (done.action === "airway_open") acc.get(done.who)?.badges.add("Freier Atemweg");
      } else if (done) {
        critical.late++;
        add(done.who, POINTS.criticalLate, undefined, [2, `${names} an ${id.toUpperCase()} erst nach ${fmt(done.at)} min (Soll: bis ${fmt(deadline)} min)`]);
      } else if (deadline <= T) {
        critical.missed++;
        missedByPatient.set(id, [...(missedByPatient.get(id) ?? []), names]);
        for (const a of acc.values())
          if (a.patients.has(id)) a.improve.push([3, `${names} an ${id.toUpperCase()} fehlte (Soll: bis ${fmt(deadline)} min)`]);
      }
    }
  }

  // Sichtung: jede Sichtung gegen die Soll-SK zum Zeitpunkt; zusätzlich je Trupp-Funktion (separate Sichtung).
  const triageByRole: Evaluation["triageByRole"] = { sichtung: { correct: 0, over: 0, under: 0 }, behandlung: { correct: 0, over: 0, under: 0 }, transport: { correct: 0, over: 0, under: 0 } };
  const firstTriage = new Map<string, { t: number; result: "korrekt" | "übertriage" | "untertriage" }>();
  const lastSk = new Map<string, Sk>();
  for (const r of triages) {
    const { participant: who, patient: id, sk } = r.event;
    const target = targetSk(at(r), id);
    const prev = lastSk.get(id);
    const result = sk === target ? "korrekt" : RANK[sk] > RANK[target] ? "übertriage" : "untertriage";
    if (!firstTriage.has(id)) firstTriage.set(id, { t: r.t, result });
    triageByRole[roleOf(ex, who)][result === "korrekt" ? "correct" : result === "übertriage" ? "over" : "under"]++;
    if (result === "korrekt" && prev && RANK[prev] < RANK[target]) {
      add(who, POINTS.triageCorrection, `${id.toUpperCase()} nachgesichtet und Untertriage korrigiert`);
      acc.get(who)?.badges.add("Scharfblick");
    } else if (result === "korrekt") add(who, POINTS.triageCorrect, `${id.toUpperCase()} richtig gesichtet (${target})`);
    else if (result === "übertriage") add(who, RANK[sk] - RANK[target] === 1 ? POINTS.overOne : 0);
    else add(who, POINTS.under, undefined, [3, `${id.toUpperCase()} als ${sk} gesichtet, Soll war ${target}`]);
    lastSk.set(id, sk);
  }

  // Maßnahmen: schädlich, beruhigt, bei Toten, knappes Material.
  for (const r of starts) {
    const { participant: who, patient: id, action } = r.event;
    const a = acc.get(who);
    if (!a) continue;
    a.report.actions++;
    const s = at(r);
    if (P[id].scoring.harmful.includes(action)) add(who, POINTS.harmful, undefined, [3, `${title(action)} bei ${id.toUpperCase()} schadet`]);
    if (action === "calm" && /panisch|aggressiv/.test(String(P[id].profile.temperament ?? ""))) {
      add(who, POINTS.calm, `${id.toUpperCase()} beruhigt`);
      a.badges.add("Ruhepol");
    }
    if (phaseDef(s, id).dead && action !== "transport") add(who, POINTS.deadPatient, undefined, [1, `Zeit an verstorbenem Patienten ${id.toUpperCase()} gebunden`]);
    if (Object.keys(A[action].material).some((m) => SCARCE.includes(m))) {
      a.scarce.used = true;
      if (["III", "EX"].includes(targetSk(s, id))) a.scarce.wasted = true;
    }
  }

  // Übergabe: Vollständigkeit und Transportreihenfolge.
  const handoverInfo = new Map<string, { t: number; vehicle: string; destination: string; missing: string[] }>();
  for (const r of handovers) {
    const { participant: who, patient: id, vehicle, destination, diagnosis } = r.event;
    const s = at(r);
    const done = s.patients[id].done;
    const missing = [
      ...(s.patients[id].triage ? [] : ["Sichtungskategorie"]),
      ...(diagnosis.trim() ? [] : ["Verdacht"]),
      ...(done.includes("measure_bp") ? [] : ["Blutdruck"]),
      ...(done.includes("pulse_oximetry") ? [] : ["SpO₂"]),
      ...P[id].scoring.critical.filter((c) => !c.actions.includes("handover") && !c.actions.some((a) => done.includes(a))).map((c) => c.actions.map(title).join(" oder ")),
    ];
    handoverInfo.set(id, { t: r.t, vehicle: ex.scenario.units.find((u) => u.id === vehicle)?.title ?? vehicle, destination, missing });
    if (!missing.length) add(who, POINTS.handoverComplete, `Übergabe von ${id.toUpperCase()} vollständig`);
    else add(who, 0, undefined, [2, `Übergabe ${id.toUpperCase()} ohne: ${missing.join(", ")}`]);
    // Transportreihenfolge: kein dringenderer Patient mit Kontakt darf noch warten.
    const tgt = targetSk(s, id);
    const waiting = ex.scenario.patients.find((q) => {
      const qs = s.patients[q];
      const contacted = recs.some((x) => x.t <= r.t && "patient" in x.event && x.event.patient === q);
      return q !== id && contacted && !qs.left && !phaseDef(s, q).dead && RANK[targetSk(s, q)] > RANK[tgt];
    });
    if (waiting) add(who, 0, undefined, [2, `${id.toUpperCase()} (Soll ${tgt}) vor ${waiting.toUpperCase()} (Soll ${targetSk(s, waiting)}) abtransportiert`]);
  }

  // Auslastung: Zeit in Maßnahmen geteilt durch Zeit seit Beitritt.
  for (const [id, a] of acc) {
    const joinedAt = recs.find((r) => r.event.type === "join" && r.event.participant === id)?.t ?? 0;
    let busy = 0;
    for (const r of starts.filter((x) => x.event.participant === id)) {
      const m = A[r.event.action].minutes;
      const stop = m !== null ? r.t + m : recs.find((x) => x.t >= r.t && x.event.type === "end" && x.event.participant === id)?.t ?? T;
      busy += Math.min(stop, T) - r.t;
    }
    a.report.busyShare = T > joinedAt ? Math.min(1, busy / (T - joinedAt)) : 0;
    a.report.triages = triages.filter((r) => r.event.participant === id).length;
    a.report.patients = a.patients.size;
    if (a.scarce.used && !a.scarce.wasted) a.badges.add("Ressourcenprofi");
    a.report.badges = [...a.badges];
    a.report.good = a.good.sort((x, y) => y[0] - x[0]).slice(0, 3).map((g) => g[1]);
    a.report.improve = [...new Map(a.improve.map((i) => [i[1], i])).values()].sort((x, y) => y[0] - x[0]).slice(0, 3).map((i) => i[1]);
  }

  // Ergebnis je Patient und Team-Sterne.
  const patients = ex.scenario.patients.map((id) => {
    const ph = phaseDef(end, id);
    const deadAtStart = !!P[id].phases[P[id].start].dead;
    const outcome = ph.dead ? (deadAtStart ? "tot aufgefunden" : "verstorben") : ph.left || end.patients[id].left ? "abtransportiert" : "vor Ort";
    const contact = recs.find((r) => "patient" in r.event && r.event.patient === id)?.t ?? null;
    return { id, title: P[id].title, firstContact: contact, firstTriage: firstTriage.get(id)?.t ?? null, triage: firstTriage.get(id)?.result ?? null, outcome, missed: missedByPatient.get(id) ?? [], handover: handoverInfo.get(id) ?? null } as const;
  });
  const eligible = patients.filter((p) => p.outcome !== "tot aufgefunden").length;
  const survived = eligible - patients.filter((p) => p.outcome === "verstorben").length;
  const rate = eligible ? survived / eligible : 1;
  const totalCrit = critical.timely + critical.late + critical.missed;
  const critRate = totalCrit ? critical.timely / totalCrit : 1;
  const stars: Team["stars"] = rate === 1 && critRate >= 0.8 ? 3 : rate >= 0.75 && critRate >= 0.5 ? 2 : rate >= 0.5 ? 1 : 0;
  const tri = { correct: 0, over: 0, under: 0 };
  for (const f of firstTriage.values()) tri[f.result === "korrekt" ? "correct" : f.result === "übertriage" ? "over" : "under"]++;

  const helpers = [...acc.values()].map((a) => a.report).sort((x, y) => y.points - x.points);
  const trupps = ex.trupps!.map((tr) => {
    const members = helpers.filter((h) => truppOf(ex, h.id)?.code === tr.code);
    return { code: tr.code, name: tr.name, role: tr.role as Role, points: members.reduce((sum, h) => sum + h.points, 0), members: members.map((h) => h.name) };
  });
  return {
    released: released(ex), t: T, team: { stars, survived, eligible }, critical, triage: tri,
    patients: patients.map((p) => ({ ...p })), helpers, trupps, triageByRole,
  };
}
