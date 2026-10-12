// Übungsserver: REST für die Spielleitung (Geräteschlüssel statt Konten), WebSocket für Helfer und Live-Lage.
//   node apps/server/src/main.ts --port 3000 --data data [--https]
//   --https: selbst signiertes Zertifikat für die WLAN-Adressen (Betrieb ohne Internet, N3), damit Handys Kamera und Mikrofon freigeben.
import { createServer, type IncomingMessage, type RequestListener, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, join, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomInt } from "node:crypto";
import { parseArgs } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import QRCode from "qrcode";
import { z } from "zod";
import { ApproveReq, CaseSaveReq, ClientMsg, ControlReq, CreateExerciseReq, EE_ROLES, FeedbackReq, ROLE_LABEL, GenerateReq, InjectReq, NoteReq, ScenarioBundle, ScenarioGenReq, ScenarioSaveReq, type Level, type Role, type ServerMsg, type Trupp } from "@dps/schema/protocol";
import { Patient, type Scenario } from "@dps/schema";
import { triage, type Settings } from "@dps/engine";
import { fromEnv } from "./ai.ts";
import { buildUnits, check, generate, generateFrame } from "./generator.ts";
import { SOLO, allowedActions, control, createExercise, csv, inject, leitungView, observerView, loadLibrary, minutes, released, replay, roleOf, soloHeader, withCallsigns, speedOf, stateAt, status, submit, submitAsk, timeline, viewFor, type Exercise } from "./exercise.ts";
import { evaluate, summary } from "./evaluation.ts";
import { approvalCounts, attachPatient, attachedPatients, deleteExercisesBefore, detachPatients, loadDrafts, loadExercises, loadScenarios, myApprovals, newCode, newDevice, openDb, saveDraft, saveExercise, saveScenario, setApproval, userByToken, type Draft } from "./db.ts";
import { printPage, reportPage } from "./print.ts";
import { suggestFeedback } from "./feedback.ts";
import { imageGenFromEnv } from "./images.ts";
import { lanAddresses, selfSigned } from "./tls.ts";

