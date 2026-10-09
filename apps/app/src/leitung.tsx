// Praxisanleiter (Meilenstein 3): Anmeldung per E-Mail-Code, Bibliothek mit eigener Freigabe,
// Übung anlegen, QR-Zettel, Start/Pause/Ende und Live-Lage.
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Findings, Patient, Sk } from "@dps/schema";
import type { Evaluation, Level, LeitungView, ServerMsg, Status } from "@dps/schema/protocol";
import { DEFAULT_SERVER, exerciseMinutes } from "./connection";
import { Badge, Button, Chip, Field, Sheet, Stars, Title, clock, skColor, type Theme } from "./ui";

type Session = { server: string; token: string; email: string };
type LibPatient = { id: string; version: number; title: string; picture: string; approved: boolean; approvals: number; uses: number };
type Library = { patients: LibPatient[]; scenarios: { id: string; title: string; patients: string[] }[] };
type ExerciseInfo = { code: string; title: string; status: Status; patients: string[] };
type Clock = Extract<ServerMsg, { type: "clock" }>;

const STATUS: Record<Status, string> = { ready: "bereit", running: "läuft", paused: "pausiert", ended: "beendet" };
const ROLES = [["sichtung", "Sichtungstrupps"], ["behandlung", "Behandlungstrupps"], ["transport", "Transporttrupps"]] as const;
const ROLE_SHORT: Record<string, string> = { sichtung: "Sichtung", behandlung: "Behandlung", transport: "Transport" };
const LEVELS: [Level, string][] = [["einsteiger", "Einsteiger"], ["fortgeschritten", "Fortgeschritten"], ["experte", "Experte"]];
const ALGOS: [string, string][] = [["mstart", "mSTaRT"], ["prior", "PRIOR"], ["asav", "ASAV"]];
const httpBase = (server: string) => server.trim().replace(/^ws/, "http").replace(/\/$/, "");

async function api<T>(s: { server: string; token: string }, path: string, body?: unknown): Promise<T> {
  const res = await fetch(httpBase(s.server) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data as T;
}

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

function useLibrary(session: Session) {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api<Library>(session, "/api/library").then(setLib, (e: Error) => setError(e.message));
  useEffect(load, [session.token]);
  return { lib, error, load };
}

function LibraryScreen({ t, session }: { t: Theme; session: Session }) {
  const { lib, error, load } = useLibrary(session);
  const [filter, setFilter] = useState<"alle" | "meine" | "offen">("alle");
  const [detail, setDetail] = useState<LibPatient | null>(null);
  const shown = lib?.patients.filter((p) => filter === "alle" || (filter === "meine") === p.approved) ?? [];
  const toggle = (p: LibPatient) => api(session, "/api/library/approve", { item: p.id, approved: !p.approved }).then(load);
  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
        <Title t={t}>Bibliothek</Title>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip t={t} label="Alle" selected={filter === "alle"} onPress={() => setFilter("alle")} />
          <Chip t={t} label="Von mir freigegeben" selected={filter === "meine"} onPress={() => setFilter("meine")} />
          <Chip t={t} label="Offen" selected={filter === "offen"} onPress={() => setFilter("offen")} />
        </View>
        {error && <Text style={{ color: t.red }}>{error}</Text>}
        {shown.map((p) => (
          <Pressable key={p.id} accessibilityRole="button" onPress={() => setDetail(p)} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 4 }}>
            <Text style={{ color: t.text, fontWeight: "600", fontSize: 16 }}>{p.id.toUpperCase()} {p.title}</Text>
            <Text style={{ color: t.quiet }}>Muster · {p.approved ? "von dir freigegeben" : "noch nicht geprüft"}</Text>
            <Text style={{ color: t.quiet }}>{p.approvals}-mal freigegeben · {p.uses}-mal genutzt</Text>
          </Pressable>
        ))}
      </ScrollView>
      {detail && <CaseDetail t={t} session={session} item={detail} onToggle={() => toggle(detail).then(() => setDetail(null))} onClose={() => setDetail(null)} />}
    </>
  );
}

// Befunde in Kurzform, z. B. "AF 32 · HF 135 · RR 85/60 · kein Radialispuls".
function summary(f: Partial<Findings>): string {
  const parts: string[] = [];
  const num: [keyof Findings, string, string?][] = [["rr", "AF"], ["spo2", "SpO₂", " %"], ["hr", "HF"], ["bp", "RR"], ["gcs", "GCS"], ["recap", "Rekap", " s"], ["pain", "NRS"], ["temp", "Temp", " °C"]];
  for (const [k, label, unit] of num) if (f[k] !== undefined) parts.push(`${label} ${f[k]}${unit ?? ""}`);
  if (f.walking !== undefined) parts.push(f.walking ? "gehfähig" : "liegt");
  if (f.breathing === false) parts.push("keine Atmung");
  if (f.radialPulse === false) parts.push("kein Radialispuls");
  if (f.followsCommands === false) parts.push("befolgt keine Aufforderungen");
  if (f.spurtingBleeding) parts.push("spritzende Blutung");
  if (f.spurtingBleeding === false) parts.push("Blutung steht");
  if (f.stridor) parts.push("Stridor");
  if (f.lethalInjury) parts.push("tödliche Verletzung");
  for (const [k, v] of Object.entries(f.exam ?? {})) parts.push(`${k}: ${v}`);
  return parts.join(" · ");
}

