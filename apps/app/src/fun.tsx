// Kahoot-Gefühl für Lobby, Countdown, Auswertung und Startseite (J1–J5): kräftige Farben, Symbolformen,
// bewegter Hintergrund, 3D-Knöpfe, Konfetti. Nie im Einsatzmodus (J6); "Bewegung reduzieren" schaltet alles ab.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Dimensions, Easing, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { Logo, light, useReducedMotion } from "./ui";

// Spielfarben: Markenrot plus drei Kontrastfarben (nur außerhalb des Einsatzes, wo Farben keine Sichtung bedeuten).
export const FUN = { red: "#E21B3C", blue: "#1368CE", gold: "#D89E00", green: "#26890C", purple: "#46178F", deep: "#8E0F25" };
export const TILE = [FUN.red, FUN.blue, FUN.gold, FUN.green];
// Hintergrund von Lobby und Show; eine Stelle, falls es doch ein dunkles Markenrot sein soll (FUN.deep).
export const STAGE = FUN.purple;
export const SHAPES = ["▲", "◆", "●", "■"] as const;
const W = "#FFFFFF";

// Endlosschleife 0→1, z. B. für Schweben und Drehen.
function useLoop(ms: number, delay = 0) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, delay, easing: Easing.inOut(Easing.sin), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced]);
  return v;
}

function Shape({ kind, size, color }: { kind: number; size: number; color: string }) {
  if (kind === 0)
    return <View style={{ width: 0, height: 0, borderLeftWidth: size / 2, borderRightWidth: size / 2, borderBottomWidth: size * 0.87, borderLeftColor: "transparent", borderRightColor: "transparent", borderBottomColor: color }} />;
  const base: ViewStyle = { width: size * 0.8, height: size * 0.8, backgroundColor: color };
  if (kind === 1) return <View style={{ ...base, transform: [{ rotate: "45deg" }] }} />;
  if (kind === 2) return <View style={{ ...base, width: size, height: size, borderRadius: size / 2 }} />;
  return <View style={{ ...base, borderRadius: size / 8 }} />;
}

// Schwebende Formen im Hintergrund.
// Hintergrundformen: bei jedem Laden zufällig verteilt, mit eigener Größe, Form, Geschwindigkeit, Hubhöhe und Drehrichtung.
// Die Werte werden einmal je Form gewürfelt und bleiben stabil, solange sie zu sehen ist.
function Floater({ i }: { i: number }) {
  const [r] = useState(() => {
    const rnd = (min: number, max: number) => min + Math.random() * (max - min);
    return {
      size: rnd(30, 120), left: rnd(-5, 92), top: rnd(-5, 90), kind: Math.floor(rnd(0, 4)),
      ms: rnd(6000, 18000), delay: rnd(0, 3000), lift: rnd(15, 55), opacity: rnd(0.08, 0.18),
      turn: Math.random() < 0.5 ? -360 : 360, // volle Umdrehung, sonst springt die Form am Schleifenende
    };
  });
  const v = useLoop(r.ms, r.delay);
  const up = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, -r.lift, 0] });
  const spin = v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${r.turn}deg`] });
  return (
    <Animated.View key={i} pointerEvents="none" style={{ position: "absolute", left: `${r.left}%`, top: `${r.top}%`, opacity: r.opacity, transform: [{ translateY: up }, { rotate: spin }] }}>
      <Shape kind={r.kind} size={r.size} color={W} />
    </Animated.View>
  );
}

// Bühne: farbiger Hintergrund mit Formen; Inhalt liegt darüber.
export function Stage({ color = FUN.red, children, style }: { color?: string; children: ReactNode; style?: ViewStyle }) {
  return (
    <View style={{ flex: 1, backgroundColor: color, overflow: "hidden", ...style }}>
      {/* dunklerer Boden wie bei Kahoot */}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "35%", backgroundColor: "rgba(0,0,0,0.12)" }} />
      {Array.from({ length: 12 }, (_, i) => <Floater key={i} i={i} />)}
      {children}
    </View>
  );
}

// Sanftes "Atmen" (Skalierung), z. B. für den Übungscode oder den eigenen Namen.
export function Breathe({ children, amount = 0.04, ms = 1800 }: { children: ReactNode; amount?: number; ms?: number }) {
  const v = useLoop(ms);
  const scale = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1 + amount, 1] });
  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

// Wackeln (z. B. wenn ein neuer Helfer beitritt oder die Zahl steigt).
export function Wiggle({ trigger, children }: { trigger: unknown; children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current || reduced) return void (first.current = false);
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration: 600, easing: Easing.linear, useNativeDriver: true }).start();
  }, [String(trigger)]);
  const rotate = v.interpolate({ inputRange: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 1], outputRange: ["0deg", "-8deg", "7deg", "-5deg", "4deg", "-2deg", "0deg"] });
  const scale = v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 1.18, 1] });
  return <Animated.View style={{ transform: [{ rotate }, { scale }] }}>{children}</Animated.View>;
}

// Einflug von unten mit Überschwingen und leichter Drehung.
export function FlyIn({ delay = 0, from = 120, spin = 0, children }: { delay?: number; from?: number; spin?: number; children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true })]).start();
  }, [reduced]);
  return (
    <Animated.View style={{
      opacity: v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }),
      transform: [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${spin}deg`, "0deg"] }) },
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
      ],
    }}>
      {children}
    </Animated.View>
  );
}

