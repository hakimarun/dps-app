// Übungsserver: REST für Praxisanleiter, WebSocket für Helfer und Live-Lage.
//   node apps/server/src/main.ts --port 3000 --data data
// E-Mail: SMTP_URL (z. B. smtps://user:pass@host) und MAIL_FROM setzen; ohne SMTP_URL steht der Anmeldecode im Log.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import nodemailer from "nodemailer";
import QRCode from "qrcode";
import { z } from "zod";
import { ApproveReq, ClientMsg, ControlReq, CreateExerciseReq, GenerateReq, LoginReq, ScenarioGenReq, VerifyReq, type Level, type Role, type ServerMsg, type Trupp } from "@dps/schema/protocol";
import { Patient, type Scenario } from "@dps/schema";
import { triage, type Settings } from "@dps/engine";
import { fromEnv } from "./ai.ts";
import { generate, generateFrame } from "./generator.ts";
import { allowedActions, control, leitungView, loadLibrary, minutes, released, roleOf, stateAt, status, submit, submitAsk, viewFor, type Exercise } from "./exercise.ts";
import { evaluate } from "./evaluation.ts";
import { approvalCounts, attachPatient, attachedPatients, loadDrafts, loadExercises, loadScenarios, myApprovals, newCode, openDb, requestLogin, saveDraft, saveExercise, saveScenario, setApproval, userByToken, verifyLogin, type Draft } from "./db.ts";
import { printPage } from "./print.ts";

const { values: opt } = parseArgs({ options: { port: { type: "string", default: "3000" }, data: { type: "string", default: "data" } } });
mkdirSync(opt.data, { recursive: true });
const db = openDb(join(opt.data, "dps.sqlite"));
const lib = loadLibrary(new URL("../../../library/", import.meta.url));
// Geprüfte KI-Entwürfe sind spielbar wie Musterverläufe; vor den Übungen laden, die sie nutzen.
const drafts = new Map(loadDrafts(db).map((d) => [d.id, d]));
for (const d of drafts.values()) if (d.report.ok) lib.defs.patients[d.id] = Patient.parse(d.patient);
// KI-Szenarien und nachträglich generierte Patienten (auch in Szenarien aus der Bibliothek).
type LibScenario = Scenario & { situation?: string };
const scenarios = lib.scenarios as Record<string, LibScenario>;
for (const s of loadScenarios(db) as LibScenario[]) scenarios[s.id] = s;
for (const a of attachedPatients(db)) if (scenarios[a.scenario] && lib.defs.patients[a.patient]) scenarios[a.scenario].patients.push(a.patient);
const exercises = new Map(loadExercises(db, lib.defs).map((ex) => [ex.code, ex]));
const dialogAi = fromEnv("dialog");
const generatorAi = fromEnv("generator");
const readIdeas = (f: string) => (existsSync(new URL(f, ideasDir)) ? JSON.parse(readFileSync(new URL(f, ideasDir), "utf8")) : []);
const ideasDir = new URL("../../../library/ideas/", import.meta.url);
const startSk = (p: Patient) => (p.phases[p.start].dead ? "EX" : triage({ ...p.base, ...p.phases[p.start].findings, exam: {} }, "mstart"));
// Trupp-Codes zeigen direkt auf Übung und Trupp.
const truppCodes = new Map<string, { ex: Exercise; trupp: Trupp }>();
const indexTrupps = (ex: Exercise) => ex.trupps!.forEach((trupp) => truppCodes.set(trupp.code, { ex, trupp }));
exercises.forEach(indexTrupps);
const resolve = (code: string) => {
  const c = code.toUpperCase();
  const ex = exercises.get(c);
  return ex ? { ex, trupp: null } : truppCodes.get(c) ?? null;
};
const ROLE_LABEL: Record<Role, string> = { sichtung: "Sichtungstrupp", behandlung: "Behandlungstrupp", transport: "Transporttrupp" };
// KI-Entwurf eines Patienten: speichern; besteht er die Prüfung, ist er spielbar (nach Freigabe).
async function draftPatient(brief: string, owner: string): Promise<Draft> {
  const { raw, report } = await generate(generatorAi!, brief, lib.defs.actions, lib.defs.patients.p01);
  const id = (raw as { id: string }).id;
  const d: Draft = { id, owner, created: Date.now(), brief, patient: raw, report };
  saveDraft(db, d);
  drafts.set(id, d);
  if (report.ok) lib.defs.patients[id] = Patient.parse(raw);
  return d;
}
// Patienten eines Szenarios nacheinander generieren; die Bibliothek zeigt den Fortschritt.
// ponytail: Fortschritt nur im Speicher; nach einem Neustart fehlen nur die noch nicht erzeugten Patienten.
type Job = { total: number; done: number; failed: number; error: string | null };
const jobs = new Map<string, Job>();
async function fillScenario(id: string, briefs: string[], owner: string) {
  let job = jobs.get(id);
  if (job && job.done < job.total) job.total += briefs.length;
  else jobs.set(id, (job = { total: briefs.length, done: 0, failed: 0, error: null }));
  for (const brief of briefs) {
    try {
      const d = await draftPatient(brief, owner);
      if (d.report.ok) (attachPatient(db, id, d.id, Date.now()), scenarios[id].patients.push(d.id));
      else job.failed++;
    } catch (e) {
      job.failed++;
      job.error = e instanceof Error ? e.message : String(e);
    }
    job.done++;
  }
}
const mailer = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;

