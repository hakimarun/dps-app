// Kompetenzprofil: 5 Achsen, Stufe und Abzeichen, nur auf diesem Gerät gespeichert.
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AXES, type Axis, type HelperReport, type Team } from "@dps/schema/protocol";
import { FUN, PinLink, PinScreen, STAGE } from "./fun";
import { EMPTY_PROFILE, level, record, toNext, type Profile } from "./skills";

const KEY = "dps:profile";
const LABEL: Record<Axis, string> = { sichtung: "Sichtung", blutung: "Blutung", atemweg: "Atemweg", kommunikation: "Kommunikation", ressourcen: "Ressourcen" };

const load = async (): Promise<Profile> => {
  try { return { ...EMPTY_PROFILE, ...JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}") }; } catch { return EMPTY_PROFILE; }
};
// Bericht einer Übung ins Profil übernehmen (aus dem Helfer-Bildschirm, sobald er freigegeben ist).
export async function addToProfile(key: string, r: { team: Team; me: HelperReport }) {
  await AsyncStorage.setItem(KEY, JSON.stringify(record(await load(), key, r)));
}

export function ProfileScreen({ onExit }: { onExit: () => void }) {
  const [p, setP] = useState<Profile>(EMPTY_PROFILE);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => void load().then(setP), []);
  const badges = Object.entries(p.badges).sort((a, b) => b[1] - a[1]);
  const next = toNext(p);
  return (
    <PinScreen fullBleed color={STAGE} footer={<PinLink label="Zurück" onPress={onExit} />}>
      <Text style={{ color: "#111", fontSize: 26, fontWeight: "900", textAlign: "center" }}>Mein Profil</Text>
      <Text style={{ color: STAGE, fontSize: 22, fontWeight: "900", textAlign: "center" }}>{level(p)}</Text>
      <Text style={{ color: "#333", textAlign: "center" }}>
        {p.exercises} {p.exercises === 1 ? "Übung" : "Übungen"}, davon {p.good} mit mindestens 2 Sternen
        {next ? ` · noch ${next} bis zur nächsten Stufe` : ""}
      </Text>
      {AXES.map((x) => {
        const { ok, total } = p.skills[x];
        const share = total ? ok / total : 0;
        return (
          <View key={x} style={{ gap: 4 }} accessible accessibilityRole="progressbar" accessibilityLabel={LABEL[x]}
            aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={ok} aria-valuetext={total ? `${ok} von ${total} richtig` : "noch nicht bewertet"}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={{ color: "#111", fontWeight: "800" }}>{LABEL[x]}</Text>
              <Text style={{ color: "#555" }}>{total ? `${ok} von ${total}` : "noch offen"}</Text>
            </View>
            <View style={{ height: 14, borderRadius: 7, backgroundColor: "#ECE8F3", overflow: "hidden" }}>
              <View style={{ width: `${Math.round(share * 100)}%`, height: 14, borderRadius: 7, backgroundColor: share >= 0.75 ? FUN.green : share >= 0.5 ? FUN.gold : STAGE }} />
            </View>
          </View>
        );
      })}
      {badges.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {badges.map(([b, n]) => (
            <View key={b} style={{ borderWidth: 2, borderColor: FUN.gold, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: "#111", fontWeight: "700" }}>{b}{n > 1 ? ` ×${n}` : ""}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={{ color: "#666", fontSize: 13, textAlign: "center", marginTop: 4 }}>Nur auf diesem Gerät gespeichert, ohne Namen und ohne Konto.</Text>
      {p.exercises > 0 && (
        <Text style={{ color: confirm ? FUN.red : "#666", fontSize: 13, textAlign: "center", textDecorationLine: "underline", fontWeight: confirm ? "800" : "400" }} accessibilityRole="button"
          onPress={() => (confirm ? AsyncStorage.removeItem(KEY).then(() => (setP(EMPTY_PROFILE), setConfirm(false))) : setConfirm(true))}>
          {confirm ? "Wirklich löschen? Nochmal tippen" : "Profil löschen"}
        </Text>
      )}
    </PinScreen>
  );
}
