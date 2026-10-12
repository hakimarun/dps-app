// Spielleitung: ohne Konto (Geräteschlüssel), Bibliothek,
// Übung anlegen, QR-Zettel, Start/Pause/Ende und Live-Lage.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Sk } from "@dps/schema";
import { ROLE_LABEL, Role, type Evaluation, type Level, type LeitungView, type ServerMsg, type Status } from "@dps/schema/protocol";
import { exerciseMinutes } from "./connection";
import { Badge, Button, Card, Chip, Field, Logo, Sheet, pressed, Stars, Title, clock, light, skColor, useCountUp, useReducedMotion, type Theme } from "./ui";
import { Breathe, Confetti, Dots, FUN, FlyIn, FunButton, Rise, STAGE, Stage, TILE, Tile, Wiggle } from "./fun";
import { api, httpBase, useLibrary, type Session } from "./api";
import { LibraryScreen } from "./library";
import { ReplaySheet, exportCsv, openReport } from "./replay";

type ExerciseInfo = { code: string; title: string; status: Status; patients: string[]; observer: string | null };
type Clock = Extract<ServerMsg, { type: "clock" }>;

const STATUS: Record<Status, string> = { ready: "bereit", running: "läuft", paused: "pausiert", ended: "beendet" };
const STATUS_COLOR: Record<Status, string> = { ready: FUN.blue, running: FUN.green, paused: FUN.gold, ended: FUN.purple };
const LEVELS: [Level, string][] = [["einsteiger", "Einsteiger"], ["fortgeschritten", "Fortgeschritten"], ["experte", "Experte"]];
const LEVEL_MINUTES: Record<Level, number> = { einsteiger: 20, fortgeschritten: 15, experte: 12 }; // wie LEVELS im Server
// G11: Temperamente zum Umschalten in der Live-Lage
const LATE_STEPS = [0, 10, 15, 20];
const MOODS = ["kooperativ", "ängstlich", "panisch", "aggressiv", "verwirrt", "verharmlosend"];
const ALGOS: [string, string][] = [["mstart", "mSTaRT"], ["prior", "PRIOR"], ["asav", "ASAV"]];
// Spielleitung ohne Konto: Das Gerät holt sich beim ersten Mal einen Schlüssel, daran hängen seine Spiele und Fälle.
export function Leitung({ t, server, startNew, onExit }: { t: Theme; server: string; startNew: boolean; onExit: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem("dps:device").then(async (v) => {
      const known = v ? (JSON.parse(v) as Session) : null;
      if (known?.server === server) return setSession(known);
      const { token } = await api<{ token: string }>({ server, token: "" }, "/api/device", {});
      const s = { server, token };
      await AsyncStorage.setItem("dps:device", JSON.stringify(s));
      setSession(s);
    }).catch((e: Error) => setError(e.message === "Failed to fetch" ? "Server nicht erreichbar" : e.message));
  }, [server]);
  if (!session)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: error ? t.red : t.quiet }}>{error ?? "einen Moment …"}</Text>
        <Text style={{ color: t.text, fontWeight: "700" }} accessibilityRole="button" onPress={onExit}>‹ Zur Startseite</Text>
      </View>
    );
  return <Home t={t} session={session} startNew={startNew} onExit={onExit} />;
}

