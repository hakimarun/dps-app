// Messgeräte: Nach einer Messung erscheint der Wert im passenden Gerät – EKG-Monitor mit laufender Kurve,
// Blutdruck und SpO₂ wie am Überwachungsmonitor, Blutzucker und Temperatur als Handgerät mit LCD.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useReducedMotion } from "./ui";
import { ecgStrip, rhythmOf } from "./ekg";

export type DeviceKind = "ecg" | "bp" | "spo2" | "glucose" | "temp";
export const DEVICE_OF: Record<string, DeviceKind> = { ecg: "ecg", measure_bp: "bp", pulse_oximetry: "spo2", blood_glucose: "glucose", measure_temp: "temp" };
type F = { hr?: number; bp?: string; spo2?: number; temp?: number; exam?: Record<string, string> };

const GREEN = "#3CFF6E", CYAN = "#4FD1FF", YELLOW = "#FFE066", SCREEN = "#05080A";
const W = 300, H = 110; // Bildschirmausschnitt der Kurve in px (entspricht 3 s)

// Kurve als kurze, gedrehte Linienstücke – läuft ohne Grafikbibliothek auf iOS, Android und Web.
function Trace({ points, color }: { points: [number, number][]; color: string }) {
  return (
    <>
      {points.slice(1).map(([x2, y2], i) => {
        const [x1, y1] = points[i];
        const len = Math.hypot(x2 - x1, y2 - y1);
        return (
          <View key={i} style={{ position: "absolute", left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - 1, width: len + 0.5, height: 2.5,
            backgroundColor: color, borderRadius: 1, transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }] }} />
        );
      })}
    </>
  );
}

const PX_PER_S = W / 3; // 25 mm/s: ein Bildschirm zeigt 3 s
const STRIP_S = 6; // Länge des Streifens, der sich wiederholt (reicht für AV-Block-Muster)

function plethPoints(hr: number): [number, number][] {
  const beats = Math.max(1, Math.round((3 * (hr || 60)) / 60));
  const bump = (t: number, c: number, w: number, a: number) => a * Math.exp(-(((t - c) / w) ** 2));
  return Array.from({ length: W / 2 + 1 }, (_, i) => {
    const t = ((i * 2 * beats) / W) % 1;
    const y = hr ? bump(t, 0.22, 0.09, 1) + bump(t, 0.5, 0.08, 0.35) : 0; // Pulswelle mit Inzisur
    return [i * 2, H * 0.6 - y * H * 0.45];
  });
}

// Läuft von rechts nach links wie auf dem Monitor; der Streifen wiederholt sich nahtlos.
function Sweep({ points, color, width = W, ms = 3000 }: { points: [number, number][]; color: string; width?: number; ms?: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, ms]);
  return (
    <View style={{ width: W, height: H, overflow: "hidden" }}>
      <Animated.View style={{ width: width * 2, height: H, flexDirection: "row", transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, -width] }) }] }}>
        <View style={{ width, height: H }}><Trace points={points} color={color} /></View>
        <View style={{ width, height: H }}><Trace points={points} color={color} /></View>
      </Animated.View>
    </View>
  );
}

function Monitor({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ backgroundColor: "#2B2F33", borderRadius: 18, padding: 12, gap: 8, borderWidth: 2, borderColor: "#41464C" }}>
      <View style={{ backgroundColor: SCREEN, borderRadius: 8, padding: 12, gap: 6, minWidth: W + 24 }}>
        <Text style={{ color: "#8A949E", fontSize: 12, fontWeight: "700", letterSpacing: 1 }}>{label}</Text>
        {children}
      </View>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        {[0, 1, 2].map((i) => <View key={i} style={{ width: 22, height: 10, borderRadius: 3, backgroundColor: "#4A5056" }} />)}
      </View>
    </View>
  );
}

