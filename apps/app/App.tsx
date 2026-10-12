// dPS-App: Startseite (Code oder neues Spiel), Helfer-Ablauf und Spielleitung (src/leitung.tsx).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, Vibration, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Sk } from "@dps/schema";
import { ROLE_TASK, roleRule, type Role, type Status, type Topic, type View as ViewData } from "@dps/schema/protocol";
import { DEFAULT_SERVER, exerciseMinutes, lastConnection, useConnection } from "./src/connection";
import { Solo, type SoloGame } from "./src/solo";
import { ProfileScreen, addToProfile } from "./src/profile";
import { Observe } from "./src/observe";
import { canListen, canSpeak, listen, speak, stopSpeaking } from "./src/speech";
import { voiceFor } from "./src/voice";
import { Badge, Button, Chip, Field, Flash, Overlay, Pop, SK, Sheet, Title, clock, dark, light, pressed, skColor, useCountUp, type Theme } from "./src/ui";
import { Breathe, Confetti, Dots, FUN, FlyIn, FunButton, PinLink, PinScreen, STAGE, Stage, Tile } from "./src/fun";
import { DEVICE_OF, DeviceSheet, type DeviceKind } from "./src/devices";
import { httpBase } from "./src/api";
import { parseScan } from "./src/scan";
import { Leitung } from "./src/leitung";

// N3: QR-Scan ohne Internet. Ohne eingebaute Barcode-Erkennung (z. B. iPhone) lädt expo-camera die Erkennung (zxing-wasm)
// sonst vom CDN; im Web-Build liefert der eigene Server die Datei aus (build:web kopiert sie nach dist).
if (Platform.OS === "web" && !__DEV__)
  void import("barcode-detector").then(({ setZXingModuleOverrides }) =>
    setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path) }));

const VITALS: [string, string, string?][] = [["AF", "rr"], ["HF", "hr"], ["RR", "bp"], ["SpO₂", "spo2", " %"], ["GCS", "gcs"], ["Rekap", "recap", " s"]];
const EXAM: Record<string, string> = {
  auscultation: "Auskultation", percussion: "Perkussion", pupils: "Pupillen", motor: "Motorik", pelvis: "Becken",
  abdomen: "Bauch", burn: "Verbrennung", airway: "Atemweg", ecg: "EKG", glucose: "Blutzucker", bodycheck: "Bodycheck",
};
// Vitalwert-Karte → Messgerät, sobald der Wert gemessen ist.
const CARD_DEVICE: Record<string, DeviceKind> = { hr: "ecg", bp: "bp", spo2: "spo2" };
const MATERIAL: Record<string, string> = {
  tourniquet: "Tourniquet", dressing: "Verband", wendl: "Wendl-Tubus", o2_mask: "O₂-Maske", needle: "Punktionsnadel", ett: "Tubus",
  iv_cannula: "Venenkanüle", infusion: "Infusion", analgesic: "Analgetikum", pelvic_binder: "Beckengurt", splint: "Schiene", rescue_blanket: "Rettungsdecke",
  cervical_collar: "HWS-Stütze", vacuum_mattress: "Vakuummatratze", bvm: "Beatmungsbeutel", chest_seal: "Chest Seal", hemostatic: "Hämostyptikum",
  burn_dressing: "Brandwundenverband", glucose: "Glukose", pacer_pads: "Schrittmacher-Elektroden",
};
const SILENT = "(keine Reaktion)"; // so antwortet der Server, wenn der Patient nicht sprechen kann
// Vorschläge nach SAMPLER als ganze Sätze; das Thema geht mit, damit es auch ohne KI eine Antwort gibt.
const QUICK: Record<Topic, string> = {
  symptoms: "Wo haben Sie Schmerzen?", allergies: "Haben Sie Allergien?", medication: "Nehmen Sie regelmäßig Medikamente?",
  history: "Haben Sie Vorerkrankungen?", lastMeal: "Wann haben Sie zuletzt etwas gegessen?", event: "Was ist passiert?",
  risk: "Gibt es noch etwas, das ich wissen sollte?",
};
const STATUS: Record<Status, string> = { ready: "noch nicht gestartet", running: "", paused: "pausiert", ended: "beendet" };


// Eine Startseite für alle: Code eingeben (Übung, Trupp oder Beobachter) oder ein neues Spiel starten. Keine Konten.
type Screen =
  | { kind: "start" }
  | { kind: "helfer"; server: string; code: string }
  | { kind: "beobachter"; server: string; code: string }
  | { kind: "leitung"; server: string; startNew: boolean }
  | { kind: "solo" }
  | { kind: "profil" };

export default function App() {
  const t = useColorScheme() === "dark" ? dark : light;
  const [screen, setScreen] = useState<Screen>({ kind: "start" });
  const home = () => setScreen({ kind: "start" });
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 48 }}>
      <StatusBar style="auto" />
      {screen.kind === "helfer" ? <Helfer t={t} server={screen.server} code={screen.code} onExit={home} />
        : screen.kind === "beobachter" ? <Observe t={t} server={screen.server} code={screen.code} onExit={home} />
        : screen.kind === "leitung" ? <Leitung t={t} server={screen.server} startNew={screen.startNew} onExit={home} />
        : screen.kind === "profil" ? <ProfileScreen onExit={home} />
        : screen.kind === "solo" ? <Solo onExit={home} play={(game) => <Helfer t={t} server={DEFAULT_SERVER} code={game.code} onExit={home} solo={game} />} />
        : <Start onGo={setScreen} />}
    </View>
  );
}

