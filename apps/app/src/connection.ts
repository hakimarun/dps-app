// Verbindung zum Übungsserver mit Offline-Puffer:
// Jede Aktion bekommt eine id und ihren Zeitpunkt (in Serverzeit), landet in einer gespeicherten Warteschlange
// und wird gesendet, sobald eine Verbindung besteht. Der Server ignoriert doppelt gesendete ids.
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ClientMsg, Intent, ServerMsg, View } from "@dps/schema/protocol";

type Welcome = Extract<ServerMsg, { type: "welcome" }>;
type Pending = Extract<ClientMsg, { type: "intent" }>;

export type Conn = {
  status: "idle" | "connecting" | "online" | "offline";
  welcome: Welcome | null;
  participant: string | null;
  view: View | null;
  queued: number;
  error: string | null;
  offset: number; // Serverzeit minus Gerätezeit in ms
};

const key = (code: string) => `dps:${code.toUpperCase()}`;
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function useConnection() {
  const [c, setC] = useState<Conn>({ status: "idle", welcome: null, participant: null, view: null, queued: 0, error: null, offset: 0 });
  const r = useRef({ ws: null as WebSocket | null, server: "", code: "", participant: null as string | null, queue: [] as Pending[], offset: 0, retry: 0 as ReturnType<typeof setTimeout> | 0 });

  const save = () => AsyncStorage.setItem(key(r.current.code), JSON.stringify({ participant: r.current.participant, queue: r.current.queue }));
  const flush = () => {
    const ws = r.current.ws;
    if (ws?.readyState === WebSocket.OPEN) for (const m of r.current.queue) ws.send(JSON.stringify(m));
  };

  const open = useCallback(() => {
    const { server, code } = r.current;
    clearTimeout(r.current.retry);
    setC((s) => ({ ...s, status: s.status === "idle" ? "connecting" : s.status }));
    const ws = new WebSocket(server);
    r.current.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", exercise: code, participant: r.current.participant } satisfies ClientMsg));
    ws.onclose = () => {
      if (r.current.ws !== ws) return;
      setC((s) => ({ ...s, status: "offline" }));
      r.current.retry = setTimeout(open, 2000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      if (m.type === "welcome") {
        r.current.offset = m.serverNow - Date.now();
        if (!m.participant) r.current.queue = r.current.queue.filter((q) => q.intent.type === "join"); // Server kennt uns nicht (mehr)
        r.current.participant = m.participant;
        save();
        setC((s) => ({ ...s, status: "online", welcome: m, participant: m.participant, offset: r.current.offset, queued: r.current.queue.length, error: null }));
        flush();
      } else if (m.type === "ack") {
        r.current.queue = r.current.queue.filter((q) => q.id !== m.id);
        if (m.participant) r.current.participant = m.participant;
        save();
        setC((s) => ({ ...s, participant: r.current.participant, queued: r.current.queue.length, error: m.error }));
      } else if (m.type === "view") setC((s) => ({ ...s, view: m.view }));
      else setC((s) => ({ ...s, error: m.error }));
    };
  }, []);

  const connect = useCallback(
    async (server: string, code: string) => {
      r.current.ws?.close();
      r.current.ws = null;
      const stored = JSON.parse((await AsyncStorage.getItem(key(code))) ?? "{}");
      Object.assign(r.current, { server, code: code.toUpperCase(), participant: stored.participant ?? null, queue: stored.queue ?? [] });
      await AsyncStorage.setItem("dps:last", JSON.stringify({ server, code }));
      setC({ status: "connecting", welcome: null, participant: null, view: null, queued: r.current.queue.length, error: null, offset: 0 });
      open();
    },
    [open],
  );

  const send = useCallback((intent: Intent) => {
    const m: Pending = { type: "intent", id: newId(), at: Date.now() + r.current.offset, intent };
    r.current.queue.push(m);
    save();
    setC((s) => ({ ...s, queued: r.current.queue.length, error: null }));
    if (r.current.ws?.readyState === WebSocket.OPEN) r.current.ws.send(JSON.stringify(m));
  }, []);

  useEffect(() => () => r.current.ws?.close(), []);
  return { conn: c, connect, send };
}

export async function lastConnection(): Promise<{ server: string; code: string } | null> {
  return JSON.parse((await AsyncStorage.getItem("dps:last")) ?? "null");
}
