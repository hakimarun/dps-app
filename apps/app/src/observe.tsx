// E7: Beobachter-App. Mit dem Beobachter-Code der Übung (über die Startseite, ohne Konto) Notizen mit Zeitstempel erfassen,
// zu einem Helfer, einem Patienten oder allgemein. Die Notizen landen im Protokoll, im Replay und im Bericht der Person.
import { useEffect, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ObserverView } from "@dps/schema/protocol";
import { api } from "./api";
import { FunButton, PinLink, PinScreen, STAGE } from "./fun";
import { Button, Card, Chip, Field, Title, clock, light, type Theme } from "./ui";

const KEY = "dps:observer";
type Login = { server: string; code: string; name: string };
const KINDS = [["note", "Notiz"], ["gut", "Gut"], ["besser", "Besser machen"]] as const;

export function Observe({ t, server, code, onExit }: { t: Theme; server: string; code: string; onExit: () => void }) {
  const [login, setLogin] = useState<Login | null>(null);
  const [name, setName] = useState("");
  useEffect(() => void AsyncStorage.getItem(KEY).then((v) => v && setName(JSON.parse(v).name ?? ""), () => {}), []);
  const start = () => {
    const l = { server, code, name: name.trim() };
    AsyncStorage.setItem(KEY, JSON.stringify({ name: l.name }));
    setLogin(l);
  };
  if (login) return <Notes t={t} login={login} onExit={onExit} />;
  return (
    <PinScreen fullBleed color={STAGE} footer={<PinLink label="Zur Startseite" onPress={onExit} />}>
      <Text style={{ color: "#111", fontSize: 24, fontWeight: "900", textAlign: "center" }}>Beobachten</Text>
      <Text style={{ color: "#333", textAlign: "center" }}>Mit diesem Code schreibst du Notizen zu Helfern und Patienten. Sie erscheinen im Protokoll und im Bericht.</Text>
      <Field t={light} label="Dein Name (steht an deinen Notizen)" value={name} onChange={setName} />
      <FunButton big label="Los geht's" color="#333" text="#FFFFFF" disabled={!name.trim()} onPress={start} />
    </PinScreen>
  );
}

function Notes({ t, login, onExit }: { t: Theme; login: Login; onExit: () => void }) {
  const session = { server: login.server, token: "" };
  const [v, setV] = useState<ObserverView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helper, setHelper] = useState<string | null>(null);
  const [patient, setPatient] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number][0]>("note");
  const [text, setText] = useState("");
  const load = () => api<ObserverView>(session, `/api/observe/${login.code}`).then((x) => (setV(x), setError(null)), (e: Error) => setError(e.message));
  useEffect(() => {
    load();
    const i = setInterval(load, 10_000); // ponytail: Abfrage alle 10 s statt WebSocket, reicht für Notizen
    return () => clearInterval(i);
  }, [login.code]);
  const save = () =>
    api(session, `/api/observe/${login.code}/notes`, { by: login.name, text: text.trim(), kind, helper, patient })
      .then(() => (setText(""), setKind("note"), load()), (e: Error) => setError(e.message));
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Text style={{ color: t.text, fontWeight: "700" }} accessibilityRole="button" onPress={onExit}>‹ Beenden</Text>
      <Title t={t}>Beobachten</Title>
      <Text style={{ color: t.quiet }}>{v ? `${v.title} · ${clock(v.t * 60000)}` : "lade …"} · {login.name}</Text>
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Text style={{ color: t.quiet, fontWeight: "700" }}>Zu wem?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip t={t} label="Allgemein" selected={!helper} onPress={() => setHelper(null)} />
        {v?.helpers.map((h) => <Chip key={h.id} t={t} label={h.trupp ? `${h.name} · ${h.trupp}` : h.name} selected={helper === h.id} onPress={() => setHelper(h.id)} />)}
      </View>
      <Text style={{ color: t.quiet, fontWeight: "700" }}>Patient</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip t={t} label="keiner" selected={!patient} onPress={() => setPatient(null)} />
        {v?.patients.map((p) => <Chip key={p.id} t={t} label={p.id.toUpperCase()} selected={patient === p.id} onPress={() => setPatient(p.id)} />)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {KINDS.map(([k, label]) => <Chip key={k} t={t} label={label} selected={kind === k} onPress={() => setKind(k)} />)}
      </View>
      <TextInput value={text} onChangeText={setText} multiline maxLength={300} placeholder="Was hast du beobachtet?" placeholderTextColor={t.quiet}
        accessibilityLabel="Notiz"
        style={{ minHeight: 90, borderWidth: 2, borderColor: t.edge, backgroundColor: t.card, borderRadius: 12, padding: 12, color: t.text, fontSize: 16, textAlignVertical: "top" }} />
      <Button t={t} strong label="Notiz speichern" disabled={!text.trim() || v?.status === "ready"} onPress={save} />
      {v?.status === "ready" && <Text style={{ color: t.quiet }}>Notizen gehen, sobald die Übung läuft.</Text>}
      {(v?.notes.length ?? 0) > 0 && <Text style={{ color: t.text, fontSize: 20, fontWeight: "900", marginTop: 8 }}>Notizen</Text>}
      {v?.notes.map((n, i) => (
        <Card key={i} t={t} color={n.text.startsWith("Beobachtung gut") ? t.green : n.text.startsWith("Beobachtung besser") ? t.gold : t.accent}>
          <Text style={{ color: t.quiet, fontSize: 12, fontWeight: "700" }}>{clock(n.t * 60000)}</Text>
          <Text style={{ color: t.text }}>{n.text}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}