function Handheld({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View style={{ backgroundColor: "#DCE1E6", borderRadius: 28, padding: 16, paddingBottom: 26, width: 220, alignItems: "center", gap: 12, borderWidth: 2, borderColor: "#B8C0C8" }}>
      <Text style={{ color: "#5A6470", fontWeight: "800", letterSpacing: 1 }}>{label}</Text>
      <View style={{ backgroundColor: "#B9CBA0", borderRadius: 10, paddingVertical: 14, paddingHorizontal: 12, alignSelf: "stretch", alignItems: "flex-end", borderWidth: 3, borderColor: "#8C9A78" }}>
        <Text style={{ color: "#1E2A1E", fontSize: 54, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{value}</Text>
        <Text style={{ color: "#1E2A1E", fontWeight: "700" }}>{unit}</Text>
      </View>
      <View style={{ flexDirection: "row", gap: 14 }}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#9AA4AE" }} />
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: "#9AA4AE" }} />
      </View>
    </View>
  );
}

const de = (n: number) => String(n).replace(".", ",");

export function Device({ kind, f }: { kind: DeviceKind; f: F }) {
  const hr = f.hr ?? 0;
  const rhythm = f.exam?.ecg ?? "";
  const ecg = useMemo(() => ecgStrip(rhythmOf(rhythm), hr, STRIP_S, PX_PER_S, H), [hr, rhythm]);
  const pleth = useMemo(() => plethPoints(hr), [hr]);
  if (kind === "ecg")
    return (
      <Monitor label="EKG · ABL. II · 25 mm/s">
        <Sweep points={ecg} color={GREEN} width={STRIP_S * PX_PER_S} ms={STRIP_S * 1000} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={{ color: GREEN, fontSize: 15, fontWeight: "700", flexShrink: 1 }}>{rhythm}</Text>
          <Text style={{ color: GREEN, fontSize: 48, fontWeight: "800" }}>{hr || "--"}<Text style={{ fontSize: 14 }}> HF</Text></Text>
        </View>
      </Monitor>
    );
  if (kind === "spo2")
    return (
      <Monitor label="SpO₂ · PLETH">
        <Sweep points={pleth} color={CYAN} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Text style={{ color: CYAN, fontSize: 56, fontWeight: "800" }}>{f.spo2 ?? "--"}<Text style={{ fontSize: 18 }}> %</Text></Text>
          <Text style={{ color: CYAN, fontSize: 22, fontWeight: "700" }}>Puls {hr || "--"}</Text>
        </View>
      </Monitor>
    );
  if (kind === "bp") {
    const [sys, dia] = (f.bp ?? "").split("/").map(Number);
    const ok = sys > 0 && dia > 0;
    return (
      <Monitor label="NIBP · mmHg · gerade gemessen">
        <View style={{ alignItems: "center", paddingVertical: 10 }}>
          <Text style={{ color: YELLOW, fontSize: 64, fontWeight: "800" }}>{ok ? `${sys}/${dia}` : "--/--"}</Text>
          <Text style={{ color: YELLOW, fontSize: 20 }}>MAD {ok ? Math.round((sys + 2 * dia) / 3) : "--"}</Text>
        </View>
      </Monitor>
    );
  }
  if (kind === "glucose") return <Handheld label="BZ-MESSGERÄT" value={(f.exam?.glucose ?? "--").replace(/\s*mg\/dl/i, "")} unit="mg/dl" />;
  return <Handheld label="THERMOMETER" value={f.temp === undefined ? "--" : de(f.temp)} unit="°C" />;
}

// Overlay: Gerät groß in der Mitte, Tippen schließt.
export function DeviceSheet({ kind, f, onClose }: { kind: DeviceKind; f: F; onClose: () => void }) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => void Animated.timing(v, { toValue: 1, duration: reduced ? 0 : 250, easing: Easing.out(Easing.quad), useNativeDriver: true }).start(), []);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Messgerät schließen" onPress={onClose}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Animated.View style={{ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }}>
        <Device kind={kind} f={f} />
      </Animated.View>
      <Text style={{ color: "#FFFFFF", marginTop: 16, opacity: 0.8 }}>Tippen zum Schließen</Text>
    </Pressable>
  );
}