// Klobiger 3D-Knopf: dunklere Unterkante, beim Drücken sinkt er ein.
export function FunButton({ label, color = W, text = FUN.red, onPress, big, disabled }: {
  label: string; color?: string; text?: string; onPress: () => void; big?: boolean; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}>
      {({ pressed }) => (
        <View style={{ borderRadius: 14, backgroundColor: "rgba(0,0,0,0.28)", paddingBottom: pressed ? 2 : 6, marginTop: pressed ? 4 : 0, opacity: disabled ? 0.5 : 1 }}>
          <View style={{ borderRadius: 14, backgroundColor: color, minHeight: big ? 68 : 54, paddingHorizontal: 22, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: text, fontSize: big ? 24 : 18, fontWeight: "900", letterSpacing: 0.5 }}>{label}</Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// Namens-Kachel mit Farbe und Symbol wie die Antwortkacheln bei Kahoot.
export function Tile({ i, label, big }: { i: number; label: string; big?: boolean }) {
  const color = TILE[i % 4];
  return (
    <View style={{ borderRadius: 10, backgroundColor: "rgba(0,0,0,0.25)", paddingBottom: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: color, borderRadius: 10, paddingHorizontal: big ? 20 : 14, paddingVertical: big ? 14 : 9 }}>
        <Text aria-hidden style={{ color: W, fontSize: big ? 22 : 16 }}>{SHAPES[i % 4]}</Text>
        <Text style={{ color: W, fontSize: big ? 26 : 17, fontWeight: "900" }}>{label}</Text>
      </View>
    </View>
  );
}

// Konfetti: fallende, drehende Schnipsel in den Spielfarben.
export function Confetti({ count = 70, delay = 0 }: { count?: number; delay?: number }) {
  const reduced = useReducedMotion();
  const { height, width } = Dimensions.get("window");
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: Math.random() * width, sway: 20 + Math.random() * 60, ms: 2200 + Math.random() * 1800, wait: delay + Math.random() * 700,
    color: [...TILE, W, FUN.purple][i % 6], w: 6 + Math.random() * 8, h: 10 + Math.random() * 10, turns: 2 + Math.random() * 4,
    v: new Animated.Value(0),
  })), [count]);
  useEffect(() => {
    if (reduced) return;
    Animated.parallel(pieces.map((p) => Animated.timing(p.v, { toValue: 1, duration: p.ms, delay: p.wait, easing: Easing.in(Easing.quad), useNativeDriver: true }))).start();
  }, [reduced]);
  if (reduced) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      {pieces.map((p, i) => (
        <Animated.View key={i} style={{
          position: "absolute", left: p.x, top: -30, width: p.w, height: p.h, backgroundColor: p.color, borderRadius: 2,
          opacity: p.v.interpolate({ inputRange: [0, 0.05, 0.85, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 60] }) },
            { translateX: p.v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, p.sway, 0, -p.sway, 0] }) },
            { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.turns * 360}deg`] }) },
          ],
        }} />
      ))}
    </View>
  );
}

// Balken wächst von unten (Podium).
export function Rise({ height, delay = 0, color, children }: { height: number; delay?: number; color: string; children?: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) return v.setValue(1);
    Animated.sequence([Animated.delay(delay), Animated.spring(v, { toValue: 1, friction: 7, tension: 50, useNativeDriver: true })]).start();
  }, [reduced]);
  return (
    <View style={{ height, overflow: "hidden", justifyContent: "flex-end", alignSelf: "stretch" }}>
      <Animated.View style={{ height, backgroundColor: color, borderTopLeftRadius: 12, borderTopRightRadius: 12, alignItems: "center", paddingTop: 10,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

// Hüpfende Punkte "…" für Wartezustände.
export function Dots({ color = W }: { color?: string }) {
  const v = useLoop(1200);
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color,
          transform: [{ translateY: v.interpolate({ inputRange: [0, i * 0.2, i * 0.2 + 0.15, i * 0.2 + 0.3, 1], outputRange: [0, 0, -14, 0, 0], extrapolate: "clamp" }) }] }} />
      ))}
    </View>
  );
}

// "Game-PIN"-Seite wie bei Kahoot: Bühne, Logo, weiße Karte. Inhalte der Karte nutzen das helle Theme (light).
// fullBleed: bis an den oberen Rand (unter die Statusleiste), wenn darüber keine Kopfzeile steht.
export function PinScreen({ color = STAGE, children, footer, fullBleed }: { color?: string; children: ReactNode; footer?: ReactNode; fullBleed?: boolean }) {
  return (
    <Stage color={color} style={fullBleed ? { marginTop: -48 } : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, paddingTop: fullBleed ? 68 : 20, gap: 18 }}>
        <View style={{ alignItems: "center" }}><FlyIn><Logo t={{ ...light, marke: color === FUN.red ? FUN.deep : FUN.red }} size={56} /></FlyIn></View>
        <FlyIn delay={120} from={60}>
          <View style={{ backgroundColor: W, borderRadius: 22, padding: 18, gap: 12, alignSelf: "center", width: "100%", maxWidth: 440,
            shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 }}>
            {children}
          </View>
        </FlyIn>
        {footer && <View style={{ alignItems: "center", gap: 8 }}>{footer}</View>}
      </ScrollView>
    </Stage>
  );
}

// Weißer Link unter der Karte, z. B. "Zur Startseite".
export const PinLink = ({ label, onPress }: { label: string; onPress: () => void }) => (
  <Text accessibilityRole="button" onPress={onPress} style={{ color: W, fontWeight: "800", fontSize: 16, padding: 8 }}>{label}</Text>
);