const LEVELS: Record<Level, Pick<Settings, "phaseMinutes" | "random">> = {
  einsteiger: { phaseMinutes: 20, random: false },
  fortgeschritten: { phaseMinutes: 15, random: false },
  experte: { phaseMinutes: 12, random: true },
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    if ((size += c.length) > 64_000) throw new HttpError(413, "Anfrage zu groß");
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { throw new HttpError(400, "kein gültiges JSON"); }
}

function send(res: ServerResponse, status: number, data: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": `${type}; charset=utf-8` });
  res.end(type === "application/json" ? JSON.stringify(data) : String(data));
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const route = `${req.method} ${url.pathname}`;
  let m: RegExpMatchArray | null;

  if (route === "GET /") return send(res, 200, "dps-server ok\n", "text/plain");
  if ((m = route.match(/^GET \/print\/([A-Z0-9]{6})$/))) {
    const ex = exercises.get(m[1]);
    return ex ? send(res, 200, await printPage(ex), "text/html") : send(res, 404, "unbekannte Übung", "text/plain");
  }
  // Lobby (J2): QR-Code zum Beitreten, als PNG, damit ihn die App auf allen Plattformen anzeigen kann.
  if ((m = route.match(/^GET \/qr\/([A-Z0-9]{6})\.png$/))) {
    if (!resolve(m[1])) return send(res, 404, "unbekannte Übung", "text/plain");
    const png = await QRCode.toBuffer(`dps:${m[1]}`, { width: 600, margin: 1, errorCorrectionLevel: "M" });
    res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
    return res.end(png);
  }
  if (route === "POST /api/login") {
    const { email } = LoginReq.parse(await body(req));
    const r = requestLogin(db, email, Date.now());
    if ("error" in r) throw new HttpError(429, r.error);
    if (mailer)
      await mailer.sendMail({ from: process.env.MAIL_FROM ?? "dPS <noreply@localhost>", to: email, subject: "Dein Anmeldecode für dPS", text: `Dein Code: ${r.code}\nEr gilt 15 Minuten.` });
    else console.log(`Anmeldecode für ${email}: ${r.code}`);
    return send(res, 200, { ok: true });
  }
  if (route === "POST /api/verify") {
    const { email, code } = VerifyReq.parse(await body(req));
    const r = verifyLogin(db, email, code, Date.now());
    if (!r) throw new HttpError(401, "Code falsch oder abgelaufen");
    return send(res, 200, { token: r.token });
  }

  const user = userByToken(db, req.headers.authorization?.replace(/^Bearer /, "") ?? "");
  if (!user) throw new HttpError(401, "nicht angemeldet");

  if (route === "GET /api/me") return send(res, 200, user);
  if (route === "GET /api/library") {
    const mine = myApprovals(db, user.id);
    const counts = approvalCounts(db);
    const all = [...exercises.values()];
    return send(res, 200, {
      patients: [
        ...Object.values(lib.defs.patients).map((p) => ({
          id: p.id, version: p.version, title: p.title, picture: p.picture,
          approved: mine.get(p.id) === p.version,
          approvals: counts.get(p.id) ?? 0,
          uses: all.filter((ex) => ex.scenario.patients.includes(p.id)).length,
          meta: p.meta, sk: startSk(p), origin: drafts.has(p.id) ? "ki" : "muster", errors: [] as string[],
        })),
        // KI-Entwürfe mit Fehlern: sichtbar mit Prüfbericht, aber nicht freigebbar
        ...[...drafts.values()].filter((d) => !d.report.ok).map((d) => ({
          id: d.id, version: 1, title: (d.patient as { title?: string }).title ?? d.id, picture: d.brief, approved: false, approvals: 0, uses: 0,
          meta: { category: "KI-Entwurf", tags: [], difficulty: "fortgeschritten" }, sk: null, origin: "ki", errors: d.report.errors,
        })),
      ],
      scenarios: Object.values(scenarios).map((s) => ({
        id: s.id, title: s.title, patients: s.patients, situation: s.situation ?? null, origin: s.id.startsWith("ki-") ? "ki" : "muster", job: jobs.get(s.id) ?? null,
      })),
    });
  }
  if ((m = route.match(/^GET \/api\/library\/([a-z0-9-]{1,64})$/))) {
    const p = lib.defs.patients[m[1]] ?? drafts.get(m[1])?.patient;
    if (!p) throw new HttpError(404, "unbekannter Fall");
    const d = drafts.get(m[1]);
    return send(res, 200, { patient: p, actions: Object.fromEntries(Object.values(lib.defs.actions).map((a) => [a.id, a.title])), report: d?.report ?? null, brief: d?.brief ?? null });
  }
  if (route === "GET /api/ideas") return send(res, 200, { cases: readIdeas("cases.json"), scenarios: readIdeas("scenarios.json"), generator: !!generatorAi });
  if (route === "POST /api/generate") {
    if (!generatorAi) throw new HttpError(503, "KI-Fallgenerator ist nicht eingerichtet (AI_GENERATOR, ANTHROPIC_API_KEY oder LOCAL_AI_URL)");
    const { brief } = GenerateReq.parse(await body(req));
    const d = await draftPatient(brief, user.id).catch((e) => {
      throw new HttpError(502, `KI-Fehler: ${e instanceof Error ? e.message : e}`);
    });
    return send(res, 201, { id: d.id, report: d.report });
  }
  if (route === "POST /api/scenarios") {
    if (!generatorAi) throw new HttpError(503, "KI-Fallgenerator ist nicht eingerichtet");
    const { brief, patients } = ScenarioGenReq.parse(await body(req));
    const { scenario, briefs } = await generateFrame(generatorAi, brief, patients, scenarios.busunfall ?? Object.values(scenarios)[0]).catch((e) => {
      throw new HttpError(502, `KI-Fehler: ${e instanceof Error ? e.message : e}`);
    });
    saveScenario(db, user.id, brief, scenario, Date.now());
    scenarios[scenario.id] = scenario;
    void fillScenario(scenario.id, briefs, user.id);
    return send(res, 201, { id: scenario.id, patients: briefs.length });
  }
  if ((m = route.match(/^POST \/api\/scenarios\/([a-z0-9-]{1,64})\/patients$/))) {
    if (!generatorAi) throw new HttpError(503, "KI-Fallgenerator ist nicht eingerichtet");
    const sc = scenarios[m[1]];
    if (!sc) throw new HttpError(404, "unbekanntes Szenario");
    const { brief } = GenerateReq.parse(await body(req));
    void fillScenario(sc.id, [`Lage: ${sc.situation ?? sc.title}\nPatient: ${brief}`], user.id);
    return send(res, 202, { ok: true });
  }
  if (route === "POST /api/library/approve") {
    const r = ApproveReq.parse(await body(req));
    const p = lib.defs.patients[r.item];
    if (!p) throw new HttpError(404, "unbekannter Fall");
    setApproval(db, user.id, p.id, p.version, r.approved, Date.now());
    return send(res, 200, { ok: true });
  }
  if (route === "GET /api/exercises") {
    const mine = [...exercises.values()].filter((ex) => ex.owner === user.id).sort((a, b) => b.created - a.created);
    return send(res, 200, mine.map((ex) => ({ code: ex.code, title: ex.scenario.title, status: status(ex), patients: ex.scenario.patients, created: ex.created, settings: ex.settings, trupps: ex.trupps })));
  }
  if (route === "POST /api/exercises") {
    const r = CreateExerciseReq.parse(await body(req));
    const sc = lib.scenarios[r.scenario];
    if (!sc) throw new HttpError(400, "unbekanntes Szenario");
    const mine = myApprovals(db, user.id);
    const missing = r.patients.filter((id) => !lib.defs.patients[id] || mine.get(id) !== lib.defs.patients[id].version);
    if (missing.length) throw new HttpError(400, `nicht von dir freigegeben: ${missing.join(", ")}`);
    const taken = (c: string) => exercises.has(c) || truppCodes.has(c) || trupps.some((t) => t.code === c);
    // Trupps: Transporttrupps auf Fahrzeuge mit Plätzen verteilen, die übrigen reihum auf alle Einheiten.
    const trupps: Trupp[] = [];
    for (const role of ["sichtung", "behandlung", "transport"] as const) {
      const units = role === "transport" && sc.units.some((u) => u.seats > 0) ? sc.units.filter((u) => u.seats > 0) : sc.units;
      for (let i = 0; i < r.trupps[role]; i++)
        trupps.push({ code: newCode(taken), name: `${ROLE_LABEL[role]} ${i + 1}`, role, unit: units[i % units.length].id });
    }
    const code = newCode(taken);
    const ex = saveExercise(db, {
      code, owner: user.id, scenario: { ...sc, patients: r.patients },
      settings: { algorithm: r.algorithm, ...LEVELS[r.level] }, seed: randomInt(1, 2 ** 31), created: Date.now(), trupps,
    }, lib.defs);
    exercises.set(code, ex);
    indexTrupps(ex);
    return send(res, 201, { code });
  }
  if ((m = route.match(/^GET \/api\/exercises\/([A-Z0-9]{6})\/evaluation$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    return send(res, 200, evaluate(ex, Date.now()));
  }
  if ((m = route.match(/^POST \/api\/exercises\/([A-Z0-9]{6})\/control$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    const error = control(ex, ControlReq.parse(await body(req)).type, Date.now());
    if (error) throw new HttpError(409, error);
    broadcast(ex, true);
    return send(res, 200, { status: status(ex) });
  }
  throw new HttpError(404, "nicht gefunden");
}

const http = createServer((req, res) => {
  // Bearer-Token statt Cookies, darum ist "*" hier unbedenklich.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else if (e instanceof z.ZodError) send(res, 400, { error: "ungültige Eingabe" });
    else (console.error(e), send(res, 500, { error: "Serverfehler" }));
  });
});

// WebSocket: Helfer (hello) und Leitung (watch).
type Client = { ex: Exercise | null; trupp: Trupp | null; participant: string | null; watch: boolean; last: string };
const clients = new Map<WebSocket, Client>();
const out = (ws: WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));
const clock = (ex: Exercise, now = Date.now()): ServerMsg => ({ type: "clock", status: status(ex), t: minutes(ex, now), serverNow: now });

function onMessage(ws: WebSocket, raw: string) {
  const c = clients.get(ws)!;
  const parsed = ClientMsg.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return out(ws, { type: "error", error: "ungültige Nachricht" });
  const m = parsed.data;
  if (m.type === "hello" || m.type === "watch") {
    const found = resolve(m.exercise);
    if (!found || (m.type === "watch" && found.trupp)) return out(ws, { type: "error", error: "unbekannter Übungscode" });
    const { ex, trupp } = found;
    if (m.type === "watch" && ex.owner !== userByToken(db, m.token)?.id) return out(ws, { type: "error", error: "keine Berechtigung" });
    Object.assign(c, { ex, trupp, watch: m.type === "watch", last: "", participant: m.type === "hello" && m.participant && ex.names.has(m.participant) ? m.participant : null });
    if (m.type === "hello") {
      const role = c.participant ? roleOf(ex, c.participant) : trupp?.role ?? "behandlung";
      out(ws, {
        type: "welcome", title: ex.scenario.title, participant: c.participant,
        units: ex.scenario.units.map((u) => ({ id: u.id, title: u.title })),
        actions: allowedActions(ex, role).map((a) => ({ id: a.id, title: a.title, minutes: a.minutes, material: a.material, group: a.group })),
        trupp: trupp && { name: trupp.name, role: trupp.role, unit: ex.scenario.units.find((u) => u.id === trupp.unit)?.title ?? trupp.unit },
        ai: !!dialogAi,
      });
    }
    out(ws, clock(ex));
  } else {
    if (!c.ex || c.watch) return out(ws, { type: "error", error: "erst hello senden" });
    if (m.intent.type === "ask") {
      // Antwort der KI kann dauern: asynchron, ohne andere Nachrichten aufzuhalten.
      const ex = c.ex;
      void submitAsk(ex, c.participant, m, Date.now(), dialogAi).then((r) => (out(ws, { type: "ack", id: m.id, error: r.error }), broadcast(ex)));
      return;
    }
    const r = submit(c.ex, c.participant, m, Date.now(), c.trupp);
    if (r.participant) c.participant = r.participant;
    out(ws, { type: "ack", id: m.id, error: r.error, participant: r.participant });
  }
  broadcast(c.ex!);
}

// Sendet jedem Client seiner Übung die eigene Sicht, aber nur bei Änderung.
function broadcast(ex: Exercise, withClock = false) {
  const now = Date.now();
  const mine = [...clients].filter(([, c]) => c.ex === ex);
  if (!mine.length) return;
  const s = stateAt(ex, minutes(ex, now));
  const ev = released(ex) ? evaluate(ex, now) : null; // Bericht erst nach Freigabe durch die Leitung
  for (const [ws, c] of mine) {
    if (withClock) out(ws, clock(ex, now));
    if (!c.watch && !c.participant) continue;
    const me = ev?.helpers.find((h) => h.id === c.participant);
    const view = c.watch ? null : { ...viewFor(ex, s, c.participant!), result: ev && me ? { team: ev.team, me } : null };
    const json = JSON.stringify(c.watch ? { type: "leitung", view: leitungView(ex, now) } : { type: "view", view: view! });
    if (json !== c.last) (c.last = json), ws.send(json);
  }
}

new WebSocketServer({ server: http }).on("connection", (ws) => {
  clients.set(ws, { ex: null, trupp: null, participant: null, watch: false, last: "" });
  ws.on("message", (raw) => onMessage(ws, String(raw)));
  ws.on("close", () => clients.delete(ws));
});
setInterval(() => new Set([...clients.values()].map((c) => c.ex).filter((ex) => ex !== null)).forEach((ex) => broadcast(ex)), 1000);
http.listen(Number(opt.port), () =>
  console.log(`dPS-Server auf Port ${opt.port}, ${exercises.size} Übungen, KI-Dialog: ${dialogAi?.name ?? "aus"}, KI-Generator: ${generatorAi?.name ?? "aus"}`));
