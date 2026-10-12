// Serie beim Fall des Tages: zählt Tage am Stück, an denen ein Fall abgeschlossen wurde.
// Pausieren (Urlaub, Schichtblock) hält die Serie an, bis wieder geübt wird. Liegt nur auf dem Gerät.
export type Streak = { last: string | null; days: number; paused: boolean };
export const EMPTY: Streak = { last: null, days: 0, paused: false };

const pad = (n: number) => String(n).padStart(2, "0");
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const yesterday = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

// Stand heute: ohne Pause reißt die Serie, wenn gestern nicht geübt wurde.
export const current = (s: Streak, today: string) => (s.paused || s.last === today || s.last === yesterday(today) ? s.days : 0);

// Heute abgeschlossen: mehrfach am Tag zählt einmal.
export function complete(s: Streak, today: string): Streak {
  if (s.last === today) return s;
  const days = current(s, today) > 0 ? s.days + 1 : 1;
  return { last: today, days, paused: false };
}
