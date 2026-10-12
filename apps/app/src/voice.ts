// Stimme passend zur Persona (G6): aus dem Bildtext des Falls ("Junge Frau, ca. 25 Jahre", "Kind", "älterer Mann").
// Ohne React-Abhängigkeit, damit sie sich mit Node testen lässt.
export type Voice = { female: boolean | null; pitch: number; rate: number };

export function voiceFor(picture: string): Voice {
  const p = picture.toLowerCase();
  const female = /\b(frau|mädchen|mutter|seniorin|schwangere|patientin|rentnerin|sie)\b/.test(p) ? true : /\b(mann|junge|vater|senior|rentner|er)\b/.test(p) ? false : null;
  const age = Number(p.match(/(\d{1,3})\s*jahre/)?.[1] ?? (/\b(kind|mädchen|junge)\b/.test(p) && !/junge frau|junger mann/.test(p) ? 8 : /älter|senior|rentner|greis/.test(p) ? 78 : 40));
  const child = age < 14;
  const old = age >= 70;
  return {
    female,
    pitch: child ? 1.5 : female ? 1.15 : female === false ? 0.85 : 1,
    rate: old ? 0.85 : child ? 1.05 : 1,
  };
}
