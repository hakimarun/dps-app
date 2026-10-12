// Fall des Tages (Solo): ein virtueller Patient ohne QR-Code, 5–10 Minuten, als Serie mit Pause.
// Das Spiel selbst ist der normale Helfer-Bildschirm (kommt über play herein, damit es keinen Import-Kreis gibt).
import { useEffect, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SERVER } from "./connection";
import { api } from "./api";
import { FUN, FunButton, PinLink, PinScreen, Wiggle } from "./fun";
import { EMPTY, complete, current, localDay, type Streak } from "./streak";

const KEY = "dps:solo";
const server = { server: DEFAULT_SERVER, token: "" };
export type SoloGame = { code: string; patient: string; onEnd: () => void; onDone: () => void };

export function Solo({ onExit, play }: { onExit: () => void; play: (game: SoloGame) => ReactNode }) {
  const [streak, setStreak] = useState<Streak>(EMPTY);
  const [game, setGame] = useState<{ code: string; patient: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => void AsyncStorage.getItem(KEY).then((v) => v && setStreak(JSON.parse(v)), () => {}), []);
  const save = (s: Streak) => (setStreak(s), AsyncStorage.setItem(KEY, JSON.stringify(s)));
  const start = () => {
    setStarting(true);
    api<{ code: string; patient: string }>(server, "/api/solo", {}).then((g) => (setError(null), setGame(g)), (e: Error) => setError(e.message)).finally(() => setStarting(false));
  };
  if (game)
    return play({
      ...game,
      onEnd: () => void api(server, `/api/solo/${game.code}/end`, {}).then(() => save(complete(streak, localDay())), (e: Error) => setError(e.message)),
      onDone: () => setGame(null),
    });
  const today = localDay();
  const days = current(streak, today);
  const done = streak.last === today;
  return (
    <PinScreen fullBleed color={FUN.green} footer={<PinLink label="Zurück" onPress={onExit} />}>
      <Text style={{ color: "#111", fontSize: 26, fontWeight: "900", textAlign: "center" }}>Fall des Tages</Text>
      <Text style={{ color: "#333", textAlign: "center" }}>Ein Patient, 5 bis 10 Minuten, ohne QR-Code. Jeden Tag ein neuer Fall.</Text>
      <View style={{ alignItems: "center", gap: 2, paddingVertical: 6 }} accessible accessibilityLabel={`Serie: ${days} ${days === 1 ? "Tag" : "Tage"} in Folge`}>
        <Wiggle trigger={days}><Text style={{ color: FUN.green, fontSize: 56, fontWeight: "900" }}>{days}</Text></Wiggle>
        <Text style={{ color: "#333", fontWeight: "800" }}>{days === 1 ? "Tag" : "Tage"} in Folge{streak.paused ? " · pausiert" : ""}</Text>
      </View>
      {done && <Text style={{ color: "#333", textAlign: "center" }}>Heute geschafft. Morgen wartet ein neuer Fall.</Text>}
      {error && <Text style={{ color: FUN.red, textAlign: "center", fontWeight: "700" }}>{error}</Text>}
      <FunButton big label={starting ? "Starte …" : done ? "Nochmal üben" : "Fall starten"} color={FUN.green} text="#FFFFFF" disabled={starting} onPress={start} />
      {days > 0 && !done && (streak.paused
        ? <Text style={{ color: "#555", textAlign: "center" }}>Pausiert: Die Serie geht weiter, sobald du den nächsten Fall abschließt.</Text>
        : <Text style={{ color: "#333", textAlign: "center", textDecorationLine: "underline", fontWeight: "700" }} accessibilityRole="button"
            onPress={() => save({ ...streak, paused: true })}>Serie pausieren (Urlaub, Schichtblock)</Text>)}
    </PinScreen>
  );
}