function Start({ onGo }: { onGo: (s: Screen) => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [editServer, setEditServer] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  useEffect(() => void lastConnection().then((l) => l && (setServer(l.server), setCode(l.code))), []);
  // Code auflösen: Übung oder Trupp → mitspielen, Beobachter-Code → Notizen.
  const go = (c: string) => {
    setBusy(true);
    fetch(`${httpBase(server)}/api/code/${c.trim().toUpperCase()}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `Fehler ${r.status}`))))
      .then((x: { kind: string; code: string }) => onGo(x.kind === "observer" ? { kind: "beobachter", server: server.trim(), code: x.code } : { kind: "helfer", server: server.trim(), code: x.code }),
        (e: Error) => setError(e.message === "Failed to fetch" ? "Server nicht erreichbar" : e.message))
      .finally(() => setBusy(false));
  };
  // QR-Code aus der Lobby: "dps:<CODE>"
  const scanned = (raw: string) => {
    const m = raw.trim().match(/^dps:([A-Z0-9]{6})$/i);
    if (!m || !scanning) return;
    setScanning(false);
    setCode(m[1].toUpperCase());
    go(m[1]);
  };
  const link = (label: string, s: Screen) => <PinLink key={label} label={label} onPress={() => onGo(s)} />;
  return (
    <PinScreen fullBleed color={FUN.red} footer={<View style={{ flexDirection: "row", gap: 22, flexWrap: "wrap", justifyContent: "center" }}>
      {[link("Meine Spiele", { kind: "leitung", server: server.trim(), startNew: false }), link("Fall des Tages", { kind: "solo" }), link("Mein Profil", { kind: "profil" })]}
    </View>}>
      <Text style={{ color: "#111", fontSize: 24, fontWeight: "900", textAlign: "center" }}>Spielcode</Text>
      <TextInput value={code} onChangeText={(v) => (setCode(v.toUpperCase()), setError(null))} placeholder="CODE" placeholderTextColor="#999" autoCapitalize="characters" autoCorrect={false}
        accessibilityLabel="Spielcode" maxLength={6} onSubmitEditing={() => code.length === 6 && go(code)}
        style={{ height: 64, borderWidth: 3, borderColor: "#CFCAD9", borderRadius: 14, textAlign: "center", fontSize: 30, fontWeight: "900", letterSpacing: 6, color: "#111" }} />
      {error && <Text style={{ color: light.red, fontWeight: "700", textAlign: "center" }}>{error}</Text>}
      <FunButton big label={busy ? "Verbinde …" : "Los geht's"} color="#333333" text="#FFFFFF" disabled={code.trim().length !== 6 || busy} onPress={() => go(code)} />
      {scanning && permission?.granted ? (
        <CameraView style={{ height: 300, borderRadius: 16, overflow: "hidden" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => scanned(r.data)} />
      ) : (
        <FunButton label="QR-Code scannen" color={FUN.blue} text="#FFFFFF" onPress={() => (permission?.granted ? setScanning(true) : requestPermission().then((p) => p.granted && setScanning(true)))} />
      )}
      <Text style={{ color: "#666", textAlign: "center", fontWeight: "700" }}>oder</Text>
      <FunButton label="Neues Spiel starten" color={FUN.purple} text="#FFFFFF" onPress={() => onGo({ kind: "leitung", server: server.trim(), startNew: true })} />
      {editServer ? <Field t={light} label="Server" value={server} onChange={setServer} />
        : <Text style={{ color: "#888", fontSize: 12, textAlign: "center" }} accessibilityRole="button" onPress={() => setEditServer(true)}>Server: {server} · ändern</Text>}
    </PinScreen>
  );
}

function Helfer({ t, server, code, onExit, solo }: { t: Theme; server: string; code: string; onExit: () => void; solo?: SoloGame }) {
  const { conn, connect, send } = useConnection();
  useEffect(() => void connect(server, code), []);
  // Fall des Tages: Beitritt und Scan geschehen automatisch, die Übergabe schließt den Fall ab.
  const auto = useRef({ join: false, scan: false, end: false });
  useEffect(() => {
    if (!solo || conn.status !== "online") return;
    if (!conn.participant && !auto.current.join) (auto.current.join = true), send({ type: "join", name: "Ich", unit: "rtw1" });
    if (conn.participant && conn.view && !conn.view.patient && !auto.current.scan) (auto.current.scan = true), send({ type: "scan", patient: solo.patient });
    if (conn.view?.patient?.left && conn.clock?.status === "running" && !auto.current.end) (auto.current.end = true), solo.onEnd();
  }, [conn.status, conn.participant, conn.view]);
  const [sheet, setSheet] = useState<null | "actions" | "triage" | "scan" | "admit" | "handover" | "ask" | "lage">(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Vibration statt Ton: wenn die eigene Maßnahme fertig ist oder sich der Patient verändert.
  const prev = useRef({ busy: false, patient: "", findings: "" });
  useEffect(() => {
    const v = conn.view;
    const busy = !!v?.me?.busy;
    const findings = JSON.stringify(v?.patient?.findings ?? null);
    const p = prev.current;
    if ((p.busy && !busy) || (p.patient === v?.patient?.id && p.findings !== findings && p.findings)) Vibration.vibrate(200);
    prev.current = { busy, patient: v?.patient?.id ?? "", findings };
  }, [conn.view]);

  // E5: neueste Nachricht der Leitung oben, bis der Helfer sie wegtippt; einmal vibrieren, wenn eine neue kommt.
  const latest = conn.view?.messages?.at(-1) ?? null;
  const [seenMsg, setSeenMsg] = useState<number | null>(null);
  const prevMsg = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    if (prevMsg.current !== undefined && latest && latest.t !== prevMsg.current) Vibration.vibrate(200);
    if (conn.view) prevMsg.current = latest?.t ?? null;
  }, [latest?.t, !!conn.view]);

  // Freigegebener Bericht → Kompetenzprofil auf dem Gerät (jede Übung einmal).
  useEffect(() => void (conn.view?.result && addToProfile(`${conn.server}|${conn.code}`, conn.view.result)), [!!conn.view?.result]);

  // Übergang Lobby → Einsatz: einmal "Los geht's!".
  const lastStatus = useRef(conn.clock?.status);
  const [go, setGo] = useState(false);
  useEffect(() => {
    if (lastStatus.current === "ready" && conn.clock?.status === "running" && conn.participant) setGo(true);
    lastStatus.current = conn.clock?.status;
  }, [conn.clock?.status]);

  const w = conn.welcome;
  const min = exerciseMinutes(conn.clock, conn.offset, now);
  let body: ReactNode;
  if (!w)
    body = (
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: conn.error ? t.red : t.quiet }}>{conn.error ?? `verbinde mit ${code} …`}</Text>
        <Text style={{ color: t.text, fontWeight: "700" }} accessibilityRole="button" onPress={onExit}>‹ Zur Startseite</Text>
      </View>
    );
  else if (conn.participant && conn.clock?.status === "ended") body = <Result t={t} result={conn.view?.result ?? null} />;
  else if (conn.participant && conn.clock?.status === "ready") body = <Waiting t={t} name={conn.view?.me?.name ?? ""} trupp={conn.view?.me?.trupp ?? null} title={w.title} />;
  else if (!conn.participant)
    body = <Join t={t} units={w.units} trupp={w.trupp} online={conn.status === "online"} onJoin={(name, unit) => send({ type: "join", name, ...(unit ? { unit } : {}) })} />;
  else if (sheet === "scan" || !conn.view?.patient)
    body = <Scan t={t} code={conn.code} current={conn.view?.patient?.id}
      onScan={(patient) => (send({ type: "scan", patient }), setSheet(null))} onBack={() => setSheet(null)} />;
  else body = <PatientScreen t={t} conn={conn} min={min} onSheet={setSheet} onEnd={() => send({ type: "end" })} onAssist={(patient) => send({ type: "assist", patient })} />;

  return (
    <View style={{ flex: 1 }}>
      {w && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ color: t.quiet, fontSize: 13 }}>
            {clock(min * 60000)}
            {conn.clock && STATUS[conn.clock.status] ? ` · ${STATUS[conn.clock.status]}` : ""}
            {conn.view?.me?.trupp ? ` · ${conn.view.me.trupp}` : ""}
          </Text>
          <Text style={{ color: conn.status === "online" ? t.green : t.quiet, fontSize: 13 }}>
            {conn.status === "online" ? "● online" : "○ offline"}
            {conn.queued > 0 && conn.participant ? ` · puffert ${conn.queued}` : ""}
          </Text>
        </View>
      )}
      {conn.view?.lage && conn.clock?.status !== "ended" && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Button t={t} strong label="Lage & Verstärkung" note="Führung: Fahrzeuge anfordern, Transporte freigeben" onPress={() => setSheet("lage")} />
        </View>
      )}
      {sheet === "lage" && conn.view?.lage && (
        <LageSheet t={t} lage={conn.view.lage} min={min} onRequest={(kind) => send({ type: "request", kind })} onClear={(patient) => send({ type: "clear", patient })} onClose={() => setSheet(null)} />
      )}
      {solo && w && conn.clock?.status === "running" && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Button t={t} label="Fall abschließen" note={min < 10 ? "ohne dich läuft der Patient bis Minute 10 weiter" : undefined} onPress={() => ((auto.current.end = true), solo.onEnd())} />
        </View>
      )}
      {conn.error && w && <Text style={{ color: t.red, paddingHorizontal: 20, paddingBottom: 8 }}>{conn.error}</Text>}
      {latest && latest.t !== seenMsg && conn.participant && conn.clock?.status !== "ended" && (
        <View style={{ marginHorizontal: 20, marginBottom: 8, flexDirection: "row", borderRadius: 14, backgroundColor: t.card, overflow: "hidden" }} accessibilityLiveRegion="polite">
          <View style={{ width: 8, backgroundColor: t.accent }} />
          <View style={{ flex: 1, padding: 12, gap: 4 }}>
            <Text style={{ color: t.quiet, fontSize: 12, fontWeight: "700" }}>Leitung · {clock(latest.t * 60000)}</Text>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{latest.text}</Text>
          </View>
          <Pressable onPress={() => setSeenMsg(latest.t)} accessibilityRole="button" accessibilityLabel="Nachricht schließen" style={{ paddingHorizontal: 16, justifyContent: "center" }}>
            <Text style={{ color: t.text, fontWeight: "900", fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>
      )}
      {body}
      {solo && conn.clock?.status === "ended" && <View style={{ padding: 20 }}><Button t={t} strong label="Fertig" onPress={solo.onDone} /></View>}
      {go && <Go onDone={() => setGo(false)} />}
      {sheet === "actions" && conn.view && w && (
        <Sheet t={t} title="Maßnahme" onClose={() => setSheet(null)}>
          {w.actions.flatMap((a, i) => {
            const missing = Object.entries(a.material).filter(([item, n]) => (conn.view!.inventory[item] ?? 0) < n);
            const disabled = !conn.view!.unitArrived || missing.length > 0;
            const note = !conn.view!.unitArrived ? "Einheit noch nicht da" : missing.length ? `kein ${MATERIAL[missing[0][0]] ?? missing[0][0]}` : `${a.minutes === null ? "dauerhaft" : a.minutes < 1 ? `${a.minutes * 60} s` : `${a.minutes} min`}${(a.helpers ?? 1) > 1 ? " · 2 Helfer" : ""}`;
            // Katalog ist nach Gruppen sortiert: Überschrift, wenn eine neue Gruppe beginnt.
            const head = a.group !== w.actions[i - 1]?.group ? [<Text key={`g-${a.group}`} accessibilityRole="header" style={{ color: t.quiet, fontWeight: "600", marginTop: i ? 8 : 0 }}>{a.group}</Text>] : [];
            return [
              ...head,
              <Button key={a.id} t={t} label={a.title} note={note} disabled={disabled}
                onPress={() => (send({ type: "start", patient: conn.view!.patient!.id, action: a.id }), setSheet(null))} />,
              // C10: fehlendes Material von einem anderen Fahrzeug vor Ort holen
              ...(conn.view!.unitArrived ? missing : []).flatMap(([item]) => {
                const from = conn.view!.stock?.find((u) => (u.inventory[item] ?? 0) > 0);
                return from ? [<Button key={`${a.id}-${item}`} t={t} label={`${MATERIAL[item] ?? item} von ${from.title} holen`} note={`dort noch ${from.inventory[item]}`}
                  onPress={() => send({ type: "fetch", from: from.id, item })} />] : [];
              }),
            ];
          })}
        </Sheet>
      )}
      {sheet === "admit" && conn.view?.patient && (
        <Sheet t={t} title={`Aufnahme ${conn.view.patient.id.toUpperCase()}`} onClose={() => setSheet(null)}>
          {(["ablage", "bhp"] as const).map((place) => (
            <Button key={place} t={t} strong label={place === "ablage" ? "Patientenablage" : "Behandlungsplatz"}
              onPress={() => (send({ type: "admit", patient: conn.view!.patient!.id, place }), setSheet(null))} />
          ))}
        </Sheet>
      )}
      {sheet === "ask" && conn.view?.patient && (
        <Chat t={t} patient={conn.view.patient.id} picture={conn.view.patient.picture} dialog={conn.view.patient.dialog} ai={!!w?.ai} online={conn.status === "online"}
          error={conn.error} onAsk={(q) => send({ type: "ask", patient: conn.view!.patient!.id, ...q })} onClose={() => setSheet(null)} />
      )}
      {sheet === "handover" && conn.view?.patient && (
        <HandoverSheet t={t} patient={conn.view.patient.id} vehicles={conn.view.vehicles} onClose={() => setSheet(null)}
          onHandover={(vehicle, destination, diagnosis) => (send({ type: "handover", patient: conn.view!.patient!.id, vehicle, destination, diagnosis }), setSheet(null))} />
      )}
      {sheet === "triage" && conn.view?.patient && (
        <Sheet t={t} title={`Sichtung ${conn.view.patient.id.toUpperCase()}`} onClose={() => setSheet(null)}>
          {(Object.keys(SK) as Sk[]).map((sk) => (
            <Button key={sk} t={t} label={SK[sk].label} color={t === dark ? SK[sk].dark : SK[sk].light} strong
              onPress={() => (send({ type: "triage", patient: conn.view!.patient!.id, sk }), setSheet(null))} />
          ))}
        </Sheet>
      )}
    </View>
  );
}

function Join({ t, units, trupp, online, onJoin }: {
  t: Theme; units: { id: string; title: string }[]; trupp: { name: string; role: Role; unit: string } | null; online: boolean; onJoin: (name: string, unit?: string) => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  return (
    <PinScreen>
      <Text style={{ color: "#111", fontSize: 24, fontWeight: "900", textAlign: "center" }}>Wie heißt du?</Text>
      {trupp && <Text style={{ color: "#333", fontSize: 16, fontWeight: "700", textAlign: "center" }}>{trupp.name} · {trupp.unit} · {ROLE_TASK[trupp.role]}</Text>}
      <TextInput value={name} onChangeText={setName} placeholder="Name oder Kürzel" placeholderTextColor="#999" autoCorrect={false} accessibilityLabel="Name oder Kürzel" maxLength={30}
        style={{ height: 60, borderWidth: 3, borderColor: "#CFCAD9", borderRadius: 14, textAlign: "center", fontSize: 24, fontWeight: "800", color: "#111" }} />
      {!trupp && (
        <>
          <Text style={{ color: "#666", fontWeight: "700" }}>Einheit</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {units.map((u) => <Chip key={u.id} t={light} label={u.title} selected={unit === u.id} onPress={() => setUnit(u.id)} />)}
          </View>
        </>
      )}
      <FunButton big label="Beitreten" color="#333333" text="#FFFFFF" disabled={!online || !name.trim() || (!trupp && !unit)} onPress={() => onJoin(name.trim(), trupp ? undefined : unit)} />
      {/* N10: vor dem Beitritt informieren */}
      <Text style={{ color: "#666", fontSize: 13 }}>
        Deine Aktionen und Fragen werden mit diesem Namen protokolliert und nach der Übung ausgewertet. Deinen Bericht siehst nur du und die
        Übungsleitung. Nimm ein Kürzel, wenn du nicht mit vollem Namen erscheinen willst.
      </Text>
    </PinScreen>
  );
}

function Scan({ t, code, current, onScan, onBack }: { t: Theme; code: string; current?: string; onScan: (patient: string) => void; onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const last = useRef(0); // die Kamera meldet denselben Code viele Male pro Sekunde
  const handle = (raw: string, camera = false) => {
    if (camera && Date.now() - last.current < 2000) return;
    last.current = Date.now();
    const r = parseScan(raw, code);
    if ("error" in r) return setError(r.error);
    onScan(r.id);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Patient scannen</Title>
      {permission?.granted ? (
        <CameraView style={{ height: 320, borderRadius: 16, overflow: "hidden" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => handle(r.data, true)} />
      ) : (
        <Button t={t} label="Kamera erlauben" onPress={requestPermission} />
      )}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Field t={t} label="Oder Nummer bzw. Kennung vom Zettel eingeben, z. B. 1" value={manual} onChange={(v) => (setManual(v), setError(null))} />
      <Button t={t} strong label="Öffnen" disabled={!manual.trim()} onPress={() => handle(manual)} />
      {current && <Button t={t} label={`Zurück zu ${current.toUpperCase()}`} onPress={onBack} />}
    </ScrollView>
  );
}

function PatientScreen({ t, conn, min, onSheet, onEnd, onAssist }: {
  t: Theme; conn: ReturnType<typeof useConnection>["conn"]; min: number; onSheet: (s: "actions" | "triage" | "scan" | "admit" | "handover" | "ask") => void; onEnd: () => void;
  onAssist: (patient: string) => void;
}) {
  const v = conn.view!;
  const p = v.patient!;
  const f = p.findings as Record<string, unknown>;
  const busy = v.me?.busy;
  const busyTitle = busy && (conn.welcome!.actions.find((a) => a.id === busy.action)?.title ?? busy.action);
  const exam = Object.entries((f.exam as Record<string, string>) ?? {});
  // B3: nur zeigen, was die eigene Rolle darf (ohne Trupp-Code darf jeder alles)
  const may = (what: "triage" | "admit" | "handover") => !roleRule(v.me?.role ?? "behandlung", what, { triaged: !!p.triage });
  // J3: Häkchen, wenn die eigene Maßnahme fertig ist (Vibration kommt aus Helfer).
  // Messung fertig: Wert im passenden Gerät zeigen (EKG-Monitor, Blutdruck, Blutzucker …).
  const lastBusy = useRef<{ id: string; title: string; waiting: boolean } | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceKind | null>(null);
  useEffect(() => {
    if (lastBusy.current && !busy && !lastBusy.current.waiting) {
      setFinished(lastBusy.current.title);
      if (DEVICE_OF[lastBusy.current.id]) setDevice(DEVICE_OF[lastBusy.current.id]);
    }
    lastBusy.current = busy ? { id: busy.action, title: String(busyTitle), waiting: !!busy.waiting } : null;
  }, [busy?.action, busy?.waiting]);
  const hasDevice = (k: DeviceKind) => !p.vitalsText && (k === "ecg" ? !!(f.exam as Record<string, string> | undefined)?.ecg : k === "temp" ? f.temp !== undefined : k === "glucose" ? !!(f.exam as Record<string, string> | undefined)?.glucose : f[k] !== undefined);
  useEffect(() => {
    if (!finished) return;
    const i = setTimeout(() => setFinished(null), 2500);
    return () => clearTimeout(i);
  }, [finished]);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Title t={t}>{p.id.toUpperCase()}</Title>
          {p.triage && (
            <Pop key={`${p.id}-${p.triage}`} quick>
              <View style={{ borderWidth: 2, borderColor: skColor(t, p.triage), backgroundColor: `${skColor(t, p.triage)}2E`, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 }}>
                <Text style={{ color: t.text, fontWeight: "600" }}>SK {p.triage}</Text>
              </View>
            </Pop>
          )}
        </View>
        {p.image && conn.server ? (
          <Image source={{ uri: httpBase(conn.server) + p.image }} accessibilityLabel="Bild des Patienten" resizeMode="cover"
            style={{ width: "100%", aspectRatio: 1, maxHeight: 260, borderRadius: 14, backgroundColor: t.tint }} />
        ) : null}
        <Text style={{ color: t.text, fontSize: 17, lineHeight: 24 }}>{p.picture}</Text>
        <Text style={{ color: t.quiet }}>Ort: {p.place}</Text>
        {p.left && <Text style={{ color: t.text, fontWeight: "600" }}>Abtransportiert. Scanne den nächsten Patienten.</Text>}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {VITALS.map(([label, k, unit]) => (
            <Pressable key={`${p.id}-${k}`} disabled={!CARD_DEVICE[k] || !hasDevice(CARD_DEVICE[k])} onPress={() => setDevice(CARD_DEVICE[k])}
              accessibilityRole={CARD_DEVICE[k] && hasDevice(CARD_DEVICE[k]) ? "button" : undefined} style={{ width: "31%", backgroundColor: t.card, borderRadius: 14, borderBottomWidth: 3, borderColor: t.edge }}>
              <Flash t={t} value={p.live ? null : f[k]}>
                <View style={{ padding: 10 }}>
                  <Text style={{ color: t.quiet, fontSize: 12 }}>{label}</Text>
                  {p.vitalsText?.[k] ? (
                    <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }}>{p.vitalsText[k]}</Text>
                  ) : (
                    <Text style={{ color: f[k] === undefined ? t.quiet : t.text, fontSize: 22, fontWeight: "600" }}>
                      {f[k] === undefined ? "–" : `${f[k]}${unit ?? ""}`}
                    </Text>
                  )}
                </View>
              </Flash>
            </Pressable>
          ))}
        </View>
        <Text style={{ color: t.quiet, fontSize: 12 }}>– = noch nicht gemessen</Text>
        {exam.map(([k, val]) => (
          <Text key={k} style={{ color: t.text }} onPress={k === "ecg" || k === "glucose" ? () => setDevice(k) : undefined}>
            <Text style={{ fontWeight: "600" }}>{EXAM[k] ?? k}: </Text>
            {val}{k === "ecg" || k === "glucose" ? "  ›" : ""}
          </Text>
        ))}
        {f.temp !== undefined && (
          <Text style={{ color: t.text }} onPress={() => setDevice("temp")}>
            <Text style={{ fontWeight: "600" }}>Temperatur: </Text>{String(f.temp).replace(".", ",")} °C  ›
          </Text>
        )}
        {(["temp", "glucose"] as const).filter((k) => p.vitalsText?.[k]).map((k) => (
          <Text key={k} style={{ color: t.text }}>
            <Text style={{ fontWeight: "600" }}>{k === "temp" ? "Temperatur" : "Blutzucker"}: </Text>{p.vitalsText![k]}
          </Text>
        ))}
      </ScrollView>
      <View style={{ padding: 20, gap: 10, borderTopWidth: 1, borderColor: t.line }}>
        {finished && !busy && (
          <Pop key={finished} quick>
            <Text style={{ color: t.text, fontWeight: "600" }} accessibilityLiveRegion="polite">✓ {finished} fertig</Text>
          </Pop>
        )}
        {busy?.waiting && (
          <View style={{ backgroundColor: t.tint, borderRadius: 10, padding: 12, gap: 8 }} accessibilityLiveRegion="polite">
            <Text style={{ color: t.text, fontWeight: "600" }}>Wartet auf einen zweiten Helfer: {busyTitle}</Text>
            <Text style={{ color: t.quiet }}>Ein Helfer am selben Patienten tippt auf „Mithelfen“, dann startet ihr gemeinsam.</Text>
            <Button t={t} label="Abbrechen" onPress={onEnd} />
          </View>
        )}
        {!busy && p.waiting && !p.left && (
          <Button t={t} strong label={`Mithelfen: ${conn.welcome!.actions.find((a) => a.id === p.waiting)?.title ?? p.waiting}`} note="ein anderer Helfer wartet auf dich" onPress={() => onAssist(p.id)} />
        )}
        {busy && !busy.waiting && (
          <View style={{ backgroundColor: t.tint, borderRadius: 10, padding: 12, gap: 8 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>
              {busyTitle} {busy.until === null ? "läuft dauerhaft" : `· noch ${clock((busy.until - min) * 60000)}`}
            </Text>
            {busy.until === null && <Button t={t} label="Beenden" onPress={onEnd} />}
          </View>
        )}
        {!p.left && <Button t={t} strong label="Maßnahme" disabled={!!busy} onPress={() => onSheet("actions")} />}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {!p.left && may("triage") && <View style={{ flex: 1 }}><Button t={t} label={p.triage ? "Nachsichten" : "Sichten"} disabled={!!busy} onPress={() => onSheet("triage")} /></View>}
          <View style={{ flex: 1 }}><Button t={t} strong={p.left} label="Scannen" disabled={!!busy} onPress={() => onSheet("scan")} /></View>
        </View>
        {!p.left && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button t={t} label="Fragen" onPress={() => onSheet("ask")} /></View>
            {may("admit") && <View style={{ flex: 1 }}><Button t={t} label="Aufnahme" disabled={!!busy} onPress={() => onSheet("admit")} /></View>}
            {may("handover") && <View style={{ flex: 1 }}><Button t={t} label="Übergabe" disabled={!!busy} onPress={() => onSheet("handover")} /></View>}
          </View>
        )}
      </View>
      {device && hasDevice(device) && <DeviceSheet kind={device} f={f as never} onClose={() => setDevice(null)} />}
    </View>
  );
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

function Result({ t, result }: { t: Theme; result: NonNullable<ViewData["result"]> | null }) {
  const points = useCountUp(result?.me.points ?? 0, 1200, 1800);
  if (!result)
    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Title t={t}>Übung beendet</Title>
        <Text style={{ color: t.quiet }}>Deine Auswertung erscheint hier, sobald der Praxisanleiter sie freigibt.</Text>
      </ScrollView>
    );
  const { team, me } = result;
  const list = (items: string[]) => items.map((x, i) => <Text key={i} style={{ color: t.text }}>• {x}</Text>);
  // J4: Sterne erscheinen nacheinander, Punkte zählen hoch, Abzeichen springen auf, „Nächstes Mal“ zuletzt.
  const after = 1800 + 1200;
  return (
    <View style={{ flex: 1 }}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 0, gap: 14 }}>
      <View style={{ borderRadius: 24, overflow: "hidden", height: 300 }}>
        <Stage color={STAGE}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 16 }}>
            <FlyIn from={-60}><Text style={{ color: "#FFFFFF", fontSize: 26, fontWeight: "900" }}>Übung beendet</Text></FlyIn>
            <View style={{ flexDirection: "row", gap: 6 }} accessibilityLabel={`${team.stars} von 3 Sternen`}>
              {[0, 1, 2].map((i) => (
                <FlyIn key={i} delay={300 + i * 450} from={-120} spin={i % 2 ? 160 : -160}>
                  <Text style={{ color: i < team.stars ? "#FFD54F" : "rgba(255,255,255,0.3)", fontSize: 52 }}>★</Text>
                </FlyIn>
              ))}
            </View>
            <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>{team.survived} von {team.eligible} Patienten überlebt</Text>
            <FlyIn delay={1600}>
              <View style={{ backgroundColor: "#FFFFFF", borderRadius: 16, paddingHorizontal: 22, paddingVertical: 8, alignItems: "center" }}>
                <Text style={{ color: FUN.purple, fontSize: 34, fontWeight: "900" }} accessibilityLabel={`${me.points} Punkte`}>{points >= 0 ? "+" : ""}{points}</Text>
                <Text style={{ color: "#333", fontWeight: "700" }}>Punkte · nur für dich</Text>
              </View>
            </FlyIn>
          </View>
        </Stage>
      </View>
      {me.badges.length > 0 && (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {me.badges.map((b, i) => <FlyIn key={b} delay={after + i * 350} spin={i % 2 ? 30 : -30} from={40}><Tile i={i} label={`🏅 ${b}`} /></FlyIn>)}
        </View>
      )}
      {me.good.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Gut gelaufen</Text>
          {list(me.good)}
        </View>
      )}
      {me.improve.length > 0 && (
        <Pop delay={after + me.badges.length * 350 + 300}>
          <View style={{ gap: 4, backgroundColor: t.tint, borderRadius: 12, padding: 14 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>Nächstes Mal</Text>
            {list(me.improve)}
          </View>
        </Pop>
      )}
      {me.feedback && (
        <View style={{ gap: 4, backgroundColor: t.card, borderRadius: 12, padding: 14, borderLeftWidth: 6, borderLeftColor: t.accent }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Rückmeldung der Leitung</Text>
          <Text style={{ color: t.text }}>{me.feedback}</Text>
        </View>
      )}
      {me.notes?.length > 0 && (
        <View style={{ gap: 4, borderWidth: 2, borderColor: t.edge, borderRadius: 12, padding: 14 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Beobachtet</Text>
          {list(me.notes)}
        </View>
      )}
      <Text style={{ color: t.quiet }}>
        {n(me.patients, "Patient", "Patienten")} · {n(me.actions, "Maßnahme", "Maßnahmen")} · {n(me.triages, "Sichtung", "Sichtungen")} · {Math.round(me.busyShare * 100)} % der Zeit in Maßnahmen
      </Text>
    </ScrollView>
    {team.stars >= 2 && <Confetti delay={1700} />}
    </View>
  );
}

function HandoverSheet({ t, patient, vehicles, onHandover, onClose }: {
  t: Theme; patient: string; vehicles: ViewData["vehicles"]; onHandover: (vehicle: string, destination: string, diagnosis: string) => void; onClose: () => void;
}) {
  const [vehicle, setVehicle] = useState("");
  const [destination, setDestination] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  return (
    <Sheet t={t} title={`Übergabe ${patient.toUpperCase()}`} onClose={onClose}>
      <Text style={{ color: t.quiet }}>Fahrzeug</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {vehicles.map((v) => (
          <Chip key={v.id} t={t} label={`${v.title} · ${!v.arrived ? "noch nicht da" : v.seats > 0 ? `${v.seats} frei` : "voll"}`}
            selected={vehicle === v.id} disabled={!v.arrived || v.seats < 1} onPress={() => setVehicle(v.id)} />
        ))}
      </View>
      <Field t={t} label="Zielklinik" value={destination} onChange={setDestination} />
      <Field t={t} label="Verdacht (z. B. instabile Beckenfraktur)" value={diagnosis} onChange={setDiagnosis} />
      <Button t={t} strong label="Übergeben" disabled={!vehicle || !destination.trim()} onPress={() => onHandover(vehicle, destination.trim(), diagnosis.trim())} />
    </Sheet>
  );
}

// Patient befragen als Chat: freie Frage (KI) oder Vorschlag nach SAMPLER (geht immer, auch ohne KI).
function Chat({ t, patient, picture, dialog, ai, online, error, onAsk, onClose }: {
  t: Theme; patient: string; picture: string; dialog: { q: string; a: string }[]; ai: boolean; online: boolean; error: string | null;
  onAsk: (q: { question: string; topic?: Topic }) => void; onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState<{ q: string; at: number } | null>(null); // eigene Frage, bis die Antwort da ist
  const scroll = useRef<ScrollView>(null);
  useEffect(() => setWaiting(null), [dialog.length, error]);
  const ask = (question: string, topic?: Topic) => {
    if (waiting) return;
    setWaiting({ q: question, at: dialog.length });
    onAsk({ question, ...(topic ? { topic } : {}) });
  };
  // G6: Sprechen statt Tippen und Antworten vorlesen (Stimme passend zur Persona); Vorlesen merkt sich das Gerät.
  const [tts, setTts] = useState(false);
  const [listening, setListening] = useState(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => void AsyncStorage.getItem("dps:tts").then((v) => setTts(v === "1")), []);
  const toggleTts = () => (setTts(!tts), AsyncStorage.setItem("dps:tts", tts ? "0" : "1"), tts && stopSpeaking());
  const heard = useRef(dialog.length);
  useEffect(() => {
    const last = dialog.at(-1);
    if (tts && dialog.length > heard.current && last && last.a !== SILENT) speak(last.a, voiceFor(picture));
    heard.current = dialog.length;
  }, [dialog.length]);
  useEffect(() => () => (stop.current?.(), stopSpeaking()), []);
  const mic = () => {
    if (listening) return stop.current?.();
    stopSpeaking();
    setListening(true);
    stop.current = listen((said, final) => (final && said.trim().length > 1 ? (ask(said.trim()), setText("")) : setText(said)), () => setListening(false));
  };
  const bubble = (mine: boolean, children: ReactNode, key: string) => (
    <View key={key} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "82%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18,
      borderBottomRightRadius: mine ? 4 : 18, borderBottomLeftRadius: mine ? 18 : 4, backgroundColor: mine ? t.accent : t.card }}>
      {children}
    </View>
  );
  return (
    <Overlay t={t} onClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderColor: t.line }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Zurück zum Patienten" onPress={onClose} hitSlop={12}>
          <Text style={{ color: t.text, fontSize: 28 }}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{patient.toUpperCase()}</Text>
          <Text style={{ color: t.quiet, fontSize: 13 }} numberOfLines={1}>{picture}</Text>
        </View>
        {canSpeak && <Chip t={t} label={tts ? "🔊 Vorlesen an" : "🔈 Vorlesen"} selected={tts} onPress={toggleTts} />}
      </View>
      <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd()} contentContainerStyle={{ padding: 16, gap: 8 }}>
        {!dialog.length && !waiting && <Text style={{ color: t.quiet, textAlign: "center", marginTop: 24 }}>Sprich den Patienten an – höflich und in ganzen Sätzen kommst du am weitesten.</Text>}
        {dialog.flatMap((d, i) => [
          bubble(true, <Text style={{ color: "#FFFFFF", fontSize: 16 }}>{d.q}</Text>, `q${i}`),
          bubble(false, <Text style={{ color: d.a === SILENT ? t.quiet : t.text, fontSize: 16, fontStyle: d.a === SILENT ? "italic" : "normal" }}>{d.a}</Text>, `a${i}`),
        ])}
        {waiting && bubble(true, <Text style={{ color: "#FFFFFF", fontSize: 16 }}>{waiting.q}</Text>, "wq")}
        {waiting && bubble(false, <Typing t={t} />, "wa")}
        {error && <Text style={{ color: t.red, textAlign: "center" }}>{error}</Text>}
      </ScrollView>
      <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {(Object.keys(QUICK) as Topic[]).map((topic) => (
          <Chip key={topic} t={t} label={QUICK[topic]} selected={false} disabled={!!waiting} onPress={() => ask(QUICK[topic], topic)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, paddingBottom: 28 }}>
        <TextInput value={text} onChangeText={setText} editable={ai} placeholder={listening ? "Ich höre zu …" : ai ? "Frage an den Patienten …" : "Freie Fragen brauchen die KI – tippe einen Vorschlag"}
          placeholderTextColor={t.quiet} accessibilityLabel="Frage an den Patienten" returnKeyType="send"
          onSubmitEditing={() => text.trim().length > 1 && (ask(text.trim()), setText(""))}
          style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: t.line, borderRadius: 24, paddingHorizontal: 16, color: t.text, fontSize: 16 }} />
        {canListen && ai && (
          <Pressable accessibilityRole="button" accessibilityLabel={listening ? "Zuhören beenden" : "Frage sprechen"} accessibilityState={{ selected: listening }} {...pressed(listening)}
            disabled={!online || !!waiting} onPress={mic}
            style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
              backgroundColor: listening ? t.accent : t.card, borderWidth: 2, borderColor: listening ? t.accent : t.edge, opacity: !online || waiting ? 0.3 : pressed ? 0.7 : 1 })}>
            <Text style={{ fontSize: 20, color: listening ? "#FFFFFF" : t.text }}>{listening ? "■" : "🎤"}</Text>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Senden" disabled={!ai || !online || !!waiting || text.trim().length < 2}
          onPress={() => (ask(text.trim()), setText(""))}
          style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: t.text,
            opacity: !ai || !online || waiting || text.trim().length < 2 ? 0.3 : pressed ? 0.7 : 1 })}>
          <Text style={{ color: t.bg, fontSize: 20, fontWeight: "700" }}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
    </Overlay>
  );
}

// „Patient tippt …“: drei pulsierende Punkte.
function Typing({ t }: { t: Theme }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(a, { toValue: 3, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [a]);
  return (
    <View style={{ flexDirection: "row", gap: 4, paddingVertical: 6 }} accessibilityLabel="Patient antwortet">
      {[0, 1, 2].map((i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.quiet,
          opacity: a.interpolate({ inputRange: [i, i + 0.5, i + 1, 3], outputRange: [0.3, 1, 0.3, 0.3], extrapolate: "clamp" }) }} />
      ))}
    </View>
  );
}

// J2 auf dem Handy: nach dem Beitritt bis zum Start.
function Waiting({ name, trupp, title }: { t: Theme; name: string; trupp: string | null; title: string }) {
  return (
    <Stage color={STAGE} style={{ margin: 12, marginTop: 0, borderRadius: 24 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 18 }}>
        <FlyIn><Text style={{ color: "#FFFFFF", fontSize: 32, fontWeight: "900", textAlign: "center" }}>Du bist dabei!</Text></FlyIn>
        <FlyIn delay={250} spin={-20}><Breathe amount={0.06}><Tile i={1} label={name} big /></Breathe></FlyIn>
        {trupp && <FlyIn delay={400}><Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }}>{trupp}</Text></FlyIn>}
        <Text style={{ color: "#FFFFFF", textAlign: "center", opacity: 0.9 }}>{title}</Text>
        <Dots />
        <Text style={{ color: "#FFFFFF", textAlign: "center", opacity: 0.85 }}>Gleich geht's los – warte auf den Start durch die Übungsleitung.</Text>
      </View>
    </Stage>
  );
}

// Beim Start einmal "Los geht's!", danach der ruhige Einsatzmodus (J6).
function Go({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const i = setTimeout(onDone, 1400);
    return () => clearTimeout(i);
  }, []);
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
      <Stage color={FUN.green}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} accessibilityLiveRegion="assertive">
          <FlyIn spin={-15}><Text style={{ color: "#FFFFFF", fontSize: 64, fontWeight: "900" }}>Los geht's!</Text></FlyIn>
        </View>
      </Stage>
    </View>
  );
}

// B3: Führung (OrgL, LNA, UA-Leiter): Verstärkung bei der Leitstelle anfordern und entscheiden, wer zuerst abtransportiert wird.
function LageSheet({ t, lage, min, onRequest, onClear, onClose }: {
  t: Theme; lage: NonNullable<ViewData["lage"]>; min: number; onRequest: (kind: "rtw" | "nef" | "nktw" | "ktw") => void; onClear: (patient: string) => void; onClose: () => void;
}) {
  const waiting = lage.patients.filter((p) => !p.left);
  return (
    <Sheet t={t} title="Lage & Verstärkung" onClose={onClose}>
      <Text style={{ color: t.text, fontWeight: "900", fontSize: 18 }}>Verstärkung bei der Leitstelle anfordern</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {([["rtw", "RTW", "10 min"], ["nef", "NEF", "8 min"], ["nktw", "NKTW", "12 min"], ["ktw", "KTW", "15 min"]] as const).map(([kind, label, eta]) => (
          <View key={kind} style={{ flexGrow: 1, flexBasis: "45%" }}><Button t={t} label={label} note={`in ${eta}`} onPress={() => onRequest(kind)} /></View>
        ))}
      </View>
      {lage.vehicles.map((v, i) => (
        <Text key={i} style={{ color: v.arrived ? t.text : t.quiet }}>
          {v.title} · {v.arrived ? `vor Ort${v.seats ? ` · ${v.seats} Platz frei` : ""}` : `kommt in ${clock(Math.max(0, v.arrivesAt - min) * 60000)}`}
        </Text>
      ))}
      <Text style={{ color: t.text, fontWeight: "900", fontSize: 18, marginTop: 8 }}>Transportreihenfolge</Text>
      <Text style={{ color: t.quiet }}>Freigegebene Patienten darf der Sicherungstrupp an ein Fahrzeug abgeben. Gib die dringendsten zuerst frei.</Text>
      {waiting.map((p) => (
        <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 10, alignSelf: "stretch", borderRadius: 5, backgroundColor: p.triage ? skColor(t, p.triage) : t.line }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "800" }}>{p.id.toUpperCase()} · {p.triage ? `SK ${p.triage}` : "nicht gesichtet"}</Text>
            <Text style={{ color: t.quiet }}>{p.place}</Text>
          </View>
          {p.cleared ? <Text style={{ color: t.green, fontWeight: "800" }}>✓ freigegeben</Text>
            : <View style={{ width: 130 }}><Button t={t} strong label="Freigeben" onPress={() => onClear(p.id)} /></View>}
        </View>
      ))}
      {lage.patients.some((p) => p.left) && <Text style={{ color: t.quiet }}>Abtransportiert: {lage.patients.filter((p) => p.left).map((p) => p.id.toUpperCase()).join(", ")}</Text>}
    </Sheet>
  );
}