function Home({ t, session, startNew, onExit }: { t: Theme; session: Session; startNew: boolean; onExit: () => void }) {
  const [tab, setTab] = useState<"uebungen" | "bibliothek">("uebungen");
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <ExerciseScreen t={t} session={session} code={open} onBack={() => setOpen(null)} />;
  return (
    <View style={{ flex: 1 }}>
      {/* Kopfleiste wie bei Kahoot: Bühnenfarbe bis unter die Statusleiste, Logo und weiße Reiter */}
      <View style={{ backgroundColor: STAGE, marginTop: -48, paddingTop: 56, paddingBottom: 14, paddingHorizontal: 20, marginBottom: 12,
        borderBottomLeftRadius: 22, borderBottomRightRadius: 22, flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Logo t={{ ...light, marke: FUN.red }} size={34} />
        <View style={{ flexDirection: "row", gap: 8, flex: 1, justifyContent: "flex-end" }}>
          {([["uebungen", "Übungen"], ["bibliothek", "Bibliothek"]] as const).map(([id, label]) => (
            <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: tab === id }} {...pressed(tab === id)} onPress={() => setTab(id)}
              style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, backgroundColor: tab === id ? "#FFFFFF" : "rgba(255,255,255,0.18)" }}>
              <Text style={{ color: tab === id ? STAGE : "#FFFFFF", fontWeight: "900" }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={{ flex: 1 }}>{tab === "bibliothek" ? <LibraryScreen t={t} session={session} /> : <Exercises t={t} session={session} startNew={startNew} onOpen={setOpen} />}</View>
      <View style={{ padding: 20, borderTopWidth: 1, borderColor: t.line }}>
        <Text style={{ color: t.text, fontWeight: "600" }} accessibilityRole="button" onPress={onExit}>‹ Zur Startseite</Text>
      </View>
    </View>
  );
}

function Exercises({ t, session, startNew, onOpen }: { t: Theme; session: Session; startNew: boolean; onOpen: (code: string) => void }) {
  const [list, setList] = useState<ExerciseInfo[] | null>(null);
  const [creating, setCreating] = useState(startNew);
  const [comparing, setComparing] = useState(false);
  useEffect(() => void api<ExerciseInfo[]>(session, "/api/exercises").then(setList), [session.token, creating]);
  if (creating) return <NewExercise t={t} session={session} onCreated={onOpen} onCancel={() => setCreating(false)} />;
  if (comparing) return <Compare t={t} session={session} onClose={() => setComparing(false)} />;
  const ended = list?.filter((ex) => ex.status === "ended").length ?? 0;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
      <Title t={t}>Übungen</Title>
      <FunButton label="+ Neue Übung" color={FUN.purple} text="#FFFFFF" onPress={() => setCreating(true)} />
      {ended >= 2 && <Button t={t} label="Durchgänge vergleichen" note={`${ended} beendete Übungen`} onPress={() => setComparing(true)} />}
      {list?.map((ex) => (
        <Card key={ex.code} t={t} color={STATUS_COLOR[ex.status]} onPress={() => onOpen(ex.code)}>
          <Text style={{ color: t.text, fontWeight: "900", fontSize: 18, letterSpacing: 1 }}>{ex.code}</Text>
          <Text style={{ color: t.text, fontWeight: "600" }}>{ex.title}</Text>
          <Text style={{ color: t.quiet }}>{STATUS[ex.status]} · {ex.patients.length} Patienten{ex.observer ? ` · Beobachter-Code ${ex.observer}` : ""}</Text>
        </Card>
      ))}
      {list?.length === 0 && <Text style={{ color: t.quiet }}>Noch keine Übungen.</Text>}
    </ScrollView>
  );
}

function NewExercise({ t, session, onCreated, onCancel }: { t: Theme; session: Session; onCreated: (code: string) => void; onCancel: () => void }) {
  const { lib } = useLibrary(session);
  const [scenario, setScenario] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [algorithm, setAlgorithm] = useState("mstart");
  const [level, setLevel] = useState<Level>("fortgeschritten");
  const [einheiten, setEinheiten] = useState(1); // B3: Einsatzeinheiten statt einzelner Trupps
  // H1/H2: Vorgaben der Stufe einzeln überschreiben (null = wie die Stufe)
  const [vitals, setVitals] = useState<"numbers" | "live" | "text">("numbers");
  const [phaseMinutes, setPhaseMinutes] = useState<number | null>(null);
  const [random, setRandom] = useState<boolean | null>(null);
  const [late, setLate] = useState<Record<string, number>>({}); // A8: Patient taucht erst ab dieser Minute auf
  const [error, setError] = useState<string | null>(null);
  const [find, setFind] = useState(""); // über 100 Szenarien: suchen statt scrollen
  const sc = lib?.scenarios.find((s) => s.id === scenario) ?? lib?.scenarios[0];
  const shownScenarios = lib?.scenarios.filter((s) => s.id === sc?.id || `${s.title} ${s.situation ?? ""}`.toLowerCase().includes(find.trim().toLowerCase())) ?? [];
  const byId = new Map(lib?.patients.map((p) => [p.id, p]));
  const playable = (id: string) => !!byId.get(id) && !byId.get(id)!.errors.length;
  useEffect(() => setPicked(sc?.patients.filter(playable) ?? []), [sc?.id, lib]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 20 }}>
      <Title t={t}>Neue Übung</Title>
      <Field t={t} label={`Szenario suchen (${lib?.scenarios.length ?? 0})`} value={find} onChange={setFind} />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {shownScenarios.map((s) => <Chip key={s.id} t={t} label={s.title} selected={sc?.id === s.id} onPress={() => setScenario(s.id)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Patienten</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {sc?.patients.map((id) => {
          const p = byId.get(id);
          return <Chip key={id} t={t} label={`${id.toUpperCase()} ${p?.title ?? ""}`} selected={picked.includes(id)} disabled={!playable(id)} onPress={() => toggle(id)} />;
        })}
      </View>
      {lib && !sc?.patients.some(playable) && <Text style={{ color: t.quiet }}>Dieses Szenario hat noch keine spielbaren Fälle.</Text>}
      {picked.length > 1 && (
        <>
          <Text style={{ color: t.quiet }}>Später entdeckt (Lageänderung): Tippen schaltet um. Den Zettel erst zu dieser Minute auslegen.</Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {picked.map((id) => (
              <Chip key={id} t={t} label={`${id.toUpperCase()} ${late[id] ? `ab Minute ${late[id]}` : "sofort"}`} selected={!!late[id]}
                onPress={() => setLate((l) => { const next = LATE_STEPS[(LATE_STEPS.indexOf(l[id] ?? 0) + 1) % LATE_STEPS.length]; const { [id]: _, ...rest } = l; return next ? { ...rest, [id]: next } : rest; })} />
            ))}
          </View>
        </>
      )}
      <Text style={{ color: t.quiet }}>Sichtungsalgorithmus</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {ALGOS.map(([id, label]) => <Chip key={id} t={t} label={label} selected={algorithm === id} onPress={() => setAlgorithm(id)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Stufe</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {LEVELS.map(([id, label]) => <Chip key={id} t={t} label={label} selected={level === id} onPress={() => setLevel(id)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Vitalwerte auf den Handys</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Chip t={t} label="Zahlen" selected={vitals === "numbers"} onPress={() => setVitals("numbers")} />
        <Chip t={t} label="Zahlen gleitend wie am Monitor" selected={vitals === "live"} onPress={() => setVitals("live")} />
        <Chip t={t} label="Befundtext wie Papier-dPS" selected={vitals === "text"} onPress={() => setVitals("text")} />
      </View>
      <Text style={{ color: t.quiet }}>Phasendauer</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Chip t={t} label={`wie Stufe (${LEVEL_MINUTES[level]} min)`} selected={phaseMinutes === null} onPress={() => setPhaseMinutes(null)} />
        {[10, 12, 15, 20, 25].map((m) => <Chip key={m} t={t} label={`${m} min`} selected={phaseMinutes === m} onPress={() => setPhaseMinutes(m)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Zufall (Maßnahmen können misslingen, Phasen dauern je Patient 80–120 %)</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Chip t={t} label={`wie Stufe (${level === "experte" ? "an" : "aus"})`} selected={random === null} onPress={() => setRandom(null)} />
        <Chip t={t} label="an" selected={random === true} onPress={() => setRandom(true)} />
        <Chip t={t} label="aus" selected={random === false} onPress={() => setRandom(false)} />
      </View>
      <Text style={{ color: t.quiet }}>Einsatzeinheiten (je EE: Sicherungstrupp für Aufnahme und Abgabe, Arzt für die Sichtung, Zelt- und Techniktrupp für die Versorgung; jeder Trupp bekommt einen eigenen Beitrittscode)</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={{ color: t.text, flex: 1 }}>{einheiten === 0 ? "ohne EE: jeder Helfer darf alles" : `${einheiten} ${einheiten === 1 ? "Einsatzeinheit" : "Einsatzeinheiten"} · ${einheiten * 4} Trupps`}</Text>
        <View style={{ width: 56 }}><Button t={t} label="−" disabled={einheiten === 0} onPress={() => setEinheiten(einheiten - 1)} /></View>
        <Text style={{ color: t.text, fontWeight: "600", width: 24, textAlign: "center" }}>{einheiten}</Text>
        <View style={{ width: 56 }}><Button t={t} label="+" disabled={einheiten === 6} onPress={() => setEinheiten(einheiten + 1)} /></View>
      </View>
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label="Übung anlegen" disabled={!sc || picked.length === 0}
        onPress={() => api<{ code: string }>(session, "/api/exercises", { scenario: sc!.id, patients: picked, algorithm, level, einheiten, vitals, late, ...(phaseMinutes ? { phaseMinutes } : {}), ...(random !== null ? { random } : {}) }).then(({ code }) => onCreated(code), (e: Error) => setError(e.message))} />
      <Button t={t} label="Abbrechen" onPress={onCancel} />
    </ScrollView>
  );
}

// Live-Lage per WebSocket ("watch"), verbindet bei Abbruch neu.
function useWatch(session: Session, code: string) {
  const [s, set] = useState<{ view: LeitungView | null; clock: Clock | null; offset: number; error: string | null }>({ view: null, clock: null, offset: 0, error: null });
  useEffect(() => {
    let ws: WebSocket;
    let stop = false;
    let retry: ReturnType<typeof setTimeout>;
    const open = () => {
      ws = new WebSocket(session.server.trim());
      ws.onopen = () => ws.send(JSON.stringify({ type: "watch", exercise: code, token: session.token }));
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as ServerMsg;
        if (m.type === "leitung") set((x) => ({ ...x, view: m.view, error: null }));
        else if (m.type === "clock") set((x) => ({ ...x, clock: m, offset: m.serverNow - Date.now() }));
        else if (m.type === "error") set((x) => ({ ...x, error: m.error }));
      };
      ws.onclose = () => void (!stop && (retry = setTimeout(open, 2000)));
    };
    open();
    return () => ((stop = true), clearTimeout(retry), ws.close());
  }, [session.server, session.token, code]);
  return s;
}

function ExerciseScreen({ t, session, code, onBack }: { t: Theme; session: Session; code: string; onBack: () => void }) {
  const w = useWatch(session, code);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const v = w.view;
  const st = w.clock?.status ?? v?.status ?? "ready";
  const [counting, setCounting] = useState(false);
  const [show, setShow] = useState<Evaluation | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [steer, setSteer] = useState<string | null>(null); // E5: Patient, dessen Phase die Leitung setzt
  const [message, setMessage] = useState("");
  const inject = (body: { type: "set"; patient: string; to: string } | { type: "arrive"; unit: string } | { type: "message"; text: string } | { type: "mood"; patient: string; temperament: string }) =>
    api(session, `/api/exercises/${code}/inject`, body).then(() => setError(null), (e: Error) => setError(e.message));
  const ctl = (type: "start" | "pause" | "resume" | "end") => api(session, `/api/exercises/${code}/control`, { type }).catch((e: Error) => setError(e.message));
  // J2: Vor dem Start die Lobby (auch für den Beamer), Start mit Countdown 3-2-1.
  if (show) return <Show t={t} ev={show} onClose={() => setShow(null)} />;
  if (replaying) return <ReplaySheet t={t} session={session} code={code} onClose={() => setReplaying(false)} />;
  const steering = steer ? v?.patients.find((p) => p.id === steer) : null;
  if (steering)
    return (
      <Sheet t={t} title={`${steering.id.toUpperCase()} steuern`} onClose={() => setSteer(null)}>
        <Text style={{ color: t.quiet }}>{steering.title} · jetzt Phase {steering.phase}. Eine neue Phase gilt sofort und läuft von dort im eigenen Takt weiter.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {steering.phases.map((ph) => <Chip key={ph} t={t} label={ph} selected={ph === steering.phase} onPress={() => (inject({ type: "set", patient: steering.id, to: ph }), setSteer(null))} />)}
        </View>
        {/* G11: Temperament live ändern, Gespräche mitlesen */}
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "900", marginTop: 8 }}>Temperament</Text>
        <Text style={{ color: t.quiet }}>Jetzt: {steering.mood}. Wirkt sofort auf die nächsten Antworten.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {MOODS.map((m) => <Chip key={m} t={t} label={m} selected={steering.mood === m} onPress={() => inject({ type: "mood", patient: steering.id, temperament: m })} />)}
          <Chip t={t} label="wie im Fall" selected={false} onPress={() => inject({ type: "mood", patient: steering.id, temperament: "" })} />
        </View>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: "900", marginTop: 8 }}>Gespräche ({steering.dialog.length})</Text>
        {steering.dialog.length === 0 && <Text style={{ color: t.quiet }}>Noch niemand hat mit dem Patienten gesprochen.</Text>}
        {steering.dialog.map((d, i) => (
          <View key={i} style={{ backgroundColor: t.card, borderRadius: 12, padding: 10, gap: 4 }}>
            <Text style={{ color: t.quiet, fontSize: 12 }}>{clock(d.t * 60000)} · {d.who}</Text>
            <Text style={{ color: t.text, fontWeight: "700" }}>„{d.q}“</Text>
            <Text style={{ color: t.text }}>→ {d.a}</Text>
          </View>
        ))}
      </Sheet>
    );
  const live = st === "running" || st === "paused";
  if (counting) return <Countdown t={t} onDone={() => (setCounting(false), ctl("start"))} />;
  if (st === "ready")
    return <Lobby t={t} session={session} code={code} view={v} error={w.error ?? error} onStart={() => setCounting(true)} onBack={onBack} onEnd={() => ctl("end")} />;
  // Schrift passend zur Kachel: Gelb und helles EX (dunkles Design) brauchen dunkle Schrift.
  const ink = (k: Sk | "offen") => (k === "offen" ? t.text : k === "II" ? "#111111" : k === "EX" ? t.bg : "#FFFFFF");
  const skCell = (k: Sk | "offen") => (
    <View key={k} style={{ flex: 1, borderRadius: 14, backgroundColor: t.edge, paddingBottom: 4 }}>
      <View style={{ borderRadius: 14, padding: 8, alignItems: "center", backgroundColor: k === "offen" ? t.card : skColor(t, k) }}>
        <Text style={{ color: ink(k), fontWeight: "900", fontSize: 24 }}>{v?.counts[k] ?? 0}</Text>
        <Text style={{ color: ink(k), fontWeight: "800" }}>{k}</Text>
      </View>
    </View>
  );
  const heading = (label: string) => <Text style={{ color: t.text, fontSize: 20, fontWeight: "900", marginTop: 8 }}>{label}</Text>;
  return (
    <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 20 }}>
      {/* Kopfleiste in Bühnenfarbe wie auf der Startseite */}
      <View style={{ backgroundColor: STAGE, marginTop: -48, paddingTop: 56, paddingBottom: 16, paddingHorizontal: 20, gap: 6, borderBottomLeftRadius: 22, borderBottomRightRadius: 22 }}>
        <Text style={{ color: "#FFFFFF", fontWeight: "700" }} accessibilityRole="button" onPress={onBack}>‹ Übungen</Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 30, fontWeight: "900" }} accessibilityRole="header">Lage {code}</Text>
          <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ color: STAGE, fontWeight: "900" }}>{clock(exerciseMinutes(w.clock, w.offset, now) * 60000)} · {STATUS[st]}{(w.clock?.speed ?? 1) !== 1 ? ` · ${w.clock!.speed}×` : ""}</Text>
          </View>
        </View>
        <Text style={{ color: "#FFFFFF", opacity: 0.85 }}>{v?.title ?? "verbinde …"}{v?.observer ? ` · Beobachter-Code ${v.observer}` : ""}</Text>
      </View>
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
      {(w.error || error) && <Text style={{ color: t.red }}>{w.error ?? error}</Text>}
      {st === "ended" && <EvaluationPanel t={t} session={session} code={code} onShow={setShow} onReplay={() => setReplaying(true)} />}
      <View style={{ flexDirection: "row", gap: 6 }}>{(["I", "II", "III", "EX", "offen"] as const).map(skCell)}</View>
      {live && (
        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}><Field t={t} label="Nachricht an alle Helfer (z. B. Lageänderung)" value={message} onChange={setMessage} /></View>
          <View style={{ width: 120 }}><Button t={t} strong label="Senden" disabled={!message.trim()} onPress={() => (inject({ type: "message", text: message.trim() }), setMessage(""))} /></View>
        </View>
      )}
      {/* Nachforderungen der Führung: Fahrzeug ist erst da, wenn die Leitung es bestätigt */}
      {v?.requests.map((r) => (
        <Card key={r.unit} t={t} color={t.line}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontWeight: "900" }}>{r.title}</Text>
              <Text style={{ color: t.quiet }}>nachgefordert {clock(r.at * 60000)} von {r.by}{r.arrived ? " · vor Ort" : ""}</Text>
            </View>
            {live && !r.arrived && <View style={{ width: 120 }}><Button t={t} strong label="Ist da" onPress={() => inject({ type: "arrive", unit: r.unit })} /></View>}
          </View>
        </Card>
      ))}
      {v?.patients.map((p) => (
        <Card key={p.id} t={t} color={p.triage ? skColor(t, p.triage) : t.line} onPress={live ? () => setSteer(p.id) : undefined}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: t.text, fontWeight: "900", flexShrink: 1 }}>{p.id.toUpperCase()} · {p.title}</Text>
            <Text style={{ color: t.quiet, fontSize: 12 }}>{p.phase}</Text>
          </View>
          {p.alert ? <Text style={{ color: t.red, fontWeight: "700" }}>{p.alert}</Text> : null}
          <Text style={{ color: t.quiet }}>
            Soll {p.target} {TREND[p.trend]} · Ist {p.triage ?? "–"} · {p.place} · {p.helpers.join(", ") || "kein Helfer"}
            {p.lastContact !== null && !p.helpers.length ? ` · letzter Kontakt vor ${Math.floor(exerciseMinutes(w.clock, w.offset, now) - p.lastContact)} min` : ""}
            {p.lastContact === null ? " · noch kein Kontakt" : ""}
          </Text>
        </Card>
      ))}
      {heading(`Helfer (${v?.helpers.length ?? 0})`)}
      {v?.helpers.map((h) => {
        const idle = h.idle !== null && h.idle >= IDLE_MIN;
        return (
          <Card key={h.id} t={t} color={idle ? t.text : h.patient ? t.accent : t.line}>
            <Text style={{ color: t.text, fontWeight: "800" }}>{h.name} <Text style={{ color: t.quiet, fontWeight: "400" }}>({h.trupp ?? h.unit})</Text></Text>
            <Text style={{ color: idle ? t.text : t.quiet }}>
              {h.patient?.toUpperCase() ?? "ohne Patient"}{h.busy ? ` · ${h.busy}` : ""}{idle ? ` · seit ${Math.floor(h.idle!)} min ohne Maßnahme` : ""}
            </Text>
          </Card>
        );
      })}
      {(v?.trupps.length ?? 0) > 0 && heading("Trupps")}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {v?.trupps.map((tr) => (
          <View key={tr.code} style={{ flexGrow: 1, minWidth: 160, borderRadius: 14, padding: 12, backgroundColor: t.accent, gap: 2 }}>
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{tr.name} · {tr.code}</Text>
            <Text style={{ color: "#FFFFFF", opacity: 0.9 }}>{tr.unit} · {tr.members.join(", ") || "noch niemand"}</Text>
          </View>
        ))}
      </View>
      {heading("Ereignisse")}
      <View style={{ backgroundColor: t.card, borderRadius: 14, padding: 12, gap: 4 }}>
        {v?.events.slice(0, 15).map((e, i) => (
          <Text key={i} style={{ color: t.quiet }}><Text style={{ color: t.text, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{clock(e.t * 60000)}</Text>  {e.text}</Text>
        ))}
        {!v?.events.length && <Text style={{ color: t.quiet }}>noch nichts passiert</Text>}
      </View>
      <View style={{ gap: 10, marginTop: 8 }}>
        {live && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ color: t.quiet, fontWeight: "700" }}>Tempo</Text>
            {([1, 2, 4] as const).map((f) => (
              <Chip key={f} t={t} label={`${f}×`} selected={(w.clock?.speed ?? 1) === f}
                onPress={() => api(session, `/api/exercises/${code}/control`, { type: "speed", factor: f }).catch((e: Error) => setError(e.message))} />
            ))}
          </View>
        )}
        {st === "running" && <Button t={t} strong label="Pausieren" onPress={() => ctl("pause")} />}
        {st === "paused" && <Button t={t} strong label="Fortsetzen" onPress={() => ctl("resume")} />}
        <Button t={t} label="QR-Zettel drucken" onPress={() => Linking.openURL(`${httpBase(session.server)}/print/${code}`)} />
        {st !== "ended" && <Button t={t} label="Übung beenden" onPress={() => ctl("end")} />}
      </View>
      </View>
    </ScrollView>
  );
}

