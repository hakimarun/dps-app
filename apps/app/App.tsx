// Helfer-App (Meilenstein 2): Verbinden, Beitreten, Scannen, Befunde, Maßnahmen, Sichtung, Offline-Puffer.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, Vibration, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Sk } from "@dps/schema";
import { lastConnection, useConnection } from "./src/connection";

const light = { bg: "#FFFFFF", text: "#111111", quiet: "#666666", line: "#E0E0E0", tint: "#F2F2F2", green: "#2E7D32" };
const dark = { bg: "#0B0B0B", text: "#F2F2F2", quiet: "#A0A0A0", line: "#2A2A2A", tint: "#1A1A1A", green: "#66BB6A" };
type Theme = typeof light;

// Farbe nur als Bedeutung: Sichtungskategorien.
const SK: Record<Sk, { label: string; light: string | null; dark: string | null }> = {
  I: { label: "I · rot · sofort", light: "#C62828", dark: "#EF5350" },
  II: { label: "II · gelb · dringend", light: "#F9A825", dark: "#FDD835" },
  III: { label: "III · grün · später", light: "#2E7D32", dark: "#66BB6A" },
  IV: { label: "IV · blau · abwartend", light: "#1565C0", dark: "#42A5F5" },
  EX: { label: "EX · tot", light: null, dark: null },
};
const VITALS: [string, string, string?][] = [["AF", "rr"], ["HF", "hr"], ["RR", "bp"], ["SpO₂", "spo2", " %"], ["GCS", "gcs"], ["Rekap", "recap", " s"]];
const EXAM: Record<string, string> = {
  auscultation: "Auskultation", percussion: "Perkussion", pupils: "Pupillen", motor: "Motorik", pelvis: "Becken",
  abdomen: "Bauch", burn: "Verbrennung", airway: "Atemweg",
};
const MATERIAL: Record<string, string> = {
  tourniquet: "Tourniquet", dressing: "Verband", wendl: "Wendl-Tubus", o2_mask: "O₂-Maske", needle: "Punktionsnadel", ett: "Tubus",
  iv_cannula: "Venenkanüle", infusion: "Infusion", analgesic: "Analgetikum", pelvic_binder: "Beckengurt", splint: "Schiene", rescue_blanket: "Rettungsdecke",
};
const DEFAULT_SERVER = process.env.EXPO_PUBLIC_SERVER_URL ?? "ws://localhost:3000";

