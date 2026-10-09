// dPS-App: Rollenwahl, Helfer-Ablauf (Meilenstein 2) und Praxisanleiter (Meilenstein 3, src/leitung.tsx).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScrollView, Text, Vibration, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Sk } from "@dps/schema";
import type { Status, View as ViewData } from "@dps/schema/protocol";
import { DEFAULT_SERVER, exerciseMinutes, lastConnection, useConnection } from "./src/connection";
import { Badge, Button, Chip, Field, SK, Sheet, Stars, Title, clock, dark, light, skColor, type Theme } from "./src/ui";
import { Leitung } from "./src/leitung";

const VITALS: [string, string, string?][] = [["AF", "rr"], ["HF", "hr"], ["RR", "bp"], ["SpO₂", "spo2", " %"], ["GCS", "gcs"], ["Rekap", "recap", " s"]];
const EXAM: Record<string, string> = {
  auscultation: "Auskultation", percussion: "Perkussion", pupils: "Pupillen", motor: "Motorik", pelvis: "Becken",
  abdomen: "Bauch", burn: "Verbrennung", airway: "Atemweg",
};
const MATERIAL: Record<string, string> = {
  tourniquet: "Tourniquet", dressing: "Verband", wendl: "Wendl-Tubus", o2_mask: "O₂-Maske", needle: "Punktionsnadel", ett: "Tubus",
  iv_cannula: "Venenkanüle", infusion: "Infusion", analgesic: "Analgetikum", pelvic_binder: "Beckengurt", splint: "Schiene", rescue_blanket: "Rettungsdecke",
};
const STATUS: Record<Status, string> = { ready: "noch nicht gestartet", running: "", paused: "pausiert", ended: "beendet" };

// QR-Inhalt "dps:<CODE>:p01" (nur für diese Übung) oder Nummer "1" / "P01".
export function parseScan(raw: string, code: string): { id: string } | { error: string } {
  const m = raw.trim().toLowerCase().match(/^(?:dps:(?:([a-z0-9]{6}):)?)?p?(\d{1,3})$/);
  if (!m) return { error: "kein Patienten-Code" };
  if (m[1] && m[1].toUpperCase() !== code.toUpperCase()) return { error: "QR-Code gehört zu einer anderen Übung" };
  return { id: `p${m[2].padStart(2, "0")}` };
}

export default function App() {
  const t = useColorScheme() === "dark" ? dark : light;
  const [role, setRole] = useState<"helfer" | "leitung" | null>(null);
  useEffect(() => {
    AsyncStorage.getItem("dps:role").then((r) => (r === "helfer" || r === "leitung") && setRole(r));
  }, []);
  const choose = (r: typeof role) => (setRole(r), AsyncStorage.setItem("dps:role", r ?? ""));
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: 48 }}>
      <StatusBar style="auto" />
      {role === "helfer" ? <Helfer t={t} onExit={() => choose(null)} /> : role === "leitung" ? <Leitung t={t} onExit={() => choose(null)} /> : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
          <Title t={t}>dPS</Title>
          <Text style={{ color: t.quiet }}>Dynamische Patientensimulation</Text>
          <Button t={t} strong label="Ich übe (Helfer)" onPress={() => choose("helfer")} />
          <Button t={t} label="Ich leite (Praxisanleiter)" onPress={() => choose("leitung")} />
        </ScrollView>
      )}
    </View>
  );
}

