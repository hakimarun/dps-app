// F4/F6: Nach der Übung Minute für Minute nachspielen (Debriefing) und das Ereignisprotokoll als CSV mitnehmen.
import { useEffect, useState } from "react";
import { Platform, Pressable, Share, Text, View } from "react-native";
import type { Sk } from "@dps/schema";
import { Button, Card, Sheet, clock, skColor, type Theme } from "./ui";
import { api, httpBase, type Session } from "./api";

type Frame = { t: number; patients: { id: string; phase: string; triage: Sk | null; target: Sk; place: string; dead: boolean; left: boolean }[] };
type Replay = {
  code: string; title: string; end: number; patients: { id: string; title: string }[]; frames: Frame[];
  events: { t: number; text: string }[];
};

export function ReplaySheet({ t, session, code, onClose }: { t: Theme; session: Session; code: string; onClose: () => void }) {
  const [r, setR] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => void api<Replay>(session, `/api/exercises/${code}/replay`).then(setR, (e: Error) => setError(e.message)), [code]);
  const last = (r?.frames.length ?? 1) - 1;
  useEffect(() => {
    if (!playing) return;
    if (i >= last) return setPlaying(false);
    const h = setTimeout(() => setI(i + 1), 700);
    return () => clearTimeout(h);
  }, [playing, i, last]);
  if (!r) return <Sheet t={t} title={`Replay ${code}`} onClose={onClose}><Text style={{ color: error ? t.red : t.quiet }}>{error ?? "lade …"}</Text></Sheet>;
  const f = r.frames[i];
  const title = (id: string) => r.patients.find((p) => p.id === id)?.title ?? "";
  const shown = r.events.filter((e) => e.t <= f.t).reverse().slice(0, 12);
  const go = (n: number) => (setPlaying(false), setI(Math.max(0, Math.min(last, n))));
  return (
    <Sheet t={t} title={`Replay ${code}`} onClose={onClose}>
      <Text style={{ color: t.quiet }}>{r.title}</Text>
      <Text style={{ color: t.text, fontSize: 44, fontWeight: "900", textAlign: "center", fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
        {clock(f.t * 60000)}
      </Text>
      {/* Zeitleiste: ein Abschnitt je Minute, antippen springt dorthin */}
      <View accessible accessibilityRole="adjustable" accessibilityLabel={`Minute ${i} von ${last}`}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => go(i + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
        style={{ flexDirection: "row", height: 28, alignItems: "center" }}>
        {r.frames.map((_, k) => (
          <Pressable key={k} onPress={() => go(k)} style={{ flex: 1, height: 28, justifyContent: "center" }}>
            <View style={{ height: 10, backgroundColor: k <= i ? t.accent : t.card }} />
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button t={t} label="−5" onPress={() => go(i - 5)} /></View>
        <View style={{ flex: 1 }}><Button t={t} label="−1" onPress={() => go(i - 1)} /></View>
        <View style={{ flex: 2 }}><Button t={t} strong label={playing ? "Pause" : "Abspielen"} onPress={() => (i >= last && setI(0), setPlaying(!playing))} /></View>
        <View style={{ flex: 1 }}><Button t={t} label="+1" onPress={() => go(i + 1)} /></View>
        <View style={{ flex: 1 }}><Button t={t} label="+5" onPress={() => go(i + 5)} /></View>
      </View>
      {f.patients.map((p) => (
        <Card key={p.id} t={t} color={p.triage ? skColor(t, p.triage) : t.line}>
          <Text style={{ color: t.text, fontWeight: "900" }}>{p.id.toUpperCase()} · {title(p.id)}</Text>
          <Text style={{ color: p.dead || (p.triage && p.triage !== p.target) ? t.text : t.quiet }}>
            {p.dead ? "verstorben" : p.left ? "abtransportiert" : `Phase ${p.phase}`} · Soll {p.target} · Ist {p.triage ?? "–"} · {p.place}
          </Text>
        </Card>
      ))}
      <Text style={{ color: t.text, fontSize: 20, fontWeight: "900", marginTop: 8 }}>Ereignisse bis {clock(f.t * 60000)}</Text>
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 12, gap: 4 }}>
        {shown.map((e, k) => (
          <Text key={k} style={{ color: f.t - e.t < 1 ? t.text : t.quiet }}>
            <Text style={{ color: t.text, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{clock(e.t * 60000)}</Text>  {e.text}
          </Text>
        ))}
        {!shown.length && <Text style={{ color: t.quiet }}>noch nichts passiert</Text>}
      </View>
    </Sheet>
  );
}

// Web: Datei herunterladen. Handy: über das Teilen-Menü weitergeben (Mail, Dateien …).
export async function exportCsv(session: Session, code: string) {
  const res = await fetch(`${httpBase(session.server)}/api/exercises/${code}/export.csv`, { headers: { authorization: `Bearer ${session.token}` } });
  if (!res.ok) throw new Error(`Export fehlgeschlagen (${res.status})`);
  if (Platform.OS !== "web") return void (await Share.share({ title: `dPS-Protokoll ${code}`, message: await res.text() }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob()); // blob statt text(): text() würde das BOM für Excel abschneiden
  a.download = `dps-${code}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