const WHITE = "#FFFFFF";

// J2: Lobby wie bei Kahoot – bewegter Hintergrund, großer Code und QR-Code, Beitritte als bunte Kacheln.
function Lobby({ t, session, code, view, error, onStart, onBack, onEnd }: {
  t: Theme; session: Session; code: string; view: LeitungView | null; error: string | null; onStart: () => void; onBack: () => void; onEnd: () => void;
}) {
  const helpers = view?.helpers ?? [];
  const groups = [
    ...(view?.trupps ?? []).map((tr) => ({ key: tr.code, title: tr.name, code: tr.code, names: tr.members })),
    { key: "ohne", title: view?.trupps.length ? "Ohne Trupp" : "Beigetreten", code: null, names: helpers.filter((h) => !h.trupp).map((h) => h.name) },
  ].filter((g) => g.code || g.names.length);
  let n = 0; // fortlaufende Farbe über alle Kacheln
  return (
    <Stage color={STAGE}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 18, alignItems: "center" }}>
        <Text style={{ color: WHITE, fontWeight: "700", alignSelf: "flex-start" }} accessibilityRole="button" onPress={onBack}>‹ Übungen</Text>
        <FlyIn><Logo t={t} size={44} /></FlyIn>
        <Text style={{ color: WHITE, fontSize: 18, fontWeight: "700", textAlign: "center" }}>{view?.title ?? "verbinde …"}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18, alignItems: "center", justifyContent: "center" }}>
          <Breathe>
            <View style={{ backgroundColor: WHITE, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 12, alignItems: "center" }}>
              <Text style={{ color: "#333", fontWeight: "700" }}>Übungscode</Text>
              <Text accessibilityRole="header" accessibilityLabel={`Übungscode ${code.split("").join(" ")}`} style={{ color: "#111", fontSize: 64, fontWeight: "900", letterSpacing: 6 }}>{code}</Text>
            </View>
          </Breathe>
          <View style={{ backgroundColor: WHITE, borderRadius: 18, padding: 10 }}>
            <Image source={{ uri: `${httpBase(session.server)}/qr/${code}.png` }} style={{ width: 180, height: 180 }} accessibilityRole="image" accessibilityLabel="QR-Code zum Beitreten" />
          </View>
        </View>
        <Text style={{ color: WHITE, opacity: 0.9 }}>dPS-App öffnen → Code eingeben oder QR-Code scannen</Text>
        {error && <Text style={{ color: WHITE, fontWeight: "700" }}>{error}</Text>}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Wiggle trigger={helpers.length}>
            <View style={{ backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 40, minWidth: 64, height: 64, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}>
              <Text style={{ color: WHITE, fontSize: 32, fontWeight: "900" }}>{helpers.length}</Text>
            </View>
          </Wiggle>
          <Text style={{ color: WHITE, fontSize: 22, fontWeight: "800" }}>{helpers.length === 0 ? "Warte auf Helfer" : "Helfer dabei"}</Text>
          {helpers.length === 0 && <Dots />}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", alignSelf: "stretch" }}>
          {groups.map((g) => (
            <View key={g.key} style={{ minWidth: 240, flexGrow: 1, maxWidth: 460, backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 18, padding: 14, gap: 10 }}>
              <Text style={{ color: WHITE, fontWeight: "900", fontSize: 16 }}>{g.title}{g.code ? `  ·  ${g.code}` : ""}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {g.names.map((name, i) => {
                  const k = n++;
                  return <FlyIn key={`${name}-${i}`} spin={k % 2 ? 25 : -25} from={60}><Tile i={k} label={name} /></FlyIn>;
                })}
                {g.names.length === 0 && <Text style={{ color: WHITE, opacity: 0.7 }}>noch niemand</Text>}
              </View>
            </View>
          ))}
        </View>
        <View style={{ alignSelf: "stretch", gap: 14, maxWidth: 480, width: "100%", marginTop: 6 }}>
          <FunButton big label="Übung starten" text={FUN.purple} onPress={onStart} />
          <Text style={{ color: WHITE, textAlign: "center", textDecorationLine: "underline", fontWeight: "700" }} accessibilityRole="link"
            onPress={() => Linking.openURL(`${httpBase(session.server)}/print/${code}`)}>QR-Zettel drucken</Text>
          <Text style={{ color: WHITE, textAlign: "center", opacity: 0.75 }} accessibilityRole="button" onPress={onEnd}>Übung abbrechen</Text>
        </View>
      </ScrollView>
    </Stage>
  );
}

