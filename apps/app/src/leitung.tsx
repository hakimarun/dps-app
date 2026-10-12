// Praxisanleiter (Meilenstein 3): Anmeldung per E-Mail-Code, Bibliothek mit eigener Freigabe,
// Übung anlegen, QR-Zettel, Start/Pause/Ende und Live-Lage.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Sk } from "@dps/schema";
import type { Evaluation, Level, LeitungView, ServerMsg, Status } from "@dps/schema/protocol";
import { DEFAULT_SERVER, exerciseMinutes } from "./connection";
import { Badge, Button, Chip, Field, Logo, Stars, Title, clock, skColor, useCountUp, useReducedMotion, type Theme } from "./ui";
import { Breathe, Confetti, Dots, FUN, FlyIn, FunButton, Rise, STAGE, Stage, TILE, Tile, Wiggle } from "./fun";
import { api, httpBase, useLibrary, type Session } from "./api";
import { LibraryScreen } from "./library";

type ExerciseInfo = { code: string; title: string; status: Status; patients: string[] };
type Clock = Extract<ServerMsg, { type: "clock" }>;

const STATUS: Record<Status, string> = { ready: "bereit", running: "läuft", paused: "pausiert", ended: "beendet" };
const ROLES = [["sichtung", "Sichtungstrupps"], ["behandlung", "Behandlungstrupps"], ["transport", "Transporttrupps"]] as const;
const ROLE_SHORT: Record<string, string> = { sichtung: "Sichtung", behandlung: "Behandlung", transport: "Transport" };
const LEVELS: [Level, string][] = [["einsteiger", "Einsteiger"], ["fortgeschritten", "Fortgeschritten"], ["experte", "Experte"]];
const LEVEL_MINUTES: Record<Level, number> = { einsteiger: 20, fortgeschritten: 15, experte: 12 }; // wie LEVELS im Server
const ALGOS: [string, string][] = [["mstart", "mSTaRT"], ["prior", "PRIOR"], ["asav", "ASAV"]];
export function Leitung({ t, onExit }: { t: Theme; onExit: () => void }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem("dps:session").then((v) => setSession(v ? JSON.parse(v) : null));
  }, []);
  const save = (s: Session | null) => (setSession(s), s ? AsyncStorage.setItem("dps:session", JSON.stringify(s)) : AsyncStorage.removeItem("dps:session"));
  if (session === undefined) return null;
  return session ? <Home t={t} session={session} onLogout={() => save(null)} onExit={onExit} /> : <Login t={t} onLogin={save} onExit={onExit} />;
}

function Login({ t, onLogin, onExit }: { t: Theme; onLogin: (s: Session) => void; onExit: () => void }) {
  const [server, setServer] = useState(DEFAULT_SERVER);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<unknown>) => (setError(null), p.catch((e: Error) => setError(e.message)));
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <Title t={t}>Anmelden</Title>
      <Text style={{ color: t.quiet }}>Praxisanleiter und Ärzte melden sich mit einem Code per E-Mail an.</Text>
      <Field t={t} label="Server" value={server} onChange={setServer} />
      <Field t={t} label="E-Mail" value={email} onChange={setEmail} keyboard="email-address" />
      <Button t={t} strong={!sent} label={sent ? "Code erneut anfordern" : "Code anfordern"} disabled={!email.includes("@")}
        onPress={() => run(api({ server, token: "" }, "/api/login", { email: email.trim() }).then(() => setSent(true)))} />
      {sent && (
        <>
          <Field t={t} label="Code aus der E-Mail" value={code} onChange={setCode} keyboard="number-pad" />
          <Button t={t} strong label="Anmelden" disabled={!/^\d{6}$/.test(code)}
            onPress={() => run(api<{ token: string }>({ server, token: "" }, "/api/verify", { email: email.trim(), code }).then(({ token }) => onLogin({ server, token, email: email.trim() })))} />
        </>
      )}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} label="Rolle wechseln" onPress={onExit} />
    </ScrollView>
  );
}