const { values: opt } = parseArgs({ options: { port: { type: "string", default: "3000" }, data: { type: "string", default: "data" }, web: { type: "string" }, https: { type: "boolean", default: false } } });
const webDir = resolvePath(opt.web ?? fileURLToPath(new URL("../../app/dist/", import.meta.url)));
const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".wasm": "application/wasm" };
mkdirSync(opt.data, { recursive: true });
const db = openDb(join(opt.data, "dps.sqlite"));
const lib = loadLibrary(new URL("../../../library/", import.meta.url));
// Geprüfte KI-Entwürfe sind spielbar wie Musterverläufe; vor den Übungen laden, die sie nutzen.
const drafts = new Map(loadDrafts(db).map((d) => [d.id, d]));
for (const d of drafts.values()) if (d.report.ok) lib.defs.patients[d.id] = Patient.parse(d.patient);
// KI-Szenarien und nachträglich generierte Patienten (auch in Szenarien aus der Bibliothek).
type LibScenario = Scenario & { situation?: string; owner?: string };
const scenarios = lib.scenarios as Record<string, LibScenario>;
for (const { owner, data } of loadScenarios(db)) {
  const s = data as LibScenario;
  scenarios[s.id] = { ...s, owner, patients: s.patients.filter((id) => lib.defs.patients[id]) };
}
for (const a of attachedPatients(db)) if (scenarios[a.scenario] && lib.defs.patients[a.patient]) scenarios[a.scenario].patients.push(a.patient);
// N10: Übungen nach der Aufbewahrungsfrist löschen (RETENTION_DAYS, Standard 180 Tage), beim Start und täglich.
const RETENTION_MS = Number(process.env.RETENTION_DAYS ?? 180) * 24 * 60 * 60_000;
const purged = deleteExercisesBefore(db, Date.now() - RETENTION_MS);
if (purged.length) console.log(`${purged.length} Übungen nach Ablauf der Aufbewahrungsfrist gelöscht`);
const exercises = new Map(loadExercises(db, lib.defs).map((ex) => [ex.code, ex]));
setInterval(() => {
  for (const code of deleteExercisesBefore(db, Date.now() - RETENTION_MS)) {
    exercises.get(code)?.trupps?.forEach((tr) => truppCodes.delete(tr.code));
    observerCodes.delete(exercises.get(code)?.observer ?? "");
    exercises.delete(code);
  }
}, 24 * 60 * 60_000).unref();
const dialogAi = fromEnv("dialog");
const generatorAi = fromEnv("generator");
// Patientenbilder (optional, IMAGE_GEN=mflux): ein Bild je Fall in <data>/images, immer nur eines gleichzeitig (~9 GB Speicher).
const imageGen = imageGenFromEnv();
const imagesDir = join(opt.data, "images");
mkdirSync(imagesDir, { recursive: true });
const imageFile = (id: string) => join(imagesDir, `${id}.png`);
const imageUrl = (id: string) => (existsSync(imageFile(id)) ? `/images/${id}.png?v=${Math.round(statSync(imageFile(id)).mtimeMs)}` : null);
let painting: string | null = null;
const readIdeas = (f: string) => (existsSync(new URL(f, ideasDir)) ? JSON.parse(readFileSync(new URL(f, ideasDir), "utf8")) : []);
const ideasDir = new URL("../../../library/ideas/", import.meta.url);
const startSk = (p: Patient) => (p.phases[p.start].dead ? "EX" : triage({ ...p.base, ...p.phases[p.start].findings, exam: {} }, "mstart"));
// Trupp-Codes zeigen direkt auf Übung und Trupp.
const truppCodes = new Map<string, { ex: Exercise; trupp: Trupp }>();
const indexTrupps = (ex: Exercise) => ex.trupps!.forEach((trupp) => truppCodes.set(trupp.code, { ex, trupp }));
exercises.forEach(indexTrupps);
// E7: Beobachter-Codes zeigen auf ihre Übung (nur Notizen schreiben und lesen).
const observerCodes = new Map<string, Exercise>();
const indexObserver = (ex: Exercise) => ex.observer && observerCodes.set(ex.observer, ex);
exercises.forEach(indexObserver);
const codeTaken = (c: string) => exercises.has(c) || truppCodes.has(c) || observerCodes.has(c);
const NOTES_MAX = 500; // je Übung
const resolve = (code: string) => {
  const c = code.toUpperCase();
  const ex = exercises.get(c);
  return ex ? { ex, trupp: null } : truppCodes.get(c) ?? null;
};
const SOLO_MAX = 300; // ponytail: feste Obergrenze gegen Fluten des offenen Endpunkts; bei Bedarf Rate-Limit je IP
// Solo-Fälle sind ohne Anmeldung offen: KI höchstens SOLO_AI_QUESTIONS Fragen je Fall, danach antwortet der Patient aus seinem Profil.
const SOLO_AI_QUESTIONS = 20;
const aiFor = (ex: Exercise) => (ex.owner === SOLO && ex.records.filter((r) => r.event.type === "ask").length >= SOLO_AI_QUESTIONS ? null : dialogAi);
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
const devices: number[] = []; // Zeitpunkte neuer Geräte in der letzten Minute
const DEVICES_PER_MINUTE = 30; // ponytail: globale Grenze gegen Fluten; bei Bedarf je IP

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