// Countdown 3-2-1-Los: jede Zahl in eigener Farbe, zoomt mit Drehung herein, ein Ring platzt nach außen.
function Countdown({ onDone }: { t: Theme; onDone: () => void }) {
  const [n, setN] = useState(3);
  useEffect(() => {
    const i = setTimeout(() => (n > 0 ? setN(n - 1) : onDone()), n > 0 ? 1000 : 700);
    return () => clearTimeout(i);
  }, [n]);
  const color = [FUN.green, FUN.gold, FUN.blue, FUN.red][n];
  return (
    <Stage color={color}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }} accessibilityLiveRegion="assertive">
        <Burst key={`b${n}`} />
        <Zoom key={n}><Text style={{ color: WHITE, fontSize: n ? 200 : 120, fontWeight: "900" }}>{n || "Los!"}</Text></Zoom>
      </View>
    </Stage>
  );
}

// Zahl kommt groß und gedreht herein und rastet ein.
function Zoom({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  useEffect(() => void (!reduced && Animated.spring(v, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }).start()), []);
  return (
    <Animated.View style={{ transform: [
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [3, 1] }) },
      { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["-30deg", "0deg"] }) },
    ], opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }) }}>{children}</Animated.View>
  );
}

// Ring, der sich ausdehnt und verblasst.
function Burst() {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => void (!reduced && Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()), []);
  if (reduced) return null;
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", width: 260, height: 260, borderRadius: 130, borderWidth: 14, borderColor: WHITE,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.4] }) }] }} />
  );
}