function Helfer({ t, onExit }: { t: Theme; onExit: () => void }) {
  const { conn, connect, send } = useConnection();
  const [sheet, setSheet] = useState<null | "actions" | "triage" | "scan" | "admit" | "handover">(null);
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
  const min = exerciseMinutes(conn.clock, conn.offset, now);
  let body: ReactNode;
  if (!w) body = <Connect t={t} status={conn.status} error={conn.error} onConnect={connect} onExit={onExit} />;
  else if (conn.participant && conn.clock?.status === "ended") body = <Result t={t} result={conn.view?.result ?? null} />;
  else if (!conn.participant)
    body = <Join t={t} units={w.units} trupp={w.trupp} online={conn.status === "online"} onJoin={(name, unit) => send({ type: "join", name, ...(unit ? { unit } : {}) })} />;
  else if (sheet === "scan" || !conn.view?.patient)
    body = <Scan t={t} code={conn.code} current={conn.view?.patient?.id}
      onScan={(patient) => (send({ type: "scan", patient }), setSheet(null))} onBack={() => setSheet(null)} />;
  else body = <PatientScreen t={t} conn={conn} min={min} onSheet={setSheet} onEnd={() => send({ type: "end" })} />;

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
      {conn.error && w && <Text style={{ color: t.red, paddingHorizontal: 20, paddingBottom: 8 }}>{conn.error}</Text>}
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
      {sheet === "admit" && conn.view?.patient && (
        <Sheet t={t} title={`Aufnahme ${conn.view.patient.id.toUpperCase()}`} onClose={() => setSheet(null)}>
          {(["ablage", "bhp"] as const).map((place) => (
            <Button key={place} t={t} strong label={place === "ablage" ? "Patientenablage" : "Behandlungsplatz"}
              onPress={() => (send({ type: "admit", patient: conn.view!.patient!.id, place }), setSheet(null))} />
          ))}
        </Sheet>
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

function Connect({ t, status, error, onConnect, onExit }: { t: Theme; status: string; error: string | null; onConnect: (server: string, code: string) => void; onExit: () => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [code, setCode] = useState("");
  useEffect(() => {
    lastConnection().then((l) => l && (setServer(l.server), setCode(l.code)));
  }, []);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Übung beitreten</Title>
      <Field t={t} label="Server" value={server} onChange={setServer} />
      <Field t={t} label="Übungscode" value={code} onChange={(v) => setCode(v.toUpperCase())} />
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label={status === "connecting" ? "Verbinde …" : "Verbinden"} disabled={!code || !server} onPress={() => onConnect(server.trim(), code.trim())} />
      <Button t={t} label="Rolle wechseln" onPress={onExit} />
    </ScrollView>
  );
}

const ROLE: Record<string, string> = { sichtung: "Sichtung", behandlung: "Behandlung", transport: "Transport" };

function Join({ t, units, trupp, online, onJoin }: {
  t: Theme; units: { id: string; title: string }[]; trupp: { name: string; role: string; unit: string } | null; online: boolean; onJoin: (name: string, unit?: string) => void;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Beitreten</Title>
      {trupp && <Text style={{ color: t.text, fontSize: 17 }}>{trupp.name} · {trupp.unit} · {ROLE[trupp.role]}</Text>}
      <Field t={t} label="Name oder Kürzel" value={name} onChange={setName} />
      {!trupp && (
        <>
          <Text style={{ color: t.quiet }}>Einheit</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {units.map((u) => <Chip key={u.id} t={t} label={u.title} selected={unit === u.id} onPress={() => setUnit(u.id)} />)}
          </View>
        </>
      )}
      <Button t={t} strong label="Beitreten" disabled={!online || !name.trim() || (!trupp && !unit)} onPress={() => onJoin(name.trim(), trupp ? undefined : unit)} />
    </ScrollView>
  );
}

function Scan({ t, code, current, onScan, onBack }: { t: Theme; code: string; current?: string; onScan: (patient: string) => void; onBack: () => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const handle = (raw: string) => {
    if (locked.current) return;
    const r = parseScan(raw, code);
    if ("error" in r) return setError(r.error);
    locked.current = true;
    onScan(r.id);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Patient scannen</Title>
      {permission?.granted ? (
        <CameraView style={{ height: 320, borderRadius: 16, overflow: "hidden" }} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => handle(r.data)} />
      ) : (
        <Button t={t} label="Kamera erlauben" onPress={requestPermission} />
      )}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Field t={t} label="Oder Patientennummer eingeben, z. B. 1" value={manual} onChange={(v) => (setManual(v), setError(null))} />
      <Button t={t} strong label="Öffnen" disabled={!manual.trim()} onPress={() => handle(manual)} />
      {current && <Button t={t} label={`Zurück zu ${current.toUpperCase()}`} onPress={onBack} />}
    </ScrollView>
  );
}

function PatientScreen({ t, conn, min, onSheet, onEnd }: {
  t: Theme; conn: ReturnType<typeof useConnection>["conn"]; min: number; onSheet: (s: "actions" | "triage" | "scan" | "admit" | "handover") => void; onEnd: () => void;
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
          {p.triage && (
            <View style={{ borderWidth: 2, borderColor: skColor(t, p.triage), borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: t.text, fontWeight: "600" }}>SK {p.triage}</Text>
            </View>
          )}
        </View>
        <Text style={{ color: t.text, fontSize: 17, lineHeight: 24 }}>{p.picture}</Text>
        <Text style={{ color: t.quiet }}>Ort: {p.place}</Text>
        {p.left && <Text style={{ color: t.text, fontWeight: "600" }}>Abtransportiert. Scanne den nächsten Patienten.</Text>}
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
              {busyTitle} {busy.until === null ? "läuft dauerhaft" : `· noch ${clock((busy.until - min) * 60000)}`}
            </Text>
            {busy.until === null && <Button t={t} label="Beenden" onPress={onEnd} />}
          </View>
        )}
        {!p.left && <Button t={t} strong label="Maßnahme" disabled={!!busy} onPress={() => onSheet("actions")} />}
        <View style={{ flexDirection: "row", gap: 10 }}>
          {!p.left && <View style={{ flex: 1 }}><Button t={t} label="Sichten" disabled={!!busy} onPress={() => onSheet("triage")} /></View>}
          <View style={{ flex: 1 }}><Button t={t} strong={p.left} label="Scannen" disabled={!!busy} onPress={() => onSheet("scan")} /></View>
        </View>
        {!p.left && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1 }}><Button t={t} label="Aufnahme" disabled={!!busy} onPress={() => onSheet("admit")} /></View>
            {v.me?.role !== "sichtung" && <View style={{ flex: 1 }}><Button t={t} label="Übergabe" disabled={!!busy} onPress={() => onSheet("handover")} /></View>}
          </View>
        )}
      </View>
    </View>
  );
}

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