async function body(req: IncomingMessage, limit = 64_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    if ((size += c.length) > limit) throw new HttpError(413, "Anfrage zu groß");
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

  // Web-App (npm run build:web): Helfer öffnen nur die Adresse des Servers, ohne Installation.
  if (req.method === "GET" && !/^\/(api|print|qr|images)\//.test(url.pathname)) {
    if (!existsSync(webDir)) return url.pathname === "/" ? send(res, 200, "dps-server ok\n", "text/plain") : send(res, 404, "nicht gefunden", "text/plain");
    const file = resolvePath(webDir, `.${decodeURIComponent(url.pathname)}`);
    const path = file.startsWith(webDir + sep) && existsSync(file) && statSync(file).isFile() ? file : join(webDir, "index.html"); // Einstieg für alle anderen Pfade
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": path.includes("/_expo/") ? "max-age=31536000, immutable" : "no-cache" });
    return res.end(readFileSync(path));
  }
  if ((m = route.match(/^GET \/print\/([A-Z0-9]{6})$/))) {
    const ex = exercises.get(m[1]);
    return ex ? send(res, 200, await printPage(ex), "text/html") : send(res, 404, "unbekannte Übung", "text/plain");
  }
  if ((m = route.match(/^GET \/images\/([a-z0-9-]{1,64})\.png$/))) {
    if (!existsSync(imageFile(m[1]))) return send(res, 404, "kein Bild", "text/plain");
    res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=86400" }); // URL trägt die Version
    return res.end(readFileSync(imageFile(m[1])));
  }
  // Lobby (J2): QR-Code zum Beitreten, als PNG, damit ihn die App auf allen Plattformen anzeigen kann.
  if ((m = route.match(/^GET \/qr\/([A-Z0-9]{6})\.png$/))) {
    if (!resolve(m[1])) return send(res, 404, "unbekannte Übung", "text/plain");
    const png = await QRCode.toBuffer(`dps:${m[1]}`, { width: 600, margin: 1, errorCorrectionLevel: "M" });
    res.writeHead(200, { "content-type": "image/png", "cache-control": "max-age=3600" });
    return res.end(png);
  }
  // Ohne Konten: Gerät bekommt beim ersten "Neues Spiel starten" einen Schlüssel.
  if (route === "POST /api/device") {
    const now = Date.now();
    while (devices.length && now - devices[0] > 60_000) devices.shift();
    if (devices.length >= DEVICES_PER_MINUTE) throw new HttpError(429, "Gerade starten sehr viele neue Geräte, bitte gleich erneut versuchen");
    devices.push(now);
    return send(res, 201, { token: newDevice(db, now) });
  }
  // Ein Eingabefeld für alle Codes: Übung, Trupp oder Beobachter.
  if ((m = route.match(/^GET \/api\/code\/([A-Za-z0-9]{6})$/))) {
    const c = m[1].toUpperCase();
    const kind = exercises.has(c) ? "exercise" : truppCodes.has(c) ? "trupp" : observerCodes.has(c) ? "observer" : null;
    if (!kind) throw new HttpError(404, "Diesen Code gibt es nicht");
    return send(res, 200, { kind, code: c });
  }
  // E7: Beobachter mit Beobachter-Code (ohne Konto): Lage zum Zuordnen lesen, Notizen schreiben.
  if ((m = route.match(/^GET \/api\/observe\/([A-Z0-9]{6})$/))) {
    const ex = observerCodes.get(m[1]);
    if (!ex) throw new HttpError(404, "unbekannter Beobachter-Code");
    return send(res, 200, observerView(ex, Date.now()));
  }
  if ((m = route.match(/^POST \/api\/observe\/([A-Z0-9]{6})\/notes$/))) {
    const ex = observerCodes.get(m[1]);
    if (!ex) throw new HttpError(404, "unbekannter Beobachter-Code");
    if (ex.records.filter((r) => r.event.type === "note").length >= NOTES_MAX) throw new HttpError(429, "zu viele Notizen in dieser Übung");
    const error = inject(ex, { type: "note", ...NoteReq.parse(await body(req)) }, Date.now());
    if (error) throw new HttpError(409, error);
    broadcast(ex);
    return send(res, 201, { ok: true });
  }
  // Fall des Tages (Solo): ohne Anmeldung, nur im Speicher. Alte Fälle nach 2 h weg, höchstens SOLO_MAX gleichzeitig.
  if (route === "POST /api/solo") {
    const now = Date.now();
    const solo = [...exercises.values()].filter((ex) => ex.owner === SOLO);
    for (const ex of solo) if (now - ex.created > 2 * 60 * 60_000) exercises.delete(ex.code);
    if (solo.filter((ex) => exercises.has(ex.code)).length >= SOLO_MAX) throw new HttpError(503, "Gerade üben sehr viele, bitte später erneut versuchen");
    const ex = createExercise(soloHeader(lib, newCode(codeTaken), now, randomInt(1, 2 ** 31)), lib.defs);
    control(ex, "start", now);
    exercises.set(ex.code, ex);
    return send(res, 201, { code: ex.code, patient: ex.scenario.patients[0] });
  }
  if ((m = route.match(/^POST \/api\/solo\/([A-Z0-9]{6})\/end$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== SOLO) throw new HttpError(404, "unbekannte Übung");
    if (status(ex) !== "ended") control(ex, "end", Date.now());
    if (!released(ex)) control(ex, "release", Date.now()); // Bericht sofort, es gibt keine Leitung
    broadcast(ex, true);
    return send(res, 200, { ok: true });
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
          approved: !drafts.has(p.id) || mine.get(p.id) === p.version, // Musterfälle sind geprüft und sofort spielbar
          approvals: counts.get(p.id) ?? 0,
          uses: all.filter((ex) => ex.scenario.patients.includes(p.id)).length,
          meta: p.meta, sk: startSk(p), origin: drafts.get(p.id)?.origin ?? "muster", errors: [] as string[], editable: drafts.get(p.id)?.owner === user.id,
          image: imageUrl(p.id),
        })),
        // KI-Entwürfe mit Fehlern: sichtbar mit Prüfbericht, aber nicht freigebbar
        ...[...drafts.values()].filter((d) => !d.report.ok).map((d) => ({
          id: d.id, version: 1, title: (d.patient as { title?: string }).title ?? d.id, picture: d.brief, approved: false, approvals: 0, uses: 0,
          meta: { category: d.origin === "eigen" ? "Eigener Entwurf" : d.origin === "import" ? "Importierter Entwurf" : "KI-Entwurf", tags: [], difficulty: "fortgeschritten" }, sk: null, origin: d.origin ?? "ki", errors: d.report.errors,
          editable: d.owner === user.id, image: null,
        })),
      ],
      imageGen: !!imageGen,
      scenarios: Object.values(scenarios).map((s) => ({
        id: s.id, title: s.title, patients: s.patients, situation: s.situation ?? null, job: jobs.get(s.id) ?? null,
        origin: s.id.startsWith("ki-") ? "ki" : s.id.startsWith("eigen-") ? "eigen" : s.id.startsWith("imp-") ? "import" : "muster", editable: s.owner === user.id,
        units: s.units.map((u) => ({ kind: u.title.slice(0, 3), title: u.title, arrivesAt: u.arrivesAt, seats: u.seats })),
      })),
    });
  }
  if ((m = route.match(/^GET \/api\/library\/([a-z0-9-]{1,64})$/))) {
    const p = lib.defs.patients[m[1]] ?? drafts.get(m[1])?.patient;
    if (!p) throw new HttpError(404, "unbekannter Fall");
    const d = drafts.get(m[1]);
    return send(res, 200, { patient: p, actions: Object.fromEntries(Object.values(lib.defs.actions).map((a) => [a.id, a.title])), report: d?.report ?? null, brief: d?.brief ?? null });
  }
  // Patientenbild erzeugen (dauert lokal 40–60 s) oder entfernen; maßgeblich bleibt der Bildtext.
  if ((m = route.match(/^POST \/api\/images\/([a-z0-9-]{1,64})$/))) {
    if (!imageGen) throw new HttpError(503, "Bilderzeugung ist nicht eingerichtet (IMAGE_GEN=mflux)");
    const p = lib.defs.patients[m[1]] ?? (drafts.get(m[1])?.patient as { picture?: string } | undefined);
    if (!p?.picture) throw new HttpError(404, "unbekannter Fall");
    if (painting) throw new HttpError(409, `Es wird gerade ein Bild für ${painting.toUpperCase()} erzeugt`);
    painting = m[1];
    try {
      await imageGen.generate(p.picture, imageFile(m[1]));
    } catch (e) {
      throw new HttpError(502, `Bildfehler: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    } finally {
      painting = null;
    }
    return send(res, 201, { image: imageUrl(m[1]) });
  }
  if ((m = route.match(/^POST \/api\/images\/([a-z0-9-]{1,64})\/remove$/))) {
    rmSync(imageFile(m[1]), { force: true });
    return send(res, 200, { image: null });
  }
  if (route === "GET /api/actions") return send(res, 200, Object.values(lib.defs.actions).map((a) => ({ id: a.id, title: a.title, group: a.group })));
  if (route === "GET /api/ideas") return send(res, 200, { cases: readIdeas("cases.json"), scenarios: readIdeas("scenarios.json"), generator: !!generatorAi });
  if (route === "POST /api/generate") {
    if (!generatorAi) throw new HttpError(503, "KI-Fallgenerator ist nicht eingerichtet (AI_GENERATOR, ANTHROPIC_API_KEY oder LOCAL_AI_URL)");
    const { brief } = GenerateReq.parse(await body(req));
    const d = await draftPatient(brief, user.id).catch((e) => {
      throw new HttpError(502, `KI-Fehler: ${e instanceof Error ? e.message : e}`);
    });
    return send(res, 201, { id: d.id, report: d.report });
  }
  // Formular-Editor (A1): prüfen ohne zu speichern, und speichern als eigener Entwurf.
  if (route === "POST /api/cases/check") {
    const { patient } = CaseSaveReq.parse(await body(req));
    return send(res, 200, check({ ...patient, id: String(patient.id ?? "neu"), version: 1 }, lib.defs.actions));
  }
  if (route === "POST /api/cases") {
    const { patient } = CaseSaveReq.parse(await body(req));
    const prev = drafts.get(String(patient.id ?? ""));
    const mine = prev?.owner === user.id; // eigene Entwürfe bekommen eine neue Version, alles andere wird eine Kopie
    const id = mine ? prev!.id : `eigen-${crypto.randomUUID().slice(0, 6)}`;
    const raw = { ...patient, id, version: mine ? Number((prev!.patient as { version?: number }).version ?? 1) + 1 : 1 };
    const report = check(raw, lib.defs.actions);
    const d: Draft = { id, owner: user.id, created: mine ? prev!.created : Date.now(), brief: `Eigener Fall: ${String(patient.title ?? "")}`, patient: raw, report, origin: "eigen" };
    saveDraft(db, d);
    drafts.set(id, d);
    if (report.ok) lib.defs.patients[id] = Patient.parse(raw);
    else delete lib.defs.patients[id]; // eine fehlerhafte neue Version ist nicht mehr spielbar
    return send(res, 201, { id, report });
  }
  // Formular-Editor (A4): Szenario aus Lage, Fahrzeugen und Patienten.
  if (route === "POST /api/scenarios/save") {
    const r = ScenarioSaveReq.parse(await body(req));
    const unknown = r.patients.filter((id) => !lib.defs.patients[id]);
    if (unknown.length) throw new HttpError(400, `unbekannte Patienten: ${unknown.join(", ")}`);
    const id = r.id && scenarios[r.id]?.owner === user.id ? r.id : `eigen-s${crypto.randomUUID().slice(0, 5)}`;
    const sc = { id, title: r.title, situation: r.situation, patients: r.patients, units: buildUnits(r.units, scenarios.busunfall ?? Object.values(scenarios)[0]) };
    saveScenario(db, user.id, "Editor", sc, Date.now());
    detachPatients(db, id);
    scenarios[id] = { ...sc, owner: user.id };
    return send(res, 201, { id });
  }
  // A6: Szenario als Datei exportieren und importieren.
  if ((m = route.match(/^GET \/api\/scenarios\/([a-z0-9-]{1,64})\/export$/))) {
    const sc = scenarios[m[1]];
    if (!sc) throw new HttpError(404, "unbekanntes Szenario");
    const bundle: ScenarioBundle = {
      format: "dps-szenario", version: 1, exported: new Date().toISOString().slice(0, 10),
      scenario: { title: sc.title, situation: sc.situation ?? null, patients: sc.patients, units: sc.units },
      patients: sc.patients.map((id) => (drafts.get(id)?.patient ?? lib.defs.patients[id]) as Record<string, unknown>),
    };
    return send(res, 200, bundle);
  }
  if (route === "POST /api/scenarios/import") {
    const b = ScenarioBundle.parse(await body(req, 2_000_000));
    // Jeder Fall wird eine eigene Kopie mit neuer ID, geprüft wie ein Fall aus dem Editor; fehlerhafte bleiben als Entwurf draußen.
    const ids = new Map<string, string>();
    const failed: { title: string; errors: string[] }[] = [];
    for (const raw of b.patients) {
      const id = `imp-${crypto.randomUUID().slice(0, 6)}`;
      const p = { ...raw, id, version: 1 };
      const report = check(p, lib.defs.actions);
      const d: Draft = { id, owner: user.id, created: Date.now(), brief: `Import: ${String(raw.title ?? "")}`, patient: p, report, origin: "import" };
      saveDraft(db, d);
      drafts.set(id, d);
      if (report.ok) (lib.defs.patients[id] = Patient.parse(p)), ids.set(String(raw.id), id);
      else failed.push({ title: String(raw.title ?? raw.id ?? "?"), errors: report.errors });
    }
    const patients = b.scenario.patients.flatMap((old) => ids.get(old) ?? []);
    if (!patients.length) throw new HttpError(400, `kein Fall hat die Prüfung bestanden: ${failed.map((f) => `${f.title} (${f.errors[0] ?? "?"})`).join("; ")}`);
    const id = `imp-s${crypto.randomUUID().slice(0, 5)}`;
    const sc = { id, title: b.scenario.title, situation: b.scenario.situation ?? undefined, patients, units: b.scenario.units };
    saveScenario(db, user.id, "Import", sc, Date.now());
    scenarios[id] = { ...sc, owner: user.id };
    return send(res, 201, { id, imported: patients.length, failed });
  }
  if (route === "POST /api/scenarios") {
    if (!generatorAi) throw new HttpError(503, "KI-Fallgenerator ist nicht eingerichtet");
    const { brief, patients } = ScenarioGenReq.parse(await body(req));
    const { scenario, briefs } = await generateFrame(generatorAi, brief, patients, scenarios.busunfall ?? Object.values(scenarios)[0]).catch((e) => {
      throw new HttpError(502, `KI-Fehler: ${e instanceof Error ? e.message : e}`);
    });
    saveScenario(db, user.id, brief, scenario, Date.now());
    scenarios[scenario.id] = { ...scenario, owner: user.id };
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
    return send(res, 200, mine.map((ex) => ({ code: ex.code, title: ex.scenario.title, status: status(ex), patients: ex.scenario.patients, created: ex.created, settings: ex.settings, trupps: ex.trupps, observer: ex.observer ?? null })));
  }
  // F7: beendete eigene Übungen nebeneinander, älteste zuerst
  if (route === "GET /api/exercises/compare") {
    const now = Date.now();
    // nur Übungen, die wirklich liefen (eine nie gestartete hätte sonst 3 Sterne ohne Einsatz)
    const done = [...exercises.values()].filter((ex) => ex.owner === user.id && status(ex) === "ended" && ex.controls.some((c) => c.type === "start")).sort((a, b) => a.created - b.created);
    return send(res, 200, done.map((ex) => summary(ex, evaluate(ex, now))));
  }
  if (route === "POST /api/exercises") {
    const r = CreateExerciseReq.parse(await body(req));
    const sc = lib.scenarios[r.scenario];
    if (!sc) throw new HttpError(400, "unbekanntes Szenario");
    const mine = myApprovals(db, user.id);
    // Ohne Konten: Musterfälle gelten als freigegeben; KI-, eigene und importierte Fälle braucht weiter die eigene Freigabe.
    const missing = r.patients.filter((id) => !lib.defs.patients[id] || (drafts.has(id) && mine.get(id) !== lib.defs.patients[id].version));
    if (missing.length) throw new HttpError(400, `nicht von dir freigegeben: ${missing.join(", ")}`);
    const taken = (c: string) => codeTaken(c) || trupps.some((t) => t.code === c);
    // Trupps: Transporttrupps auf Fahrzeuge mit Plätzen verteilen, die übrigen reihum auf alle Einheiten.
    const trupps: Trupp[] = [];
    // B3: je Einsatzeinheit Sicherungstrupp, Arzt, Zelt- und Techniktrupp; der Sicherungstrupp auf ein Fahrzeug mit Plätzen (Abgabe).
    const seated = sc.units.some((u) => u.seats > 0) ? sc.units.filter((u) => u.seats > 0) : sc.units;
    for (let e = 0; e < r.einheiten; e++)
      EE_ROLES.forEach((role, k) => trupps.push({
        code: newCode(taken), name: `EE ${e + 1} ${ROLE_LABEL[role]}`, role,
        unit: (role === "sicherung" ? seated[e % seated.length] : sc.units[(e * EE_ROLES.length + k) % sc.units.length]).id,
      }));
    // Eine Führung (OrgL, LNA, UA-Leiter teilen sich den Code), sobald mit Einsatzeinheiten geübt wird.
    if (r.einheiten > 0) trupps.push({ code: newCode(taken), name: ROLE_LABEL.fuehrung, role: "fuehrung", unit: sc.units[0].id });
    for (const role of ["sichtung", "behandlung", "transport"] as const) {
      const units = role === "transport" ? seated : sc.units;
      for (let i = 0; i < r.trupps[role]; i++)
        trupps.push({ code: newCode(taken), name: `${ROLE_LABEL[role]} ${i + 1}`, role, unit: units[i % units.length].id });
    }
    const code = newCode(taken);
    const observer = newCode((c) => taken(c) || c === code);
    const ex = saveExercise(db, {
      code, owner: user.id, scenario: { ...sc, patients: r.patients, units: withCallsigns(sc.units) },
      settings: { algorithm: r.algorithm, ...LEVELS[r.level], ...(r.phaseMinutes ? { phaseMinutes: r.phaseMinutes } : {}), ...(r.random !== undefined ? { random: r.random } : {}), vitals: r.vitals }, seed: randomInt(1, 2 ** 31), created: Date.now(), trupps, observer,
    }, lib.defs);
    exercises.set(code, ex);
    indexTrupps(ex);
    indexObserver(ex);
    return send(res, 201, { code });
  }
  if ((m = route.match(/^GET \/api\/exercises\/([A-Z0-9]{6})\/evaluation$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    return send(res, 200, evaluate(ex, Date.now()));
  }
  if ((m = route.match(/^GET \/api\/exercises\/([A-Z0-9]{6})\/(replay|export\.csv|report\.html)$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    const now = Date.now();
    if (m[2] === "report.html") return send(res, 200, reportPage(ex, evaluate(ex, now), timeline(ex, minutes(ex, now))), "text/html");
    return m[2] === "replay" ? send(res, 200, replay(ex, now)) : send(res, 200, csv(ex, now), "text/csv");
  }
  // G10: Feedback je Helfer: KI-Vorschlag (ohne text) oder geprüften Text speichern (mit text; leer nimmt ihn zurück).
  if ((m = route.match(/^POST \/api\/exercises\/([A-Z0-9]{6})\/feedback$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    const r = FeedbackReq.parse(await body(req));
    if (r.text !== undefined) {
      const error = inject(ex, { type: "feedback", helper: r.helper, text: r.text }, Date.now());
      if (error) throw new HttpError(409, error);
      broadcast(ex);
      return send(res, 200, { ok: true });
    }
    if (!generatorAi) throw new HttpError(503, "KI ist auf dem Server nicht eingerichtet");
    const report = evaluate(ex, Date.now()).helpers.find((h) => h.id === r.helper);
    if (!report) throw new HttpError(404, "unbekannter Helfer");
    const text = await suggestFeedback(generatorAi, ex, r.helper, report).catch((e) => {
      throw new HttpError(502, `KI-Fehler: ${e instanceof Error ? e.message : e}`);
    });
    return send(res, 200, { text });
  }
  if ((m = route.match(/^POST \/api\/exercises\/([A-Z0-9]{6})\/inject$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    const error = inject(ex, InjectReq.parse(await body(req)), Date.now());
    if (error) throw new HttpError(409, error);
    broadcast(ex);
    return send(res, 200, { ok: true });
  }
  if ((m = route.match(/^POST \/api\/exercises\/([A-Z0-9]{6})\/control$/))) {
    const ex = exercises.get(m[1]);
    if (!ex || ex.owner !== user.id) throw new HttpError(404, "unbekannte Übung");
    const r = ControlReq.parse(await body(req));
    const error = control(ex, r.type, Date.now(), r.factor);
    if (error) throw new HttpError(409, error);
    broadcast(ex, true);
    return send(res, 200, { status: status(ex) });
  }
  throw new HttpError(404, "nicht gefunden");
}

const handler: RequestListener = (req, res) => {
  // Bearer-Token statt Cookies, darum ist "*" hier unbedenklich.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "authorization, content-type");
  if (req.method === "OPTIONS") return send(res, 204, "", "text/plain");
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else if (e instanceof z.ZodError) send(res, 400, { error: "ungültige Eingabe" });
    else (console.error(e), send(res, 500, { error: "Serverfehler" }));
  });
};

// WebSocket: Helfer (hello) und Leitung (watch).
type Client = { ex: Exercise | null; trupp: Trupp | null; participant: string | null; watch: boolean; last: string };
const clients = new Map<WebSocket, Client>();
const out = (ws: WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));
const clock = (ex: Exercise, now = Date.now()): ServerMsg => ({ type: "clock", status: status(ex), t: minutes(ex, now), serverNow: now, speed: speedOf(ex) });

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
        actions: allowedActions(ex, role).map((a) => ({ id: a.id, title: a.title, minutes: a.minutes, material: a.material, group: a.group, helpers: a.helpers })),
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
      void submitAsk(ex, c.participant, m, Date.now(), aiFor(ex)).then((r) => (out(ws, { type: "ack", id: m.id, error: r.error }), broadcast(ex)));
      return;
    }
    const r = submit(c.ex, c.participant, m, Date.now(), c.trupp);
    if (r.participant) c.participant = r.participant;
    out(ws, { type: "ack", id: m.id, error: r.error, participant: r.participant });
  }
  broadcast(c.ex!);
}

// Sendet jedem Client seiner Übung die eigene Sicht, aber nur bei Änderung.
// Nach der Freigabe ist die Übung beendet und die Auswertung ändert sich nicht mehr: einmal rechnen statt jede Sekunde.
const evaluations = new WeakMap<Exercise, { key: string; ev: ReturnType<typeof evaluate> }>();
function finalEvaluation(ex: Exercise, now: number) {
  const key = `${ex.records.length}/${ex.controls.length}`;
  const hit = evaluations.get(ex);
  if (hit?.key === key) return hit.ev;
  const ev = evaluate(ex, now);
  evaluations.set(ex, { key, ev });
  return ev;
}

function broadcast(ex: Exercise, withClock = false) {
  const now = Date.now();
  const mine = [...clients].filter(([, c]) => c.ex === ex);
  if (!mine.length) return;
  const s = stateAt(ex, minutes(ex, now));
  const ev = released(ex) ? finalEvaluation(ex, now) : null; // Bericht erst nach Freigabe durch die Leitung
  for (const [ws, c] of mine) {
    if (withClock) out(ws, clock(ex, now));
    if (!c.watch && !c.participant) continue;
    const me = ev?.helpers.find((h) => h.id === c.participant);
    const own = c.watch ? null : viewFor(ex, s, c.participant!);
    if (own?.patient) own.patient.image = imageUrl(own.patient.id);
    const view = own && { ...own, result: ev && me ? { team: ev.team, me } : null };
    const json = JSON.stringify(c.watch ? { type: "leitung", view: leitungView(ex, now) } : { type: "view", view: view! });
    if (json !== c.last) (c.last = json), ws.send(json);
  }
}

const http = opt.https ? createHttpsServer(selfSigned(join(opt.data, "tls")), handler) : createServer(handler);
new WebSocketServer({ server: http }).on("connection", (ws) => {
  clients.set(ws, { ex: null, trupp: null, participant: null, watch: false, last: "" });
  ws.on("message", (raw) => onMessage(ws, String(raw)));
  ws.on("close", () => clients.delete(ws));
});
setInterval(() => new Set([...clients.values()].map((c) => c.ex).filter((ex) => ex !== null)).forEach((ex) => broadcast(ex)), 1000);
http.listen(Number(opt.port), async () => {
  console.log(`dPS-Server auf Port ${opt.port}, ${exercises.size} Übungen, KI-Dialog: ${dialogAi?.name ?? "aus"}, KI-Generator: ${generatorAi?.name ?? "aus"}`);
  // Adresse für die Helfer im WLAN vor Ort, dazu ein QR-Code zum Abscannen mit der Handy-Kamera
  const urls = lanAddresses().map((ip) => `${opt.https ? "https" : "http"}://${ip}:${opt.port}`);
  if (!urls.length) return;
  console.log(`Helfer öffnen im WLAN: ${urls.join("  ")}${opt.https ? "  (Zertifikatswarnung einmal bestätigen)" : ""}`);
  console.log(await QRCode.toString(urls[0], { type: "terminal", small: true }));
});