// J4: Auswertung als Show für den Beamer: Zahl zählt hoch, Sterne fliegen ein, Podium wächst, Konfetti.
// Einzelne Helfer bleiben privat.
function Show({ ev, onClose }: { t: Theme; ev: Evaluation; onClose: () => void }) {
  const survived = useCountUp(ev.team.survived, 1400, 600);
  const podium = [...ev.trupps].sort((a, b) => b.points - a.points).slice(0, 3);
  const starAt = (i: number) => 2200 + i * 650;
  const podiumAt = (place: number) => starAt(3) + 400 + (3 - place) * 1000; // Platz 3 zuerst
  const order = [1, 0, 2].filter((i) => podium[i]); // Mitte = Platz 1
  const end = podium.length ? podiumAt(1) + 600 : starAt(3);
  return (
    <Stage color={STAGE}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 22, alignItems: "center" }}>
        <FlyIn from={-80}><Text style={{ color: WHITE, fontSize: 36, fontWeight: "900" }}>Auswertung</Text></FlyIn>
        <FlyIn delay={300}>
          <View style={{ backgroundColor: WHITE, borderRadius: 18, paddingHorizontal: 24, paddingVertical: 12, alignItems: "center" }}>
            <Text style={{ color: FUN.purple, fontSize: 56, fontWeight: "900" }}>{survived} / {ev.team.eligible}</Text>
            <Text style={{ color: "#333", fontWeight: "700" }}>Patienten überlebt</Text>
          </View>
        </FlyIn>
        <View style={{ flexDirection: "row", gap: 14 }} accessibilityLabel={`${ev.team.stars} von 3 Sternen`}>
          {[0, 1, 2].map((i) => (
            <FlyIn key={i} delay={starAt(i)} from={-200} spin={i % 2 ? 180 : -180}>
              <Text style={{ fontSize: 84, color: i < ev.team.stars ? "#FFD54F" : "rgba(255,255,255,0.25)" }}>★</Text>
            </FlyIn>
          ))}
        </View>
        {podium.length > 0 && (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 14 }}>
            {order.map((i) => (
              <View key={podium[i].code} style={{ alignItems: "center", width: 150, gap: 8 }}>
                <FlyIn delay={podiumAt(i + 1) + 500} from={-40}>
                  {i === 0 ? <Breathe amount={0.08} ms={900}><Text style={{ fontSize: 34 }}>👑</Text></Breathe> : <Text style={{ fontSize: 34, opacity: 0 }}>·</Text>}
                  <Text style={{ color: WHITE, fontWeight: "900", textAlign: "center", fontSize: 16 }}>{podium[i].name}</Text>
                  <Text style={{ color: WHITE, textAlign: "center" }}>{podium[i].points} Punkte</Text>
                </FlyIn>
                <Rise height={[180, 130, 90][i]} delay={podiumAt(i + 1)} color={TILE[[2, 1, 0][i]]}>
                  <Text style={{ color: WHITE, fontSize: 44, fontWeight: "900" }}>{i + 1}</Text>
                </Rise>
              </View>
            ))}
          </View>
        )}
        <FlyIn delay={end + 400}>
          <Text style={{ color: WHITE, textAlign: "center", fontWeight: "700" }}>
            Kritische Maßnahmen: {ev.critical.timely} rechtzeitig · Erste Sichtung: {ev.triage.correct} korrekt, {ev.triage.under} Untertriage
          </Text>
        </FlyIn>
        <FlyIn delay={end + 800}><FunButton label="Schließen" text={FUN.purple} onPress={onClose} /></FlyIn>
      </ScrollView>
      {ev.team.stars >= 1 && <Confetti delay={end} count={90} />}
    </Stage>
  );
}

