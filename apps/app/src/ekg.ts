// EKG-Kurven für den Monitor: aus Herzfrequenz und EKG-Befund des Falls (exam.ecg) entsteht ein
// Streifen, der sich nahtlos wiederholt. Stilisierte Kurven zum Erkennen des Musters, keine Diagnostik.
// Ohne React-Abhängigkeit, damit sie sich mit Node testen lässt.

export type Rhythm =
  | "sinus" | "paced" | "asystole" | "af" | "flutter" | "vf" | "vt" | "av1" | "wenckebach" | "mobitz2" | "av3" | "stemi" | "st-depression" | "pvc";

// Befundtext → Rhythmus; Reihenfolge wichtig (z. B. "Kammerflattern" vor "flattern").
export function rhythmOf(text: string): Rhythm {
  const t = text.toLowerCase();
  if (/asystolie|nulllinie/.test(t)) return "asystole";
  if (/schrittmacher/.test(t)) return "paced";
  if (/kammerflimmern|\bvf\b/.test(t)) return "vf";
  if (/kammerflattern|kammertachykardie|ventrikuläre tachykardie|\bvt\b/.test(t)) return "vt";
  if (/vorhofflimmern/.test(t)) return "af";
  if (/vorhofflattern/.test(t)) return "flutter";
  if (/av-block (iii|3)|totaler av-block/.test(t)) return "av3";
  if (/wenckebach|mobitz (i|1)\b/.test(t)) return "wenckebach";
  if (/mobitz (ii|2)/.test(t)) return "mobitz2";
  if (/av-block (i|1)\b/.test(t)) return "av1";
  if (/stemi|st-hebung/.test(t)) return "stemi";
  if (/st-senkung/.test(t)) return "st-depression";
  if (/ves|extrasystol/.test(t)) return "pvc";
  return "sinus";
}

const bump = (x: number, c: number, w: number, a: number) => a * Math.exp(-(((x - c) / w) ** 2));
const P = (x: number) => bump(x, 0, 0.025, 0.12); // P-Welle, x relativ zur P-Spitze in s
// Schmaler Kammerkomplex mit T-Welle, x relativ zur R-Zacke; st = ST-Verschiebung in mV.
const narrow = (x: number, st = 0) =>
  bump(x, -0.025, 0.008, -0.12) + bump(x, 0, 0.01, 1) + bump(x, 0.025, 0.01, -0.28) + bump(x, 0.24, 0.05, 0.26 + st * 0.6) +
  st / (1 + Math.exp(-(x - 0.05) / 0.01)) / (1 + Math.exp((x - 0.22) / 0.03));
// Breiter, deformierter Komplex (Kammerersatz, VT, VES) mit gegensinniger T-Welle.
const wide = (x: number) => bump(x, 0, 0.04, 1.1) + bump(x, 0.08, 0.04, -0.6) + bump(x, 0.3, 0.08, -0.35);

type Event = { t: number; shape: (x: number) => number };

// Gleichmäßig verteilte Zeitpunkte, so dass der Streifen periodisch bleibt.
const evenly = (n: number, d: number, offset = 0.15) => Array.from({ length: n }, (_, i) => offset + (i * d) / n);