function Home({ t, session, onLogout, onExit }: { t: Theme; session: Session; onLogout: () => void; onExit: () => void }) {
  const [tab, setTab] = useState<"uebungen" | "bibliothek">("uebungen");
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <ExerciseScreen t={t} session={session} code={open} onBack={() => setOpen(null)} />;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 8 }}>
        <Chip t={t} label="Übungen" selected={tab === "uebungen"} onPress={() => setTab("uebungen")} />
        <Chip t={t} label="Bibliothek" selected={tab === "bibliothek"} onPress={() => setTab("bibliothek")} />
      </View>
      <View style={{ flex: 1 }}>{tab === "bibliothek" ? <LibraryScreen t={t} session={session} /> : <Exercises t={t} session={session} onOpen={setOpen} />}</View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 20, borderTopWidth: 1, borderColor: t.line }}>
        <Text style={{ color: t.quiet, flexShrink: 1 }} numberOfLines={1}>{session.email}</Text>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Text style={{ color: t.text, fontWeight: "600" }} accessibilityRole="button" onPress={onExit}>Rolle wechseln</Text>
          <Text style={{ color: t.text, fontWeight: "600" }} accessibilityRole="button" onPress={onLogout}>Abmelden</Text>
        </View>
      </View>
    </View>
  );
}