const OUTCOME_RED = new Set(["verstorben"]);
const TREND = { besser: "↗ besser", schlechter: "↘ schlechter", gleich: "→" } as const;
const IDLE_MIN = 3; // ab dann fällt Leerlauf in der Helferliste auf

function EvaluationPanel({ t, session, code, onShow, onReplay }: { t: Theme; session: Session; code: string; onShow: (ev: Evaluation) => void; onReplay: () => void }) {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api<Evaluation>(session, `/api/exercises/${code}/evaluation`).then(setEv, (e: Error) => setError(e.message));
  useEffect(load, [code]);
  if (!ev) return error ? <Text style={{ color: t.red }}>{error}</Text> : null;
  const m = (x: number | null) => (x === null ? "–" : clock(x * 60000));
  return (
    <View style={{ gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 14 }}>
      <FunButton label="Auswertung zeigen (Beamer)" color={FUN.purple} text="#FFFFFF" onPress={() => onShow(ev)} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button t={t} label="Replay" onPress={onReplay} /></View>
        <View style={{ flex: 1 }}><Button t={t} label="Protokoll (CSV)" onPress={() => exportCsv(session, code).catch((e: Error) => setError(e.message))} /></View>
      </View>
      <Button t={t} label="Bericht als PDF" disabled={Platform.OS !== "web"} note={Platform.OS === "web" ? "öffnet die Druckansicht: „Als PDF speichern“" : "in der Web-Ansicht am Laptop"}
        onPress={() => openReport(session, code).catch((e: Error) => setError(e.message))} />
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 20 }}>Auswertung</Text>
        <Stars t={t} stars={ev.team.stars} />
      </View>
      <Text style={{ color: t.text }}>{ev.team.survived} von {ev.team.eligible} Patienten überlebt</Text>
      <Text style={{ color: t.quiet }}>Kritische Maßnahmen: {ev.critical.timely} rechtzeitig · {ev.critical.late} zu spät · {ev.critical.missed} verpasst</Text>
      <Text style={{ color: t.quiet }}>Erste Sichtung: {ev.triage.correct} korrekt · {ev.triage.over} Übertriage · {ev.triage.under} Untertriage</Text>
      {Role.options.filter((r) => Object.values(ev.triageByRole[r] ?? {}).some((x) => x > 0)).map((r) => (
        <Text key={r} style={{ color: t.quiet }}>Sichtungen durch {ROLE_LABEL[r]}: {ev.triageByRole[r].correct} korrekt · {ev.triageByRole[r].over} über · {ev.triageByRole[r].under} unter</Text>
      ))}
      <Text style={{ color: t.text, fontWeight: "600", marginTop: 6 }}>Patienten</Text>
      {ev.patients.map((p) => (
        <View key={p.id}>
          <Text style={{ color: OUTCOME_RED.has(p.outcome) ? t.red : t.text, fontWeight: "600" }}>{p.id.toUpperCase()} · {p.outcome}</Text>
          <Text style={{ color: t.quiet }}>Erstkontakt {m(p.firstContact)} · Sichtung {m(p.firstTriage)}{p.triage ? ` (${p.triage})` : ""}</Text>
          {p.missed.length > 0 && <Text style={{ color: t.red }}>verpasst: {p.missed.join(", ")}</Text>}
          {p.handover && (
            <Text style={{ color: p.handover.missing.length ? t.red : t.quiet }}>
              Übergabe {m(p.handover.t)} an {p.handover.vehicle} → {p.handover.destination}{p.handover.missing.length ? ` · fehlte: ${p.handover.missing.join(", ")}` : " · vollständig"}
            </Text>
          )}
        </View>
      ))}
      {ev.trupps.length > 0 && <Text style={{ color: t.text, fontWeight: "600", marginTop: 6 }}>Trupps</Text>}
      {ev.trupps.map((tr) => (
        <Text key={tr.code} style={{ color: t.text }}>{tr.name} · {tr.points} Punkte · {tr.members.join(", ") || "ohne Mitglieder"}</Text>
      ))}
      <Text style={{ color: t.text, fontWeight: "600", marginTop: 6 }}>Helfer</Text>
      {ev.helpers.map((h) => (
        <View key={h.id} style={{ gap: 4 }}>
          <Text style={{ color: t.text, fontWeight: "600" }}>{h.name} ({h.unit}) · {h.points} Punkte · {Math.round(h.busyShare * 100)} % in Maßnahmen</Text>
          {h.badges.length > 0 && <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>{h.badges.map((b) => <Badge key={b} t={t} label={b} />)}</View>}
          {h.improve.map((x, i) => <Text key={i} style={{ color: t.quiet }}>• {x}</Text>)}
          {h.notes?.map((x, i) => <Text key={`n${i}`} style={{ color: t.text }}>◦ {x}</Text>)}
          <FeedbackBox t={t} session={session} code={code} helper={h.id} saved={h.feedback ?? null} onSaved={load} />
        </View>
      ))}
      {ev.released ? (
        <Text style={{ color: t.quiet }}>Berichte sind für die Helfer freigegeben.</Text>
      ) : (
        <Button t={t} strong label="Berichte für Helfer freigeben"
          onPress={() => api(session, `/api/exercises/${code}/control`, { type: "release" }).then(load, (e: Error) => setError(e.message))} />
      )}
    </View>
  );
}

