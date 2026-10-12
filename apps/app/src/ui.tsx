// Gemeinsame Bausteine: Farben (nur als Bedeutung), Knöpfe, Felder, Titel, Overlay.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Sk } from "@dps/schema";

// marke: warmes Rot (J1), nur in Lobby, Bibliothek und Auswertung – im Einsatz ist Rot der Sichtung vorbehalten.
// accent: Lila wie die Bühne (Kahoot-Stil) für Hauptknöpfe und Auswahl; card/edge: Fläche und dunklere Unterkante der 3D-Knöpfe.
export const light = {
  bg: "#FFFFFF", text: "#111111", quiet: "#666666", line: "#E0E0E0", tint: "#F2F2F2", green: "#2E7D32", red: "#C62828", gold: "#B8860B", marke: "#C8202F",
  accent: "#46178F", accentEdge: "#2A0D57", card: "#F3F1F7", edge: "#CFCAD9",
};
export const dark = {
  bg: "#0B0B0B", text: "#F2F2F2", quiet: "#A0A0A0", line: "#2A2A2A", tint: "#1A1A1A", green: "#66BB6A", red: "#EF5350", gold: "#FFD54F", marke: "#E5484D",
  accent: "#6B35C9", accentEdge: "#33186A", card: "#1C1A22", edge: "#050407",
};
export type Theme = typeof light;

export const SK: Record<Sk, { label: string; light: string | null; dark: string | null }> = {
  I: { label: "I · rot · sofort", light: "#C62828", dark: "#EF5350" },
  II: { label: "II · gelb · dringend", light: "#F9A825", dark: "#FDD835" },
  III: { label: "III · grün · später", light: "#2E7D32", dark: "#66BB6A" },
  IV: { label: "IV · blau · abwartend", light: "#1565C0", dark: "#42A5F5" },
  EX: { label: "EX · tot", light: null, dark: null },
};
export const skColor = (t: Theme, sk: Sk) => (t === dark ? SK[sk].dark : SK[sk].light) ?? t.text;

export const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function Title({ t, children }: { t: Theme; children: ReactNode }) {
  return <Text accessibilityRole="header" style={{ color: t.text, fontSize: 30, fontWeight: "900", letterSpacing: -0.3 }}>{children}</Text>;
}

export function Field({ t, label, value, onChange, keyboard }: { t: Theme; label: string; value: string; onChange: (v: string) => void; keyboard?: "email-address" | "number-pad" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.quiet, fontWeight: "700", fontSize: 13 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label} keyboardType={keyboard}
        style={{ minHeight: 50, borderWidth: 2, borderColor: t.edge, borderRadius: 12, paddingHorizontal: 14, color: t.text, fontSize: 17, fontWeight: "600", backgroundColor: t.card }} />
    </View>
  );
}

// Klobiger 3D-Knopf wie bei Kahoot: dunklere Unterkante, beim Drücken sinkt er ein.
// strong = Hauptaktion (lila), color = Bedeutungsfarbe (z. B. Sichtungskategorie) als Rand und Hauch.
export function Button({ t, label, note, onPress, disabled, strong, color }: {
  t: Theme; label: string; note?: string; onPress: () => void; disabled?: boolean; strong?: boolean; color?: string | null;
}) {
  const edge = strong ? t.accentEdge : color ?? t.edge;
  const fg = strong ? "#FFFFFF" : t.text;
  const align = color !== undefined ? "left" : "center";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>
      {({ pressed }) => (
        <View style={{ borderRadius: 14, backgroundColor: edge, paddingBottom: pressed ? 1 : 4, marginTop: pressed ? 3 : 0, opacity: disabled ? 0.45 : 1 }}>
          <View style={{ borderRadius: 14, backgroundColor: strong ? t.accent : t.card, overflow: "hidden" }}>
            <View style={{ minHeight: strong ? 56 : 48, paddingHorizontal: 8, paddingVertical: 6, justifyContent: "center", backgroundColor: color ? `${color}2E` : "transparent", borderWidth: color ? 2 : 0, borderColor: color ?? "transparent", borderRadius: 14 }}>
              <Text style={{ color: fg, fontSize: strong ? 18 : 16, fontWeight: strong ? "900" : "700", textAlign: align }}>{label}</Text>
              {note && <Text style={{ color: strong ? "rgba(255,255,255,0.8)" : t.quiet, fontSize: 12, textAlign: align }}>{note}</Text>}
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Auswahl-Pille (Filter, Einheit, Einstellungen).
// Auswahlzustand für Screenreader im Web (aria-pressed); auf dem Handy reicht accessibilityState.
export const pressed = (on: boolean) => ({ "aria-pressed": on }) as object;

export function Chip({ t, label, selected, onPress, disabled }: { t: Theme; label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} {...pressed(selected)} disabled={disabled} onPress={onPress} style={{ maxWidth: "100%" }}>
      {({ pressed }) => (
        <View style={{ borderRadius: 22, backgroundColor: selected ? t.accentEdge : t.edge, paddingBottom: pressed ? 1 : 3, marginTop: pressed ? 2 : 0, opacity: disabled ? 0.4 : 1 }}>
          <View style={{ minHeight: 42, paddingHorizontal: 15, paddingVertical: 6, justifyContent: "center", borderRadius: 22, backgroundColor: selected ? t.accent : t.card }}>
            <Text style={{ color: selected ? "#FFFFFF" : t.text, fontWeight: selected ? "800" : "600" }}>{label}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Vollbild-Ebene als Modal (N12): Tastatur und Screenreader bleiben im Dialog, die Zurück-Taste (Android) schließt.
export function Overlay({ t, onClose, children }: { t: Theme; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 48 }}>{children}</View>
    </Modal>
  );
}

export function Sheet({ t, title, onClose, children }: { t: Theme; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Overlay t={t} onClose={onClose}>
      {/* Kopf bleibt beim Scrollen stehen, Schließen immer sichtbar oben rechts */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingBottom: 10 }}>
        <View style={{ width: 8, alignSelf: "stretch", borderRadius: 4, backgroundColor: t.accent }} />
        <View style={{ flex: 1 }}><Title t={t}>{title}</Title></View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Schließen" hitSlop={8}
          style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, backgroundColor: t.edge, paddingBottom: pressed ? 0 : 4, marginTop: pressed ? 4 : 0 })}>
          <View style={{ flex: 1, borderRadius: 24, backgroundColor: t.accent, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "900" }}>✕</Text>
          </View>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 10 }}>
        {children}
        <Button t={t} label="Schließen" onPress={onClose} />
      </ScrollView>
    </Overlay>
  );
}