function Exercises({ t, session, onOpen }: { t: Theme; session: Session; onOpen: (code: string) => void }) {
  const [list, setList] = useState<ExerciseInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => void api<ExerciseInfo[]>(session, "/api/exercises").then(setList), [session.token, creating]);
  if (creating) return <NewExercise t={t} session={session} onCreated={onOpen} onCancel={() => setCreating(false)} />;
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
      <Title t={t}>Übungen</Title>
      <Button t={t} strong label="Neue Übung" onPress={() => setCreating(true)} />
      {list?.map((ex) => (
        <Pressable key={ex.code} accessibilityRole="button" onPress={() => onOpen(ex.code)} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 4 }}>
          <Text style={{ color: t.text, fontWeight: "600", fontSize: 16 }}>{ex.code} · {ex.title}</Text>
          <Text style={{ color: t.quiet }}>{STATUS[ex.status]} · {ex.patients.length} Patienten</Text>
        </Pressable>
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
  const [trupps, setTrupps] = useState({ sichtung: 1, behandlung: 2, transport: 1 });
  // H1/H2: Vorgaben der Stufe einzeln überschreiben (null = wie die Stufe)
  const [vitals, setVitals] = useState<"numbers" | "text">("numbers");
  const [phaseMinutes, setPhaseMinutes] = useState<number | null>(null);
  const [random, setRandom] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sc = lib?.scenarios.find((s) => s.id === scenario) ?? lib?.scenarios[0];
  const byId = new Map(lib?.patients.map((p) => [p.id, p]));
  useEffect(() => setPicked(sc?.patients.filter((id) => byId.get(id)?.approved) ?? []), [sc?.id, lib]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 20 }}>
      <Title t={t}>Neue Übung</Title>
      <Text style={{ color: t.quiet }}>Szenario</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {lib?.scenarios.map((s) => <Chip key={s.id} t={t} label={s.title} selected={sc?.id === s.id} onPress={() => setScenario(s.id)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Patienten (nur von dir freigegebene)</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {sc?.patients.map((id) => {
          const p = byId.get(id);
          return <Chip key={id} t={t} label={`${id.toUpperCase()} ${p?.title ?? ""}`} selected={picked.includes(id)} disabled={!p?.approved} onPress={() => toggle(id)} />;
        })}
      </View>
      {lib && !sc?.patients.some((id) => byId.get(id)?.approved) && <Text style={{ color: t.quiet }}>Gib zuerst Fälle in der Bibliothek frei.</Text>}
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
        <Chip t={t} label="Befundtext wie Papier-dPS" selected={vitals === "text"} onPress={() => setVitals("text")} />
      </View>
      <Text style={{ color: t.quiet }}>Phasendauer</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Chip t={t} label={`wie Stufe (${LEVEL_MINUTES[level]} min)`} selected={phaseMinutes === null} onPress={() => setPhaseMinutes(null)} />
        {[10, 12, 15, 20, 25].map((m) => <Chip key={m} t={t} label={`${m} min`} selected={phaseMinutes === m} onPress={() => setPhaseMinutes(m)} />)}
      </View>
      <Text style={{ color: t.quiet }}>Zufall (z. B. misslungene Entlastungspunktion)</Text>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Chip t={t} label={`wie Stufe (${level === "experte" ? "an" : "aus"})`} selected={random === null} onPress={() => setRandom(null)} />
        <Chip t={t} label="an" selected={random === true} onPress={() => setRandom(true)} />
        <Chip t={t} label="aus" selected={random === false} onPress={() => setRandom(false)} />
      </View>
      <Text style={{ color: t.quiet }}>Trupps (jeder bekommt einen eigenen Beitrittscode)</Text>
      {ROLES.map(([role, label]) => (
        <View key={role} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
          <View style={{ width: 56 }}><Button t={t} label="−" disabled={trupps[role] === 0} onPress={() => setTrupps((x) => ({ ...x, [role]: x[role] - 1 }))} /></View>
          <Text style={{ color: t.text, fontWeight: "600", width: 24, textAlign: "center" }}>{trupps[role]}</Text>
          <View style={{ width: 56 }}><Button t={t} label="+" onPress={() => setTrupps((x) => ({ ...x, [role]: x[role] + 1 }))} /></View>
        </View>
      ))}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label="Übung anlegen" disabled={!sc || picked.length === 0}
        onPress={() => api<{ code: string }>(session, "/api/exercises", { scenario: sc!.id, patients: picked, algorithm, level, trupps, vitals, ...(phaseMinutes ? { phaseMinutes } : {}), ...(random !== null ? { random } : {}) }).then(({ code }) => onCreated(code), (e: Error) => setError(e.message))} />
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
  const ctl = (type: "start" | "pause" | "resume" | "end") => api(session, `/api/exercises/${code}/control`, { type }).catch((e: Error) => setError(e.message));
  // J2: Vor dem Start die Lobby (auch für den Beamer), Start mit Countdown 3-2-1.
  if (show) return <Show t={t} ev={show} onClose={() => setShow(null)} />;
  if (counting) return <Countdown t={t} onDone={() => (setCounting(false), ctl("start"))} />;
  if (st === "ready")
    return <Lobby t={t} session={session} code={code} view={v} error={w.error ?? error} onStart={() => setCounting(true)} onBack={onBack} onEnd={() => ctl("end")} />;
  const skCell = (k: Sk | "offen") => (
    <View key={k} style={{ flex: 1, borderWidth: 2, borderColor: k === "offen" ? t.line : skColor(t, k), borderRadius: 8, padding: 6, alignItems: "center" }}>
      <Text style={{ color: t.text, fontWeight: "600" }}>{k} {v?.counts[k] ?? 0}</Text>
    </View>
  );
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 20 }}>
      <Text style={{ color: t.text, fontWeight: "600" }} accessibilityRole="button" onPress={onBack}>‹ Übungen</Text>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Title t={t}>Lage {code}</Title>
        <Text style={{ color: t.quiet }}>{clock(exerciseMinutes(w.clock, w.offset, now) * 60000)} · {STATUS[st]}</Text>
      </View>
      <Text style={{ color: t.quiet }}>{v?.title ?? "verbinde …"}</Text>
      {(w.error || error) && <Text style={{ color: t.red }}>{w.error ?? error}</Text>}
      {st === "ended" && <EvaluationPanel t={t} session={session} code={code} onShow={setShow} />}
      <View style={{ flexDirection: "row", gap: 6 }}>{(["I", "II", "III", "EX", "offen"] as const).map(skCell)}</View>
      {v?.patients.map((p) => (
        <View key={p.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={{ width: 5, alignSelf: "stretch", borderRadius: 2, backgroundColor: p.triage ? skColor(t, p.triage) : t.line }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{p.id.toUpperCase()} · {p.title}</Text>
            {p.alert ? <Text style={{ color: t.red, fontWeight: "600" }}>{p.alert}</Text> : null}
            <Text style={{ color: t.quiet }}>
              Soll {p.target} {TREND[p.trend]} · Ist {p.triage ?? "–"} · {p.place} · {p.helpers.join(", ") || "kein Helfer"}
              {p.lastContact !== null && !p.helpers.length ? ` · letzter Kontakt vor ${Math.floor(exerciseMinutes(w.clock, w.offset, now) - p.lastContact)} min` : ""}
              {p.lastContact === null ? " · noch kein Kontakt" : ""}
            </Text>
          </View>
          <Text style={{ color: t.quiet, fontSize: 12 }}>{p.phase}</Text>
        </View>
      ))}
      <Text style={{ color: t.text, fontWeight: "600", marginTop: 8 }}>Helfer ({v?.helpers.length ?? 0})</Text>
      {v?.helpers.map((h) => (
        <Text key={h.id} style={{ color: h.idle !== null && h.idle >= IDLE_MIN ? t.text : t.quiet }}>
          {h.name} ({h.trupp ?? h.unit}) · {h.patient?.toUpperCase() ?? "ohne Patient"}{h.busy ? ` · ${h.busy}` : ""}
          {h.idle !== null && h.idle >= IDLE_MIN ? ` · seit ${Math.floor(h.idle)} min ohne Maßnahme` : ""}
        </Text>
      ))}
      {(v?.trupps.length ?? 0) > 0 && <Text style={{ color: t.text, fontWeight: "600", marginTop: 8 }}>Trupps</Text>}
      {v?.trupps.map((tr) => (
        <Text key={tr.code} style={{ color: t.quiet }}>
          <Text style={{ color: t.text, fontWeight: "700" }}>{tr.code}</Text> · {tr.name} · {tr.unit} · {tr.members.join(", ") || "noch niemand"}
        </Text>
      ))}
      <Text style={{ color: t.text, fontWeight: "600", marginTop: 8 }}>Ereignisse</Text>
      {v?.events.slice(0, 15).map((e, i) => <Text key={i} style={{ color: t.quiet }}>{clock(e.t * 60000)} {e.text}</Text>)}
      <View style={{ gap: 10, marginTop: 8 }}>
        {st === "running" && <Button t={t} strong label="Pausieren" onPress={() => ctl("pause")} />}
        {st === "paused" && <Button t={t} strong label="Fortsetzen" onPress={() => ctl("resume")} />}
        <Button t={t} label="QR-Zettel drucken" onPress={() => Linking.openURL(`${httpBase(session.server)}/print/${code}`)} />
        {st !== "ended" && <Button t={t} label="Übung beenden" onPress={() => ctl("end")} />}
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
              <Text accessibilityLabel={`Übungscode ${code.split("").join(" ")}`} style={{ color: "#111", fontSize: 64, fontWeight: "900", letterSpacing: 6 }}>{code}</Text>
            </View>
          </Breathe>
          <View style={{ backgroundColor: WHITE, borderRadius: 18, padding: 10 }}>
            <Image source={{ uri: `${httpBase(session.server)}/qr/${code}.png` }} style={{ width: 180, height: 180 }} accessibilityLabel="QR-Code zum Beitreten" />
          </View>
        </View>
        <Text style={{ color: WHITE, opacity: 0.9 }}>dPS-App öffnen → „Ich übe“ → Code eingeben oder QR-Code scannen</Text>
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

function EvaluationPanel({ t, session, code, onShow }: { t: Theme; session: Session; code: string; onShow: (ev: Evaluation) => void }) {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api<Evaluation>(session, `/api/exercises/${code}/evaluation`).then(setEv, (e: Error) => setError(e.message));
  useEffect(load, [code]);
  if (!ev) return error ? <Text style={{ color: t.red }}>{error}</Text> : null;
  const m = (x: number | null) => (x === null ? "–" : clock(x * 60000));
  return (
    <View style={{ gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 14 }}>
      <FunButton label="Auswertung zeigen (Beamer)" color={FUN.purple} text="#FFFFFF" onPress={() => onShow(ev)} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: t.text, fontWeight: "700", fontSize: 20 }}>Auswertung</Text>
        <Stars t={t} stars={ev.team.stars} />
      </View>
      <Text style={{ color: t.text }}>{ev.team.survived} von {ev.team.eligible} Patienten überlebt</Text>
      <Text style={{ color: t.quiet }}>Kritische Maßnahmen: {ev.critical.timely} rechtzeitig · {ev.critical.late} zu spät · {ev.critical.missed} verpasst</Text>
      <Text style={{ color: t.quiet }}>Erste Sichtung: {ev.triage.correct} korrekt · {ev.triage.over} Übertriage · {ev.triage.under} Untertriage</Text>
      {(["sichtung", "behandlung", "transport"] as const).filter((r) => Object.values(ev.triageByRole[r]).some((x) => x > 0)).map((r) => (
        <Text key={r} style={{ color: t.quiet }}>Sichtungen durch {ROLE_SHORT[r]}: {ev.triageByRole[r].correct} korrekt · {ev.triageByRole[r].over} über · {ev.triageByRole[r].under} unter</Text>
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