function CaseDetail({ t, session, item, onToggle, onClose }: { t: Theme; session: Session; item: LibPatient; onToggle: () => void; onClose: () => void }) {
  const [data, setData] = useState<{ patient: Patient; actions: Record<string, string> } | null>(null);
  useEffect(() => void api<typeof data>(session, `/api/library/${item.id}`).then(setData), [item.id]);
  const a = (id: string) => data?.actions[id] ?? id;
  return (
    <Sheet t={t} title={`${item.id.toUpperCase()} ${item.title}`} onClose={onClose}>
      <Text style={{ color: t.text }}>{item.picture}</Text>
      {data && (
        <>
          <Text style={{ color: t.quiet }}>Ausgangslage: {summary(data.patient.base)}</Text>
          {Object.entries(data.patient.phases).map(([id, ph]) => (
            <View key={id} style={{ borderTopWidth: 1, borderColor: t.line, paddingTop: 8, gap: 2 }}>
              <Text style={{ color: t.text, fontWeight: "600" }}>
                Phase {id}{ph.minutes ? ` (${ph.minutes} min)` : ""}{ph.dead ? " · tot" : ""}{ph.left ? " · abtransportiert" : ""}
              </Text>
              {Object.keys(ph.findings).length > 0 && <Text style={{ color: t.text }}>{summary(ph.findings)}</Text>}
              {ph.rules.map((r, i) => (
                <Text key={i} style={{ color: t.quiet }}>
                  {[r.when.length ? `wenn ${r.when.map(a).join(" + ")}` : "", r.active.length ? `solange ${r.active.map(a).join(" + ")} läuft` : ""].filter(Boolean).join(", ")} → {r.then}
                </Text>
              ))}
              {ph.else && <Text style={{ color: t.quiet }}>sonst → {ph.else}</Text>}
            </View>
          ))}
        </>
      )}
      <Button t={t} strong label={item.approved ? "Freigabe zurückziehen" : "Für meine Übungen freigeben"} onPress={onToggle} />
    </Sheet>
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
        onPress={() => api<{ code: string }>(session, "/api/exercises", { scenario: sc!.id, patients: picked, algorithm, level, trupps }).then(({ code }) => onCreated(code), (e: Error) => setError(e.message))} />
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
  const ctl = (type: "start" | "pause" | "resume" | "end") => api(session, `/api/exercises/${code}/control`, { type }).catch((e: Error) => setError(e.message));
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
      {st === "ended" && <EvaluationPanel t={t} session={session} code={code} />}
      <View style={{ flexDirection: "row", gap: 6 }}>{(["I", "II", "III", "EX", "offen"] as const).map(skCell)}</View>
      {v?.patients.map((p) => (
        <View key={p.id} style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
          <View style={{ width: 5, alignSelf: "stretch", borderRadius: 2, backgroundColor: p.triage ? skColor(t, p.triage) : t.line }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontWeight: "600" }}>{p.id.toUpperCase()} · {p.title}</Text>
            {p.alert ? <Text style={{ color: t.red, fontWeight: "600" }}>{p.alert}</Text> : null}
            <Text style={{ color: t.quiet }}>Soll {p.target} · Ist {p.triage ?? "–"} · {p.place} · {p.helpers.join(", ") || "kein Helfer"}</Text>
          </View>
          <Text style={{ color: t.quiet, fontSize: 12 }}>{p.phase}</Text>
        </View>
      ))}
      <Text style={{ color: t.text, fontWeight: "600", marginTop: 8 }}>Helfer ({v?.helpers.length ?? 0})</Text>
      {v?.helpers.map((h) => (
        <Text key={h.id} style={{ color: t.quiet }}>{h.name} ({h.trupp ?? h.unit}) · {h.patient?.toUpperCase() ?? "ohne Patient"}{h.busy ? ` · ${h.busy}` : ""}</Text>
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
        {st === "ready" && <Button t={t} strong label="Übung starten" onPress={() => ctl("start")} />}
        {st === "running" && <Button t={t} strong label="Pausieren" onPress={() => ctl("pause")} />}
        {st === "paused" && <Button t={t} strong label="Fortsetzen" onPress={() => ctl("resume")} />}
        <Button t={t} label="QR-Zettel drucken" onPress={() => Linking.openURL(`${httpBase(session.server)}/print/${code}`)} />
        {st !== "ended" && <Button t={t} label="Übung beenden" onPress={() => ctl("end")} />}
      </View>
    </ScrollView>
  );
}

const OUTCOME_RED = new Set(["verstorben"]);

function EvaluationPanel({ t, session, code }: { t: Theme; session: Session; code: string }) {
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api<Evaluation>(session, `/api/exercises/${code}/evaluation`).then(setEv, (e: Error) => setError(e.message));
  useEffect(load, [code]);
  if (!ev) return error ? <Text style={{ color: t.red }}>{error}</Text> : null;
  const m = (x: number | null) => (x === null ? "–" : clock(x * 60000));
  return (
    <View style={{ gap: 10, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 14 }}>
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