// "dps:p01", "P01", "1" -> "p01"
export function patientId(raw: string): string | null {
  const m = raw.trim().toLowerCase().replace(/^dps:/, "").match(/^p?(\d{1,3})$/);
  return m ? `p${m[1].padStart(2, "0")}` : null;
}
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function App() {
  const t = useColorScheme() === "dark" ? dark : light;
  const { conn, connect, send } = useConnection();
  const [sheet, setSheet] = useState<null | "actions" | "triage" | "scan">(null);
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

  const w = conn.welcome;
  const serverNow = now + conn.offset;
  let body: ReactNode;
  if (!w) body = <Connect t={t} status={conn.status} error={conn.error} onConnect={connect} />;
  else if (!conn.participant) body = <Join t={t} units={w.units} online={conn.status === "online"} onJoin={(name, unit) => send({ type: "join", name, unit })} />;
  else if (sheet === "scan" || !conn.view?.patient)
    body = <Scan t={t} current={conn.view?.patient?.id} onScan={(patient) => (send({ type: "scan", patient }), setSheet(null))} onBack={() => setSheet(null)} />;
  else body = <PatientScreen t={t} conn={conn} serverNow={serverNow} onSheet={setSheet} onEnd={() => send({ type: "end" })} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 48 }}>
      <StatusBar style="auto" />
      {w && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text style={{ color: t.quiet, fontSize: 13 }}>{clock(serverNow - w.startedAt)}</Text>
          <Text style={{ color: conn.status === "online" ? t.green : t.quiet, fontSize: 13 }}>
            {conn.status === "online" ? "● online" : "○ offline"}
            {conn.queued > 0 && conn.participant ? ` · puffert ${conn.queued}` : ""}
          </Text>
        </View>
      )}
      {conn.error && w && <Text style={{ color: SK.I.light!, paddingHorizontal: 20, paddingBottom: 8 }}>{conn.error}</Text>}
      {body}
      {sheet === "actions" && conn.view && w && (
        <Sheet t={t} title="Maßnahme" onClose={() => setSheet(null)}>
          {w.actions.map((a) => {
            const missing = Object.entries(a.material).filter(([item, n]) => (conn.view!.inventory[item] ?? 0) < n);
            const disabled = !conn.view!.unitArrived || missing.length > 0;
            const note = !conn.view!.unitArrived ? "Einheit noch nicht da" : missing.length ? `kein ${MATERIAL[missing[0][0]] ?? missing[0][0]}` : a.minutes === null ? "dauerhaft" : a.minutes < 1 ? `${a.minutes * 60} s` : `${a.minutes} min`;
            return (
              <Button key={a.id} t={t} label={a.title} note={note} disabled={disabled}
                onPress={() => (send({ type: "start", patient: conn.view!.patient!.id, action: a.id }), setSheet(null))} />
            );
          })}
        </Sheet>
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

function Connect({ t, status, error, onConnect }: { t: Theme; status: string; error: string | null; onConnect: (server: string, code: string) => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [code, setCode] = useState("");
  useEffect(() => {
    lastConnection().then((l) => l && (setServer(l.server), setCode(l.code)));
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>dPS</Title>
      <Text style={{ color: t.quiet }}>Dynamische Patientensimulation</Text>
      <Field t={t} label="Server" value={server} onChange={setServer} />
      <Field t={t} label="Übungscode" value={code} onChange={(v) => setCode(v.toUpperCase())} />
      {error && <Text style={{ color: SK.I.light! }}>{error}</Text>}
      <Button t={t} strong label={status === "connecting" ? "Verbinde …" : "Verbinden"} disabled={!code || !server} onPress={() => onConnect(server.trim(), code.trim())} />
    </ScrollView>
  );
}

function Join({ t, units, online, onJoin }: { t: Theme; units: { id: string; title: string }[]; online: boolean; onJoin: (name: string, unit: string) => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Beitreten</Title>
      <Field t={t} label="Name oder Kürzel" value={name} onChange={setName} />
      <Text style={{ color: t.quiet }}>Einheit</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {units.map((u) => (
          <Pressable key={u.id} accessibilityRole="button" onPress={() => setUnit(u.id)}
            style={{ minHeight: 48, paddingHorizontal: 16, justifyContent: "center", borderRadius: 24, borderWidth: unit === u.id ? 2 : 1, borderColor: unit === u.id ? t.text : t.line }}>
            <Text style={{ color: t.text, fontWeight: unit === u.id ? "600" : "400" }}>{u.title}</Text>
          </Pressable>
        ))}
      </View>
      <Button t={t} strong label="Beitreten" disabled={!online || !name.trim() || !unit} onPress={() => onJoin(name.trim(), unit)} />
    </ScrollView>
  );
}

function Scan({ t, current, onScan, onBack }: { t: Theme; current?: string; onScan: (patient: string) => void; onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const locked = useRef(false);
  const handle = (raw: string) => {
    const id = patientId(raw);
    if (!id || locked.current) return;
    locked.current = true;
    onScan(id);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Patient scannen</Title>
      {permission?.granted ? (
        <CameraView style={{ height: 320, borderRadius: 16, overflow: "hidden" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => handle(r.data)} />
      ) : (
        <Button t={t} label="Kamera erlauben" onPress={requestPermission} />
      )}
      <Field t={t} label="Oder Patientennummer eingeben, z. B. 1" value={manual} onChange={setManual} />
      <Button t={t} strong label="Öffnen" disabled={!patientId(manual)} onPress={() => handle(manual)} />
      {current && <Button t={t} label={`Zurück zu ${current.toUpperCase()}`} onPress={onBack} />}
    </ScrollView>
  );
}

function PatientScreen({ t, conn, serverNow, onSheet, onEnd }: {
  t: Theme; conn: ReturnType<typeof useConnection>["conn"]; serverNow: number; onSheet: (s: "actions" | "triage" | "scan") => void; onEnd: () => void;
}) {
  const v = conn.view!;
  const p = v.patient!;
  const f = p.findings as Record<string, unknown>;
  const busy = v.me?.busy;
  const busyTitle = busy && (conn.welcome!.actions.find((a) => a.id === busy.action)?.title ?? busy.action);
  const exam = Object.entries((f.exam as Record<string, string>) ?? {});
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Title t={t}>{p.id.toUpperCase()}</Title>
          {p.triage && <TriageChip t={t} sk={p.triage} />}
        </View>
        <Text style={{ color: t.text, fontSize: 17, lineHeight: 24 }}>{p.picture}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {VITALS.map(([label, k, unit]) => (
            <View key={k} style={{ width: "31%", borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10 }}>
              <Text style={{ color: t.quiet, fontSize: 12 }}>{label}</Text>
              <Text style={{ color: f[k] === undefined ? t.quiet : t.text, fontSize: 22, fontWeight: "600" }}>
                {f[k] === undefined ? "–" : `${f[k]}${unit ?? ""}`}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ color: t.quiet, fontSize: 12 }}>– = noch nicht gemessen</Text>
        {exam.map(([k, val]) => (
          <Text key={k} style={{ color: t.text }}>
            <Text style={{ fontWeight: "600" }}>{EXAM[k] ?? k}: </Text>
            {val}
          </Text>
        ))}
      </ScrollView>
      <View style={{ padding: 20, gap: 10, borderTopWidth: 1, borderColor: t.line }}>
        {busy && (
          <View style={{ backgroundColor: t.tint, borderRadius: 10, padding: 12, gap: 8 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>
              {busyTitle} {busy.until === null ? "läuft dauerhaft" : `· noch ${clock(conn.welcome!.startedAt + busy.until * 60000 - serverNow)}`}
            </Text>
            {busy.until === null && <Button t={t} label="Beenden" onPress={onEnd} />}
          </View>
        )}
        <Button t={t} strong label="Maßnahme" disabled={!!busy} onPress={() => onSheet("actions")} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}><Button t={t} label="Sichten" disabled={!!busy} onPress={() => onSheet("triage")} /></View>
          <View style={{ flex: 1 }}><Button t={t} label="Scannen" disabled={!!busy} onPress={() => onSheet("scan")} /></View>
        </View>
      </View>
    </View>
  );
}

function TriageChip({ t, sk }: { t: Theme; sk: Sk }) {
  const color = (t === dark ? SK[sk].dark : SK[sk].light) ?? t.text;
  return (
    <View style={{ borderWidth: 2, borderColor: color, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text style={{ color: t.text, fontWeight: "600" }}>SK {sk}</Text>
    </View>
  );
}

function Sheet({ t, title, onClose, children }: { t: Theme; title: string; onClose: () => void; children: ReactNode }) {
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

function Title({ t, children }: { t: Theme; children: ReactNode }) {
  return <Text style={{ color: t.text, fontSize: 28, fontWeight: "700" }}>{children}</Text>;
}

function Field({ t, label, value, onChange }: { t: Theme; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.quiet }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label}
        style={{ minHeight: 48, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, color: t.text, fontSize: 17 }} />
    </View>
  );
}

function Button({ t, label, note, onPress, disabled, strong, color }: {
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
