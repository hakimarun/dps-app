// Kompetenzprofil auf dem Gerät (ohne Konto): sammelt die Berichte aller Übungen und Fälle des Tages.
import { AXES, type HelperReport, type Skills, type Team } from "@dps/schema/protocol";

export type Profile = { seen: string[]; exercises: number; good: number; skills: Skills; badges: Record<string, number> };
export const EMPTY_PROFILE: Profile = { seen: [], exercises: 0, good: 0, skills: Object.fromEntries(AXES.map((x) => [x, { ok: 0, total: 0 }])) as Skills, badges: {} };

// Jede Übung zählt einmal (key = Server und Code), auch wenn der Bericht mehrfach ankommt.
export function record(p: Profile, key: string, r: { team: Team; me: HelperReport }): Profile {
  if (p.seen.includes(key)) return p;
  const skills = Object.fromEntries(AXES.map((x) => [x, { ok: p.skills[x].ok + (r.me.skills?.[x].ok ?? 0), total: p.skills[x].total + (r.me.skills?.[x].total ?? 0) }])) as Skills;
  const badges = { ...p.badges };
  for (const b of r.me.badges) badges[b] = (badges[b] ?? 0) + 1;
  return { seen: [...p.seen, key].slice(-200), exercises: p.exercises + 1, good: p.good + (r.team.stars >= 2 ? 1 : 0), skills, badges };
}

// Stufe: nach 3 Übungen mit mindestens 2 Sternen die nächste (Systementwurf, Gamification).
export const level = (p: Profile) => (p.good >= 6 ? "Experte" : p.good >= 3 ? "Fortgeschritten" : "Einsteiger");
export const toNext = (p: Profile) => (p.good >= 6 ? 0 : 3 - (p.good % 3));
