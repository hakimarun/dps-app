// Übungsserver: eine Übung pro Prozess (Meilenstein 2). Start:
//   node apps/server/src/main.ts --code DEMO --scenario busunfall --patients p01
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMsg, type ServerMsg } from "@dps/schema/protocol";
import { defaultSettings } from "@dps/engine";
import { createExercise, loadExercise, loadLibrary, minutes, stateAt, submit, viewFor } from "./exercise.ts";

const { values: opt } = parseArgs({
  options: {
    port: { type: "string", default: "3000" },
    code: { type: "string", default: "DEMO" },
    scenario: { type: "string", default: "busunfall" },
    patients: { type: "string" }, // Komma-Liste, z. B. p01,p04
    data: { type: "string", default: "data" },
    seed: { type: "string", default: "1" },
  },
});

const lib = loadLibrary(new URL("../../../library/", import.meta.url));
const code = opt.code.toUpperCase();
const file = join(opt.data, `${code}.jsonl`);
const base = lib.scenarios[opt.scenario];
if (!base) throw new Error(`Szenario ${opt.scenario} fehlt`);
const scenario = opt.patients ? { ...base, patients: opt.patients.split(",") } : base;
const ex = existsSync(file)
  ? loadExercise(file, lib.defs)
  : createExercise({ code, scenario, settings: defaultSettings, seed: Number(opt.seed), startedAt: Date.now() }, lib.defs, file);

const clients = new Map<WebSocket, { hello: boolean; participant: string | null; last: string }>();
const send = (ws: WebSocket, m: ServerMsg) => ws.send(JSON.stringify(m));

function onMessage(ws: WebSocket, raw: string) {
  const c = clients.get(ws)!;
  const parsed = ClientMsg.safeParse((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!parsed.success) return send(ws, { type: "error", error: "ungültige Nachricht" });
  const m = parsed.data;
  if (m.type === "hello") {
    if (m.exercise.toUpperCase() !== ex.code) return send(ws, { type: "error", error: "unbekannter Übungscode" });
    c.hello = true;
    c.participant = m.participant && ex.names.has(m.participant) ? m.participant : null;
    c.last = "";
    send(ws, {
      type: "welcome",
      serverNow: Date.now(),
      startedAt: ex.startedAt,
      title: ex.scenario.title,
      units: ex.scenario.units.map((u) => ({ id: u.id, title: u.title })),
      actions: Object.values(ex.defs.actions).map((a) => ({ id: a.id, title: a.title, minutes: a.minutes, material: a.material })),
      participant: c.participant,
    });
  } else {
    if (!c.hello) return send(ws, { type: "error", error: "erst hello senden" });
    const r = submit(ex, c.participant, m, Date.now());
    if (r.participant) c.participant = r.participant;
    send(ws, { type: "ack", id: m.id, error: r.error, participant: r.participant });
  }
  broadcast();
}

// Sendet jedem Helfer seine Sicht, aber nur wenn sie sich geändert hat.
function broadcast() {
  const s = stateAt(ex, minutes(ex, Date.now()));
  for (const [ws, c] of clients) {
    if (!c.participant) continue;
    const json = JSON.stringify({ type: "view", view: viewFor(ex, s, c.participant) } satisfies ServerMsg);
    if (json !== c.last) {
      c.last = json;
      ws.send(json);
    }
  }
}

const http = createServer((_req, res) => res.end("dps-server ok\n"));
new WebSocketServer({ server: http }).on("connection", (ws) => {
  clients.set(ws, { hello: false, participant: null, last: "" });
  ws.on("message", (raw) => onMessage(ws, String(raw)));
  ws.on("close", () => clients.delete(ws));
});
setInterval(broadcast, 1000);
http.listen(Number(opt.port), () => console.log(`Übung ${ex.code} (${ex.scenario.patients.join(", ")}) auf Port ${opt.port}`));
