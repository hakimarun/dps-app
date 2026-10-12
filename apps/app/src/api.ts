// REST-Zugriff für Praxisanleiter und gemeinsame Typen der Bibliothek.
import { useEffect, useState } from "react";
import { Platform, Share } from "react-native";
import type { Sk } from "@dps/schema";

export type Session = { server: string; token: string }; // token: Geräteschlüssel der Spielleitung (keine Konten)
export type LibPatient = {
  id: string; version: number; title: string; picture: string; approved: boolean; approvals: number; uses: number;
  meta: { category: string; tags: string[]; difficulty: string }; sk: Sk | null; origin: "muster" | "ki" | "eigen" | "import"; errors: string[];
  editable: boolean; // eigener Entwurf: Bearbeiten erzeugt eine neue Version, sonst eine Kopie
  image: string | null; // Pfad zum Patientenbild auf dem Server
};
export type LibScenario = {
  id: string; title: string; patients: string[]; situation: string | null; origin: "muster" | "ki" | "eigen" | "import"; editable: boolean;
  units: { kind: string; title: string; arrivesAt: number; seats: number }[];
  job: { total: number; done: number; failed: number; error: string | null } | null; // KI erzeugt gerade Patienten
};
export type Library = { patients: LibPatient[]; scenarios: LibScenario[]; imageGen: boolean };

export const httpBase = (server: string) => server.trim().replace(/^ws/, "http").replace(/\/$/, "");

export async function api<T>(s: { server: string; token: string }, path: string, body?: unknown): Promise<T> {
  const res = await fetch(httpBase(s.server) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(s.token ? { authorization: `Bearer ${s.token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data as T;
}

export function useLibrary(session: Session) {
  const [lib, setLib] = useState<Library | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void api<Library>(session, "/api/library").then(setLib, (e: Error) => setError(e.message));
  useEffect(load, [session.token]);
  return { lib, error, load };
}

// Datei vom Server: im Web herunterladen, auf dem Handy über das Teilen-Menü weitergeben (Mail, Dateien …).
export async function download(s: { server: string; token: string }, path: string, filename: string) {
  const res = await fetch(httpBase(s.server) + path, { headers: { authorization: `Bearer ${s.token}` } });
  if (!res.ok) throw new Error(`Export fehlgeschlagen (${res.status})`);
  if (Platform.OS !== "web") return void (await Share.share({ title: filename, message: await res.text() }));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob()); // blob statt text(): text() würde ein BOM (CSV für Excel) abschneiden
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