export function ecgValue(rhythm: Rhythm, hr: number, d: number): (t: number) => number {
  const beats = Math.max(1, Math.round((d * (hr || 60)) / 60));
  const ev: Event[] = [];
  let wave: (t: number) => number = () => 0;
  const sinus = (st = 0, pr = 0.16) => evenly(beats, d).forEach((t) => ev.push({ t: t - pr, shape: P }, { t, shape: (x) => narrow(x, st) }));
  switch (rhythm) {
    case "asystole":
      wave = (t) => 0.015 * Math.sin((2 * Math.PI * 3 * t) / d);
      break;
    case "vf": // chaotische Wellen ohne Kammerkomplexe; nur Vielfache von 1/d, damit der Streifen nahtlos passt
      wave = (t) => [[23, 0.32, 0.4], [29, 0.22, 1.7], [31, 0.18, 2.9], [37, 0.14, 0.9], [7, 0.12, 2.2]]
        .reduce((s, [k, a, ph]) => s + a * Math.sin((2 * Math.PI * k * t) / d + ph), 0) * (0.75 + 0.25 * Math.sin((2 * Math.PI * 2 * t) / d));
      break;
    case "vt":
      evenly(beats, d).forEach((t) => ev.push({ t, shape: wide }));
      break;
    case "paced": // schmaler Stimulationsspike, danach breiter Kammerkomplex
      evenly(beats, d).forEach((t) => ev.push({ t: t - 0.04, shape: (x) => bump(x, 0, 0.0015, 1.4) }, { t, shape: wide }));
      break;
    case "af": { // keine P-Wellen, unregelmäßige Abstände, flimmernde Grundlinie
      const w = Array.from({ length: beats }, (_, i) => [0.7, 1.35, 0.9, 1.15, 0.8, 1.25, 1.0, 0.85][i % 8]);
      const sum = w.reduce((a, b) => a + b, 0);
      let t = 0.15;
      for (const x of w) (ev.push({ t, shape: (y) => narrow(y) }), (t += (d * x) / sum));
      wave = (t2) => 0.035 * Math.sin((2 * Math.PI * Math.round(d * 6) * t2) / d) + 0.02 * Math.sin((2 * Math.PI * Math.round(d * 8.5) * t2) / d);
      break;
    }
    case "flutter": { // Sägezahnwellen mit 300/min, Überleitung je nach Kammerfrequenz
      const f = Math.round((d * 300) / 60);
      const ratio = Math.max(2, Math.round(300 / (hr || 75)));
      wave = (t) => { const ph = ((t * f) / d) % 1; return -0.28 * (ph < 0.8 ? ph / 0.8 : (1 - ph) / 0.2) + 0.14; };
      evenly(Math.max(1, Math.round(f / ratio)), d).forEach((t) => ev.push({ t, shape: (x) => narrow(x) }));
      break;
    }
    case "av1":
      sinus(0, 0.3);
      break;
    case "wenckebach": { // PQ wird länger, bis eine Überleitung ausfällt (4:3)
      const atria = Math.max(4, Math.round((d * 80) / 60 / 4) * 4);
      evenly(atria, d).forEach((t, i) => {
        ev.push({ t, shape: P });
        if (i % 4 !== 3) ev.push({ t: t + 0.18 + (i % 4) * 0.08, shape: (x) => narrow(x) });
      });
      break;
    }
    case "mobitz2": // konstantes PQ, jede zweite P-Welle ohne Kammerkomplex
      evenly(beats * 2, d).forEach((t, i) => (ev.push({ t, shape: P }), i % 2 === 0 && ev.push({ t: t + 0.18, shape: (x) => narrow(x) })));
      break;
    case "av3": // Vorhöfe und Kammern unabhängig; langsamer breiter Ersatzrhythmus
      evenly(Math.round((d * 80) / 60), d, 0.05).forEach((t) => ev.push({ t, shape: P }));
      evenly(beats, d, 0.4).forEach((t) => ev.push({ t, shape: wide }));
      break;
    case "stemi":
      sinus(0.3);
      break;
    case "st-depression":
      sinus(-0.18);
      break;
    case "pvc": { // jeder vierte Schlag eine vorzeitige ventrikuläre Extrasystole mit Pause
      const n = Math.max(4, Math.round(beats / 4) * 4);
      evenly(n, d).forEach((t, i) => {
        if (i % 4 === 3) ev.push({ t: t - (0.3 * d) / n, shape: wide });
        else ev.push({ t: t - 0.16, shape: P }, { t, shape: (x) => narrow(x) });
      });
      break;
    }
    default:
      sinus();
  }
  // Ereignisse auch eine Periode früher und später, damit die Nahtstelle stimmt.
  return (t) => wave(t) + ev.reduce((s, e) => s + e.shape(t - e.t) + e.shape(t - e.t + d) + e.shape(t - e.t - d), 0);
}

// Streifen als Punkte: 1 px Auflösung, aber je Pixel der stärkste Ausschlag, damit schmale Zacken nicht verschwinden.
export function ecgStrip(rhythm: Rhythm, hr: number, d: number, pxPerS: number, height: number): [number, number][] {
  const v = ecgValue(rhythm, hr, d);
  const w = Math.round(d * pxPerS);
  const pts: [number, number][] = [];
  for (let x = 0; x <= w; x++) {
    let best = 0;
    for (let k = 0; k < 4; k++) {
      const y = v(((x + k / 4) / pxPerS) % d);
      if (Math.abs(y) > Math.abs(best)) best = y;
    }
    pts.push([x, Math.min(height - 2, Math.max(2, height * 0.65 - best * height * 0.45))]);
  }
  return pts;
}
