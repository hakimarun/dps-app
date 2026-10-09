// Gemeinsame Bausteine: Farben (nur als Bedeutung), Knöpfe, Felder, Titel, Overlay.
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Sk } from "@dps/schema";

export const light = { bg: "#FFFFFF", text: "#111111", quiet: "#666666", line: "#E0E0E0", tint: "#F2F2F2", green: "#2E7D32", red: "#C62828", gold: "#B8860B" };
export const dark = { bg: "#0B0B0B", text: "#F2F2F2", quiet: "#A0A0A0", line: "#2A2A2A", tint: "#1A1A1A", green: "#66BB6A", red: "#EF5350", gold: "#FFD54F" };
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
  return <Text style={{ color: t.text, fontSize: 28, fontWeight: "700" }}>{children}</Text>;
}

export function Field({ t, label, value, onChange, keyboard }: { t: Theme; label: string; value: string; onChange: (v: string) => void; keyboard?: "email-address" | "number-pad" }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.quiet }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label} keyboardType={keyboard}
        style={{ minHeight: 48, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, color: t.text, fontSize: 17 }} />
    </View>
  );
}

export function Button({ t, label, note, onPress, disabled, strong, color }: {
  t: Theme; label: string; note?: string; onPress: () => void; disabled?: boolean; strong?: boolean; color?: string | null;
}) {
  const border = color ?? t.text;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({
        minHeight: strong ? 56 : 48, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center", opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        borderWidth: strong || color !== undefined ? 2 : 1, borderColor: strong || color !== undefined ? border : t.line,
        backgroundColor: color ? `${color}2E` : "transparent",
      })}>
      <Text style={{ color: t.text, fontSize: strong ? 17 : 16, fontWeight: strong ? "600" : "400", textAlign: color !== undefined ? "left" : "center" }}>{label}</Text>
      {note && <Text style={{ color: t.quiet, fontSize: 12, textAlign: "center" }}>{note}</Text>}
    </Pressable>
  );
}

// Auswahl-Pille (Filter, Einheit, Einstellungen).
export function Chip({ t, label, selected, onPress, disabled }: { t: Theme; label: string; selected: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected, disabled }} disabled={disabled} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 22, opacity: disabled ? 0.4 : 1, borderWidth: selected ? 2 : 1, borderColor: selected ? t.text : t.line }}>
      <Text style={{ color: t.text, fontWeight: selected ? "600" : "400" }}>{label}</Text>
    </Pressable>
  );
}

export function Sheet({ t, title, onClose, children }: { t: Theme; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, paddingTop: 48 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
        <Title t={t}>{title}</Title>
        {children}
        <Button t={t} label="Schließen" onPress={onClose} />
      </ScrollView>
    </View>
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