// G10: Rückmeldung je Helfer. Die KI schlägt einen Text vor, die Leitung ändert und speichert ihn; er erscheint im Bericht.
function FeedbackBox({ t, session, code, helper, saved, onSaved }: { t: Theme; session: Session; code: string; helper: string; saved: string | null; onSaved: () => void }) {
  const [text, setText] = useState(saved ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const call = (body: { text?: string }) => api<{ text?: string }>(session, `/api/exercises/${code}/feedback`, { helper, ...body });
  const suggest = () => (setBusy(true), call({}).then((r) => (setText(r.text ?? ""), setError(null)), (e: Error) => setError(e.message)).finally(() => setBusy(false)));
  const save = () => call({ text: text.trim() }).then(() => (setError(null), onSaved()), (e: Error) => setError(e.message));
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <TextInput value={text} onChangeText={setText} multiline maxLength={1200} placeholder="Rückmeldung an diese Person (erscheint im Bericht)" placeholderTextColor={t.quiet}
        accessibilityLabel="Rückmeldung" style={{ minHeight: 70, borderWidth: 2, borderColor: t.edge, backgroundColor: t.card, borderRadius: 12, padding: 10, color: t.text, textAlignVertical: "top" }} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button t={t} label={busy ? "KI schreibt …" : "KI-Vorschlag"} disabled={busy} onPress={suggest} /></View>
        <View style={{ flex: 1 }}><Button t={t} strong label={text.trim() === (saved ?? "") ? "Gespeichert" : "Speichern"} disabled={text.trim() === (saved ?? "")} onPress={save} /></View>
      </View>
      {error && <Text style={{ color: t.red }}>{error}</Text>}
    </View>
  );
}