// Auswertung: Team-Sterne in Gold (die einzige Farbe außerhalb der Sichtungskategorien).
export function Stars({ t, stars }: { t: Theme; stars: number }) {
  return <Text style={{ color: t.gold, fontSize: 32 }} accessibilityLabel={`${stars} von 3 Sternen`}>{"★".repeat(stars)}{"☆".repeat(3 - stars)}</Text>;
}

export function Badge({ t, label }: { t: Theme; label: string }) {
  return (
    <View style={{ borderWidth: 2, borderColor: t.gold, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text style={{ color: t.text, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

// J5: Systemeinstellung „Bewegung reduzieren“; alle Animationen fragen sie ab.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

// Springt beim Erscheinen ein (Beitritt, Abzeichen, Stern). Ohne Bewegung: sofort sichtbar.
// quick: höchstens 250 ms ohne Nachschwingen, für den Einsatzmodus (J6).
export function Pop({ delay = 0, quick = false, children }: { delay?: number; quick?: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    const go = quick
      ? Animated.timing(v, { toValue: 1, duration: 250, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true })
      : Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true });
    Animated.sequence([Animated.delay(delay), go]).start();
  }, [reduced]);
  return <Animated.View style={{ opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>{children}</Animated.View>;
}

// Zahl zählt hoch (Punkte in der Auswertung).
export function useCountUp(target: number, ms = 1200, delay = 0) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return setN(target);
    let raf = 0;
    const start = Date.now() + delay;
    const step = () => {
      const p = Math.min(1, Math.max(0, (Date.now() - start) / ms));
      setN(Math.round(target * (1 - (1 - p) ** 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return n;
}

// Kurzes Aufleuchten bei geändertem Wert, höchstens 300 ms (J3/J6: Einsatzmodus bleibt ruhig).
export function Flash({ t, value, children }: { t: Theme; value: unknown; children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    v.setValue(1);
    Animated.timing(v, { toValue: 0, duration: reduced ? 0 : 300, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [JSON.stringify(value)]);
  return <Animated.View style={{ borderRadius: 10, backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: ["transparent", t.tint] }) }}>{children}</Animated.View>;
}

// Eigenes Logo (J1): Wortmarke auf Markenrot, bewusst ohne Kreuz.
export function Logo({ t, size = 56 }: { t: Theme; size?: number }) {
  return (
    <View accessibilityRole="image" accessibilityLabel="dPS" style={{ width: size * 1.6, height: size, borderRadius: size / 4, backgroundColor: t.marke, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: "#FFFFFF", fontSize: size * 0.45, fontWeight: "800", letterSpacing: 1 }}>dPS</Text>
    </View>
  );
}

// 3D-Karte für Listen (Übungen, Bibliothek): farbiger Streifen links, sinkt beim Antippen ein.
export function Card({ t, color, onPress, children }: { t: Theme; color: string; onPress?: () => void; children: ReactNode }) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} onPress={onPress} disabled={!onPress}>
      {({ pressed }) => (
        <View style={{ borderRadius: 14, backgroundColor: t.edge, paddingBottom: pressed ? 1 : 4, marginTop: pressed ? 3 : 0 }}>
          <View style={{ flexDirection: "row", borderRadius: 14, backgroundColor: t.card, overflow: "hidden" }}>
            <View style={{ width: 10, backgroundColor: color }} />
            <View style={{ flex: 1, padding: 12, gap: 3 }}>{children}</View>
          </View>
        </View>
      )}
    </Pressable>
  );
}