function Result({ t, result }: { t: Theme; result: NonNullable<ViewData["result"]> | null }) {
  if (!result)
    return (
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <Title t={t}>Übung beendet</Title>
        <Text style={{ color: t.quiet }}>Deine Auswertung erscheint hier, sobald der Praxisanleiter sie freigibt.</Text>
      </ScrollView>
    );
  const { team, me } = result;
  const list = (items: string[]) => items.map((x, i) => <Text key={i} style={{ color: t.text }}>• {x}</Text>);
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Title t={t}>Übung beendet</Title>
      <View style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View>
          <Text style={{ color: t.quiet }}>Team-Ergebnis</Text>
          <Stars t={t} stars={team.stars} />
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 17 }}>{team.survived} von {team.eligible}</Text>
          <Text style={{ color: t.quiet }}>Patienten überlebt</Text>
        </View>
      </View>
      <View>
        <Text style={{ color: t.text, fontSize: 28, fontWeight: "600" }}>{me.points >= 0 ? "+" : ""}{me.points} Punkte</Text>
        <Text style={{ color: t.quiet }}>nur für dich sichtbar</Text>
      </View>
      {me.badges.length > 0 && <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{me.badges.map((b) => <Badge key={b} t={t} label={b} />)}</View>}
      {me.good.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Gut gelaufen</Text>
          {list(me.good)}
        </View>
      )}
      {me.improve.length > 0 && (
        <View style={{ gap: 4, backgroundColor: t.tint, borderRadius: 12, padding: 14 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>Nächstes Mal</Text>
          {list(me.improve)}
        </View>
      )}
      <Text style={{ color: t.quiet }}>
        {n(me.patients, "Patient", "Patienten")} · {n(me.actions, "Maßnahme", "Maßnahmen")} · {n(me.triages, "Sichtung", "Sichtungen")} · {Math.round(me.busyShare * 100)} % der Zeit in Maßnahmen
      </Text>
    </ScrollView>
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
