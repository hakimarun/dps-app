// QR-Inhalt "dps:<CODE>:<ID>" (gilt nur für diese Übung), Nummer "1" / "P01" für Musterfälle
// oder die gedruckte ID eigener und KI-Fälle ("EIGEN-71A2FC", "KI-1A2B3C").
export function parseScan(raw: string, code: string): { id: string } | { error: string } {
  const t = raw.trim().toLowerCase();
  const qr = t.match(/^dps:([a-z0-9]{6}):([a-z0-9-]{1,64})$/);
  if (qr) return qr[1] === code.toLowerCase() ? { id: qr[2] } : { error: "QR-Code gehört zu einer anderen Übung" };
  const n = t.match(/^p?(\d{1,3})$/);
  if (n) return { id: `p${n[1].padStart(2, "0")}` };
  if (/^[a-z]+-[a-z0-9]{4,}$/.test(t) || /^[a-z]+\d{1,4}(-\d{1,3})?$/.test(t)) return { id: t }; // auch "I011" und Mehrfachkarten "I011-2"
  return { error: "kein Patienten-Code" };
}