// F7: Durchgänge vergleichen. Je Szenario die beendeten Übungen in zeitlicher Folge; Pfeile gegenüber dem vorigen Durchgang.
type Summary = {
  code: string; title: string; created: number; minutes: number; helpers: number; patients: number; stars: number; survived: number; eligible: number;
  criticalTimely: number | null; triageCorrect: number | null; firstTriage: number | null;
};
function Compare({ t, session, onClose }: { t: Theme; session: Session; onClose: () => void }) {
  const [runs, setRuns] = useState<Summary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api<Summary[]>(session, "/api/exercises/compare").then(setRuns, (e: Error) => setError(e.message)), []);
  const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);
  // höher besser (Anteile) bzw. niedriger besser (Minuten bis zur Sichtung)
  const trend = (now: number | null, before: number | null, lowerIsBetter = false) =>
    now === null || before === null || Math.abs(now - before) < 0.005 ? "" : (now > before) !== lowerIsBetter ? " ▲" : " ▼";
  const groups = [...new Set(runs?.map((r) => r.title))].map((title) => runs!.filter((r) => r.title === title));
  return (
    <Sheet t={t} title="Durchgänge vergleichen" onClose={onClose}>
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      {!runs && !error && <Text style={{ color: t.quiet }}>lade …</Text>}
      <Text style={{ color: t.quiet }}>▲ besser, ▼ schlechter als der vorige Durchgang desselben Szenarios.</Text>
      {groups.map((g) => (
        <View key={g[0].title} style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontSize: 18, fontWeight: "900", marginTop: 8 }}>{g[0].title}</Text>
          {g.map((r, i) => {
            const prev = g[i - 1];
            return (
              <Card key={r.code} t={t} color={r.stars >= 2 ? t.green : r.stars === 1 ? t.gold : t.line}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: t.text, fontWeight: "900" }}>{new Date(r.created).toLocaleDateString("de-DE")} · {r.code}</Text>
                  <Text style={{ color: t.gold }} accessibilityLabel={`${r.stars} von 3 Sternen`}>{"★".repeat(r.stars)}{"☆".repeat(3 - r.stars)}</Text>
                </View>
                <Text style={{ color: t.quiet }}>{r.helpers} Helfer · {r.patients} Patienten · {clock(r.minutes * 60000)} min</Text>
                <Text style={{ color: t.text }}>Überlebt {r.survived} von {r.eligible}{trend(r.eligible ? r.survived / r.eligible : null, prev?.eligible ? prev.survived / prev.eligible : null)}</Text>
                <Text style={{ color: t.text }}>Kritische Maßnahmen rechtzeitig {pct(r.criticalTimely)}{trend(r.criticalTimely, prev?.criticalTimely ?? null)}</Text>
                <Text style={{ color: t.text }}>Erstsichtung korrekt {pct(r.triageCorrect)}{trend(r.triageCorrect, prev?.triageCorrect ?? null)}</Text>
                <Text style={{ color: t.text }}>Ø bis zur Erstsichtung {r.firstTriage === null ? "–" : `${clock(r.firstTriage * 60000)} min`}{trend(r.firstTriage, prev?.firstTriage ?? null, true)}</Text>
              </Card>
            );
          })}
        </View>
      ))}
    </Sheet>
  );
}
