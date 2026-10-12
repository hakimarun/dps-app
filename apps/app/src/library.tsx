// Bibliothek für Praxisanleiter: spielbare Fälle (Muster und KI-Entwürfe), 100 Fallideen, 100 Szenarien.
// Übersicht durch Suche, Filter (Status, Kategorie, Sichtungskategorie) und Gruppen je Kategorie.
import { useEffect, useState, type ReactNode } from "react";
import { Image, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Findings, Patient, Sk } from "@dps/schema";
import { api, download, httpBase, useLibrary, type LibPatient, type LibScenario, type Session } from "./api";
import { Button, Card, Chip, Field, Sheet, Title, skColor, type Theme } from "./ui";
import { SHAPES, TILE } from "./fun";
import { CaseEditor, ScenarioEditor } from "./editor";

type Idea = {
  id: string; title: string; category: string; picture: string; course: string; critical: string[]; harmful: string[];
  sk: Sk; trap: string; temperament: string; difficulty: string; tags: string[]; newActions: string[];
};
type ScenarioIdea = {
  id: string; title: string; category: string; situation: string; patients: number; mix: Record<string, number>;
  special: string[]; units: string; learning: string; difficulty: string; caseIds: string[];
};
type Ideas = { cases: Idea[]; scenarios: ScenarioIdea[]; generator: boolean };
type Report = { ok: boolean; errors: string[]; warnings: string[]; sk: Sk | null };

const DIFF: Record<string, string> = { einsteiger: "Einsteiger", fortgeschritten: "Fortgeschritten", experte: "Experte" };
const SKS: Sk[] = ["I", "II", "III", "IV", "EX"];
// Suche: alle Wörter müssen in einem der Felder vorkommen.
const matches = (q: string, fields: string[]) => {
  const hay = fields.join(" ").toLowerCase();
  return q.trim().toLowerCase().split(/\s+/).every((w) => hay.includes(w));
};
const groupBy = <T,>(items: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of items) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m].sort(([a], [b]) => a.localeCompare(b));
};

export function LibraryScreen({ t, session }: { t: Theme; session: Session }) {
  const [tab, setTab] = useState<"faelle" | "ideen" | "szenarien">("faelle");
  const [ideas, setIdeas] = useState<Ideas | null>(null);
  useEffect(() => void api<Ideas>(session, "/api/ideas").then(setIdeas), [session.token]);
  const lib = useLibrary(session);
  // Solange die KI Patienten für ein Szenario erzeugt, alle 5 s nachladen.
  const running = lib.lib?.scenarios.some((s) => s.job && s.job.done < s.job.total);
  useEffect(() => {
    if (!running) return;
    const i = setTimeout(lib.load, 5000);
    return () => clearTimeout(i);
  }, [lib.lib]);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingBottom: 8 }}>
        <Chip t={t} label="Fälle" selected={tab === "faelle"} onPress={() => setTab("faelle")} />
        <Chip t={t} label={`Ideen ${ideas?.cases.length ?? ""}`} selected={tab === "ideen"} onPress={() => setTab("ideen")} />
        <Chip t={t} label={`Szenarien ${ideas?.scenarios.length ?? ""}`} selected={tab === "szenarien"} onPress={() => setTab("szenarien")} />
      </View>
      {tab === "faelle" && <Cases t={t} session={session} lib={lib} generator={!!ideas?.generator} />}
      {tab === "ideen" && <IdeaList t={t} session={session} ideas={ideas} onGenerated={() => (lib.load(), setTab("faelle"))} />}
      {tab === "szenarien" && <ScenarioList t={t} session={session} ideas={ideas} lib={lib} />}
    </View>
  );
}

function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {children}
    </ScrollView>
  );
}

function Row({ t, color, title, lines, onPress }: { t: Theme; color: string; title: string; lines: { text: string; color?: string }[]; onPress: () => void }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Card t={t} color={color} onPress={onPress}>
        <Text style={{ color: t.text, fontWeight: "800" }}>{title}</Text>
        {lines.map((l, i) => <Text key={i} style={{ color: l.color ?? t.quiet, fontSize: 13 }}>{l.text}</Text>)}
      </Card>
    </View>
  );
}

// Kategorie-Überschrift als bunte Kachel mit Symbol (Farbe fest je Kategorie).
function Group({ label, count }: { label: string; count: number }) {
  const i = [...label].reduce((a, c) => a + c.charCodeAt(0), 0) % 4;
  return (
    <View style={{ flexDirection: "row", marginTop: 16, marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: TILE[i], borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text aria-hidden style={{ color: "#FFFFFF", fontSize: 15 }}>{SHAPES[i]}</Text>
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{label} · {count}</Text>
      </View>
    </View>
  );
}

function Filters<S extends string>({ t, q, setQ, status, setStatus, statuses, cats, cat, setCat, sk, setSk }: {
  t: Theme; q: string; setQ: (v: string) => void; status?: S; setStatus?: (s: S) => void; statuses?: [S, string][];
  cats: string[]; cat: string | null; setCat: (c: string | null) => void; sk: Sk | null; setSk: (s: Sk | null) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Field t={t} label="Suche (Titel, Kategorie, Schlagwort)" value={q} onChange={setQ} />
      {statuses && <ChipRow>{statuses.map(([id, label]) => <Chip key={id} t={t} label={label} selected={status === id} onPress={() => setStatus!(id)} />)}</ChipRow>}
      <ChipRow>
        <Chip t={t} label="Alle Kategorien" selected={!cat} onPress={() => setCat(null)} />
        {cats.map((c) => <Chip key={c} t={t} label={c} selected={cat === c} onPress={() => setCat(cat === c ? null : c)} />)}
      </ChipRow>
      <ChipRow>
        <Chip t={t} label="Jede SK" selected={!sk} onPress={() => setSk(null)} />
        {SKS.map((s) => <Chip key={s} t={t} label={`SK ${s}`} selected={sk === s} onPress={() => setSk(sk === s ? null : s)} />)}
      </ChipRow>
    </View>
  );
}

type CaseStatus = "alle" | "meine" | "offen" | "ki";

function Cases({ t, session, lib, generator }: { t: Theme; session: Session; lib: ReturnType<typeof useLibrary>; generator: boolean }) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<CaseStatus>("alle");
  const [cat, setCat] = useState<string | null>(null);
  const [sk, setSk] = useState<Sk | null>(null);
  const [detail, setDetail] = useState<LibPatient | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Patient | "neu" | null>(null);
  const all = lib.lib?.patients ?? [];
  const shown = all.filter((p) =>
    (status === "alle" || (status === "meine" && p.approved) || (status === "offen" && !p.approved) || (status === "ki" && p.origin === "ki")) &&
    (!cat || p.meta.category === cat) && (!sk || p.sk === sk) && matches(q, [p.id, p.title, p.meta.category, ...p.meta.tags]));
  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
        <Title t={t}>Fälle</Title>
        <Text style={{ color: t.quiet }}>{shown.length} von {all.length} · {all.filter((p) => p.approved).length} von dir freigegeben</Text>
        <Button t={t} label="Neuer Fall (Formular)" onPress={() => setEditing("neu")} />
        <Button t={t} label="Neuer Fall mit KI" disabled={!generator} note={generator ? undefined : "KI-Fallgenerator ist auf dem Server nicht eingerichtet"} onPress={() => setCreating(true)} />
        <Filters t={t} q={q} setQ={setQ} status={status} setStatus={setStatus}
          statuses={[["alle", "Alle"], ["meine", "Von mir freigegeben"], ["offen", "Offen"], ["ki", "KI-Entwürfe"]]}
          cats={[...new Set(all.map((p) => p.meta.category))].sort()} cat={cat} setCat={setCat} sk={sk} setSk={setSk} />
        {lib.error && <Text style={{ color: t.red }}>{lib.error}</Text>}
        {groupBy(shown, (p) => p.meta.category).map(([category, items]) => (
          <View key={category}>
            <Group label={category} count={items.length} />
            {items.map((p) => (
              <Row key={p.id} t={t} color={p.sk ? skColor(t, p.sk) : t.line} title={`${p.id.toUpperCase()} ${p.title}`} onPress={() => setDetail(p)}
                lines={[
                  { text: `SK ${p.sk ?? "–"} · ${DIFF[p.meta.difficulty] ?? p.meta.difficulty}${p.meta.tags.length ? ` · ${p.meta.tags.join(", ")}` : ""}` },
                  p.errors.length
                    ? { text: "KI-Entwurf · Prüfung fehlgeschlagen", color: t.red }
                    : { text: `${p.approved ? "✓ von dir freigegeben" : p.origin === "ki" ? "KI-Entwurf · noch nicht geprüft" : "noch nicht geprüft"} · ${p.approvals}× freigegeben · ${p.uses}× genutzt`, color: p.approved ? t.green : undefined },
                ]} />
            ))}
          </View>
        ))}
      </ScrollView>
      {detail && !editing && (
        <CaseDetail t={t} session={session} item={detail} imageGen={!!lib.lib?.imageGen} onImage={lib.load} onClose={() => setDetail(null)} onEdit={setEditing}
          onToggle={() => api(session, "/api/library/approve", { item: detail.id, approved: !detail.approved }).then(() => (lib.load(), setDetail(null)))} />
      )}
      {editing && (
        <CaseEditor t={t} session={session} initial={editing === "neu" ? undefined : editing} onClose={() => setEditing(null)}
          onSaved={() => (setEditing(null), setDetail(null), lib.load())} />
      )}
      {creating && <GenerateSheet t={t} session={session} onClose={() => setCreating(false)} onDone={() => (lib.load(), setCreating(false))} />}
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

function ReportView({ t, report }: { t: Theme; report: Report }) {
  return (
    <View style={{ gap: 4, backgroundColor: t.tint, borderRadius: 10, padding: 12 }}>
      <Text style={{ color: report.ok ? t.text : t.red, fontWeight: "600" }}>
        Prüfbericht: {report.ok ? "bestanden" : "Fehler gefunden"}{report.sk ? ` · Soll-SK zum Start ${report.sk}` : ""}
      </Text>
      {report.errors.map((e, i) => <Text key={`e${i}`} style={{ color: t.red }}>• {e}</Text>)}
      {report.warnings.map((w, i) => <Text key={`w${i}`} style={{ color: t.quiet }}>• Hinweis: {w}</Text>)}
    </View>
  );
}

function CaseDetail({ t, session, item, imageGen, onImage, onToggle, onClose, onEdit }: {
  t: Theme; session: Session; item: LibPatient; imageGen: boolean; onImage: () => void; onToggle: () => void; onClose: () => void; onEdit: (p: Patient) => void;
}) {
  const [image, setImage] = useState(item.image);
  const [painting, setPainting] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const paint = (remove = false) => {
    setPainting(!remove);
    setImageError(null);
    api<{ image: string | null }>(session, `/api/images/${item.id}${remove ? "/remove" : ""}`, {}).then(
      (r) => (setImage(r.image), setPainting(false), onImage()),
      (e: Error) => (setImageError(e.message), setPainting(false)),
    );
  };
  const [data, setData] = useState<{ patient: Patient; actions: Record<string, string>; report: Report | null } | null>(null);
  useEffect(() => void api<typeof data>(session, `/api/library/${item.id}`).then(setData), [item.id]);
  const a = (id: string) => data?.actions[id] ?? (id === "handover" ? "Übergabe" : id);
  const sources = (data?.patient.profile?.sources as string[] | undefined) ?? [];
  return (
    <Sheet t={t} title={`${item.id.toUpperCase()} ${item.title}`} onClose={onClose}>
      {image && <Image source={{ uri: httpBase(session.server) + image }} accessibilityLabel="Bild des Patienten" style={{ width: "100%", aspectRatio: 1, maxHeight: 320, borderRadius: 14 }} />}
      <Text style={{ color: t.text }}>{item.picture}</Text>
      {(imageGen || image) && (
        <View style={{ gap: 6 }}>
          {imageGen && <Button t={t} label={painting ? "Bild wird erzeugt … (ca. 1 min)" : image ? "Neues Bild erzeugen" : "Bild erzeugen"} disabled={painting} onPress={() => paint()} />}
          {image && !painting && <Button t={t} label="Bild entfernen" onPress={() => paint(true)} />}
          <Text style={{ color: t.quiet, fontSize: 12 }}>Das Bild entsteht lokal aus dem Bildtext. Vor der Freigabe prüfen: Verletzungen stellt das Modell oft ungenau dar, maßgeblich bleibt der Text.</Text>
          {imageError && <Text style={{ color: t.red }}>{imageError}</Text>}
        </View>
      )}
      {data?.report && <ReportView t={t} report={data.report} />}
      {data?.patient.base && (
        <>
          <Text style={{ color: t.quiet }}>Ausgangslage: {summary(data.patient.base)}</Text>
          {Object.entries(data.patient.phases).map(([id, ph]) => (
            <View key={id} style={{ borderTopWidth: 1, borderColor: t.line, paddingTop: 8, gap: 2 }}>
              <Text style={{ color: t.text, fontWeight: "600" }}>
                Phase {id}{ph.minutes ? ` (${ph.minutes} min)` : ""}{ph.dead ? " · tot" : ""}{ph.left ? " · abtransportiert" : ""}
              </Text>
              {Object.keys(ph.findings ?? {}).length > 0 && <Text style={{ color: t.text }}>{summary(ph.findings)}</Text>}
              {(ph.rules ?? []).map((r, i) => (
                <Text key={i} style={{ color: t.quiet }}>
                  {[r.when?.length ? `wenn ${r.when.map(a).join(" + ")}` : "", r.active?.length ? `solange ${r.active.map(a).join(" + ")} läuft` : ""].filter(Boolean).join(", ")} → {r.then}
                </Text>
              ))}
              {ph.else && <Text style={{ color: t.quiet }}>sonst → {ph.else}</Text>}
            </View>
          ))}
          {sources.length > 0 && <Text style={{ color: t.quiet }}>Quellen laut KI (bitte prüfen): {sources.join("; ")}</Text>}
        </>
      )}
      <Button t={t} strong label={item.approved ? "Freigabe zurückziehen" : "Für meine Übungen freigeben"} disabled={item.errors.length > 0} onPress={onToggle} />
      {data?.patient && <Button t={t} label={item.editable ? "Bearbeiten (neue Version)" : "Als Kopie bearbeiten"} onPress={() => onEdit(data.patient)} />}
    </Sheet>
  );
}

function GenerateSheet({ t, session, brief: initial = "", title = "Neuer Fall mit KI", onClose, onDone }: {
  t: Theme; session: Session; brief?: string; title?: string; onClose: () => void; onDone: () => void;
}) {
  const [brief, setBrief] = useState(initial);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setState("busy");
    setError(null);
    api<{ id: string; report: Report }>(session, "/api/generate", { brief }).then(
      (r) => (setReport(r.report), setState("done")),
      (e: Error) => (setError(e.message), setState("idle")),
    );
  };
  return (
    <Sheet t={t} title={title} onClose={state === "done" ? onDone : onClose}>
      <Text style={{ color: t.quiet }}>Beschreibe Verletzung oder Erkrankung, Verlauf, Lernziel und Zielgruppe. Die KI erstellt einen Entwurf, den du vor der Freigabe prüfst.</Text>
      <TextInput value={brief} onChangeText={setBrief} multiline accessibilityLabel="Fallidee"
        style={{ minHeight: 120, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, color: t.text, fontSize: 16, textAlignVertical: "top" }} />
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      {report && <ReportView t={t} report={report} />}
      {state !== "done" && <Button t={t} strong label={state === "busy" ? "KI arbeitet … (bis zu einer Minute)" : "Entwurf erstellen"} disabled={state === "busy" || brief.trim().length < 10} onPress={run} />}
      {state === "done" && <Button t={t} strong label="Zur Bibliothek" onPress={onDone} />}
    </Sheet>
  );
}

const ideaBrief = (i: Idea) =>
  [`${i.title} (${i.category}, Soll-SK ${i.sk}, ${DIFF[i.difficulty] ?? i.difficulty}).`, `Bild: ${i.picture}`, `Verlauf unbehandelt: ${i.course}`,
    `Kritische Maßnahmen: ${i.critical.join("; ")}.`, i.harmful.length ? `Schädlich: ${i.harmful.join("; ")}.` : "", `Lernziel: ${i.trap}`, `Temperament: ${i.temperament}.`].filter(Boolean).join("\n");

function IdeaList({ t, session, ideas, onGenerated }: { t: Theme; session: Session; ideas: Ideas | null; onGenerated: () => void }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sk, setSk] = useState<Sk | null>(null);
  const [open, setOpen] = useState<Idea | null>(null);
  const [generating, setGenerating] = useState<Idea | null>(null);
  const all = ideas?.cases ?? [];
  const shown = all.filter((i) => (!cat || i.category === cat) && (!sk || i.sk === sk) && matches(q, [i.id, i.title, i.category, ...i.tags]));
  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
        <Title t={t}>Fallideen</Title>
        <Text style={{ color: t.quiet }}>{shown.length} von {all.length} Ideen. Ideen sind noch nicht spielbar: Mit KI ausarbeiten, prüfen, freigeben.</Text>
        <Filters t={t} q={q} setQ={setQ} cats={[...new Set(all.map((i) => i.category))].sort()} cat={cat} setCat={setCat} sk={sk} setSk={setSk} />
        {groupBy(shown, (i) => i.category).map(([category, items]) => (
          <View key={category}>
            <Group label={category} count={items.length} />
            {items.map((i) => (
              <Row key={i.id} t={t} color={skColor(t, i.sk)} title={`${i.id} ${i.title}`} onPress={() => setOpen(i)}
                lines={[{ text: `SK ${i.sk} · ${DIFF[i.difficulty] ?? i.difficulty} · ${i.tags.join(", ")}` }]} />
            ))}
          </View>
        ))}
      </ScrollView>
      {open && !generating && (
        <Sheet t={t} title={`${open.id} ${open.title}`} onClose={() => setOpen(null)}>
          <Text style={{ color: t.quiet }}>{open.category} · Soll-SK {open.sk} · {DIFF[open.difficulty] ?? open.difficulty} · Temperament: {open.temperament}</Text>
          <Text style={{ color: t.text }}>{open.picture}</Text>
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Verlauf unbehandelt: </Text>{open.course}</Text>
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Kritisch: </Text>{open.critical.join("; ")}</Text>
          {open.harmful.length > 0 && <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Schädlich: </Text>{open.harmful.join("; ")}</Text>}
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Stolperstein: </Text>{open.trap}</Text>
          {open.newActions.length > 0 && <Text style={{ color: t.quiet }}>Fehlende Maßnahmen im Katalog: {open.newActions.join(", ")}</Text>}
          <Button t={t} strong label="Mit KI ausarbeiten" disabled={!ideas?.generator} note={ideas?.generator ? undefined : "KI-Fallgenerator ist nicht eingerichtet"} onPress={() => setGenerating(open)} />
        </Sheet>
      )}
      {generating && <GenerateSheet t={t} session={session} title={`${generating.id} ausarbeiten`} brief={ideaBrief(generating)} onClose={() => setGenerating(null)} onDone={() => (setGenerating(null), setOpen(null), onGenerated())} />}
    </>
  );
}

function ScenarioList({ t, session, ideas, lib }: { t: Theme; session: Session; ideas: Ideas | null; lib: ReturnType<typeof useLibrary> }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [open, setOpen] = useState<ScenarioIdea | null>(null);
  const [play, setPlay] = useState<string | null>(null); // spielbares Szenario (id), damit der Fortschritt live bleibt
  const [gen, setGen] = useState<null | { title: string; brief: string; count?: number; scenario?: string }>(null);
  const [edit, setEdit] = useState<LibScenario | "neu" | null>(null);
  const [importing, setImporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const cases = lib.lib?.patients ?? [];
  const playable = lib.lib?.scenarios ?? [];
  const playing = playable.find((s) => s.id === play);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const all = ideas?.scenarios ?? [];
  const shown = all.filter((s) => (!cat || s.category === cat) && matches(q, [s.id, s.title, s.category, s.situation, ...s.special]));
  const caseTitle = (id: string) => ideas?.cases.find((i) => i.id === id)?.title ?? cases.find((c) => c.id === id)?.title ?? id;
  const mix = (m: Record<string, number>) => SKS.filter((k) => m[k]).map((k) => `${k} ${m[k]}`).join(" · ");
  return (
    <>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, gap: 10, paddingBottom: 20 }}>
        <Title t={t}>Szenarien</Title>
        <Button t={t} label="Neues Szenario (Formular)" onPress={() => setEdit("neu")} />
        <Button t={t} label="Szenario aus Datei importieren" onPress={() => setImporting(true)} />
        <Button t={t} label="Neues Szenario mit KI" disabled={!ideas?.generator} note={ideas?.generator ? undefined : "KI-Fallgenerator ist auf dem Server nicht eingerichtet"}
          onPress={() => setGen({ title: "Neues Szenario mit KI", brief: "", count: 6 })} />
        <Text style={{ color: t.text, fontWeight: "900", fontSize: 20, marginTop: 12 }}>Spielbar · {playable.length}</Text>
        {playable.map((s) => (
          <Row key={s.id} t={t} color={s.origin === "ki" ? t.gold : t.line} title={s.title} onPress={() => setPlay(s.id)}
            lines={[{ text: `${s.patients.length} Patienten · ${ORIGIN[s.origin]}` }, ...(s.job ? [jobLine(t, s.job)] : [])]} />
        ))}
        <Text style={{ color: t.text, fontWeight: "900", fontSize: 20, marginTop: 12 }}>Ideen · {shown.length} von {all.length}</Text>
        <Field t={t} label="Suche (Titel, Lage, Besonderheit)" value={q} onChange={setQ} />
        <ChipRow>
          <Chip t={t} label="Alle Kategorien" selected={!cat} onPress={() => setCat(null)} />
          {[...new Set(all.map((s) => s.category))].sort().map((c) => <Chip key={c} t={t} label={c} selected={cat === c} onPress={() => setCat(cat === c ? null : c)} />)}
        </ChipRow>
        {groupBy(shown, (s) => s.category).map(([category, items]) => (
          <View key={category}>
            <Group label={category} count={items.length} />
            {items.map((s) => (
              <Row key={s.id} t={t} color={t.line} title={`${s.id} ${s.title}`} onPress={() => setOpen(s)}
                lines={[{ text: `${s.patients} Patienten · ${mix(s.mix)} · ${DIFF[s.difficulty] ?? s.difficulty}` }]} />
            ))}
          </View>
        ))}
      </ScrollView>
      {open && (
        <Sheet t={t} title={`${open.id} ${open.title}`} onClose={() => setOpen(null)}>
          <Text style={{ color: t.text }}>{open.situation}</Text>
          <Text style={{ color: t.quiet }}>{open.patients} Patienten · {mix(open.mix)} · {DIFF[open.difficulty] ?? open.difficulty}</Text>
          {open.special.length > 0 && <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Besonderheiten: </Text>{open.special.join(", ")}</Text>}
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Einsatzmittel: </Text>{open.units}</Text>
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "600" }}>Lernziel: </Text>{open.learning}</Text>
          <Text style={{ color: t.text, fontWeight: "600" }}>Passende Fälle</Text>
          {open.caseIds.map((id) => <Text key={id} style={{ color: t.quiet }}>• {id} {caseTitle(id)}</Text>)}
          <Button t={t} strong label="Als Szenario mit KI erstellen" disabled={!ideas?.generator} note={ideas?.generator ? undefined : "KI-Fallgenerator ist nicht eingerichtet"}
            onPress={() => (setGen({ title: `${open.id} ausarbeiten`, brief: scenarioBrief(open, caseTitle), count: Math.min(open.patients, 12) }), setOpen(null))} />
        </Sheet>
      )}
      {edit && (
        <ScenarioEditor t={t} session={session} initial={edit === "neu" ? undefined : edit} cases={cases} onClose={() => setEdit(null)}
          onSaved={(id) => (setEdit(null), setPlay(id), lib.load())} />
      )}
      {playing && !gen && !edit && (
        <Sheet t={t} title={playing.title} onClose={() => setPlay(null)}>
          {playing.situation && <Text style={{ color: t.text }}>{playing.situation}</Text>}
          {playing.job && <Text style={{ color: jobLine(t, playing.job).color ?? t.quiet }}>{jobLine(t, playing.job).text}</Text>}
          <Text style={{ color: t.quiet }}>Neue KI-Patienten prüfst und gibst du unter „Fälle“ frei; erst dann sind sie in Übungen wählbar.</Text>
          {playing.patients.map((id) => {
            const p = byId.get(id);
            return (
              <Row key={id} t={t} color={p?.sk ? skColor(t, p.sk) : t.line} title={`${id.toUpperCase()} ${p?.title ?? ""}`} onPress={() => {}}
                lines={[{ text: `SK ${p?.sk ?? "–"} · ${p?.approved ? "✓ von dir freigegeben" : p?.origin === "ki" ? "KI-Entwurf · noch nicht geprüft" : "noch nicht geprüft"}`, color: p?.approved ? t.green : undefined }]} />
            );
          })}
          <Button t={t} label={playing.editable ? "Bearbeiten" : "Als Kopie bearbeiten"} onPress={() => setEdit(playing)} />
          <Button t={t} label="Als Datei exportieren" note="zum Austausch mit anderen Organisationen"
            onPress={() => download(session, `/api/scenarios/${playing.id}/export`, `dps-szenario-${playing.id}.json`).then(() => setExportError(null), (e: Error) => setExportError(e.message))} />
          {exportError && <Text style={{ color: t.red }}>{exportError}</Text>}
          <Button t={t} strong label="Patient dazugenerieren" disabled={!ideas?.generator} note={ideas?.generator ? undefined : "KI-Fallgenerator ist nicht eingerichtet"}
            onPress={() => setGen({ title: `Patient für „${playing.title}“`, brief: "", scenario: playing.id })} />
        </Sheet>
      )}
      {importing && <ImportSheet t={t} session={session} onClose={() => setImporting(false)} onDone={(id) => (setImporting(false), setPlay(id), lib.load())} />}
      {gen && <ScenarioGenSheet t={t} session={session} {...gen} onClose={() => setGen(null)} onDone={(id) => (setGen(null), setPlay(id), lib.load())} />}
    </>
  );
}

const jobLine = (t: Theme, j: NonNullable<LibScenario["job"]>) =>
  j.done < j.total
    ? { text: `KI erzeugt Patienten … ${j.done} von ${j.total}${j.failed ? ` · ${j.failed} fehlgeschlagen` : ""}`, color: t.gold }
    : j.failed
      ? { text: `${j.failed} von ${j.total} Patienten fehlgeschlagen${j.error ? `: ${j.error}` : " (Prüfung nicht bestanden, siehe Fälle)"}`, color: t.red }
      : { text: `${j.total} neue Patienten erzeugt` };

const scenarioBrief = (s: ScenarioIdea, caseTitle: (id: string) => string) =>
  [`${s.title} (${s.category}, ${DIFF[s.difficulty] ?? s.difficulty}).`, `Lage: ${s.situation}`, `Einsatzmittel: ${s.units}`,
    s.special.length ? `Besonderheiten: ${s.special.join(", ")}.` : "", `Lernziel: ${s.learning}`,
    `Sichtungsmix im Original (${s.patients} Patienten): ${SKS.filter((k) => s.mix[k]).map((k) => `${k} ${s.mix[k]}`).join(", ")}.`,
    `Passende Patienten: ${s.caseIds.map(caseTitle).join("; ")}.`].filter(Boolean).join("\n");

// Ganzes Szenario (mit Anzahl) oder ein Patient für ein bestehendes Szenario; die Patienten entstehen im Hintergrund.
function ScenarioGenSheet({ t, session, title, brief: initial, count: initialCount, scenario, onClose, onDone }: {
  t: Theme; session: Session; title: string; brief: string; count?: number; scenario?: string; onClose: () => void; onDone: (id: string) => void;
}) {
  const [brief, setBrief] = useState(initial);
  const [count, setCount] = useState(initialCount ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    setBusy(true);
    setError(null);
    (scenario
      ? api(session, `/api/scenarios/${scenario}/patients`, { brief }).then(() => scenario)
      : api<{ id: string }>(session, "/api/scenarios", { brief, patients: count }).then((r) => r.id)
    ).then(onDone, (e: Error) => (setError(e.message), setBusy(false)));
  };
  return (
    <Sheet t={t} title={title} onClose={onClose}>
      <Text style={{ color: t.quiet }}>
        {scenario
          ? "Beschreibe den Patienten: was Helfer sehen, Verletzung oder Erkrankung, Verlauf, Soll-Sichtungskategorie. Die KI erstellt ihn passend zur Lage."
          : "Beschreibe Lage, Ort, Einsatzmittel und Lernziel. Die KI entwirft das Szenario und erzeugt danach die Patienten einzeln (lokal etwa eine Minute je Patient)."}
      </Text>
      <TextInput value={brief} onChangeText={setBrief} multiline accessibilityLabel={scenario ? "Patient" : "Szenario-Idee"}
        style={{ minHeight: 120, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, color: t.text, fontSize: 16, textAlignVertical: "top" }} />
      {!scenario && (
        <>
          <Text style={{ color: t.quiet }}>Patienten</Text>
          <ChipRow>{[4, 6, 8, 10, 12, 15].map((n) => <Chip key={n} t={t} label={String(n)} selected={count === n} onPress={() => setCount(n)} />)}</ChipRow>
        </>
      )}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label={busy ? "KI arbeitet …" : scenario ? "Patient erzeugen" : "Szenario erzeugen"} disabled={busy || brief.trim().length < 10} onPress={run} />
    </Sheet>
  );
}

const ORIGIN: Record<LibScenario["origin"], string> = { muster: "Muster", ki: "KI-Szenario", eigen: "eigenes Szenario", import: "importiert" };

// A6: Szenario-Datei einlesen. Im Web per Dateiauswahl, auf dem Handy den Inhalt einfügen.
// Jeder Fall wird geprüft und bekommt eine eigene ID; spielbar erst nach deiner Freigabe unter „Fälle“.
function ImportSheet({ t, session, onClose, onDone }: { t: Theme; session: Session; onClose: () => void; onDone: (id: string) => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; imported: number; failed: { title: string; errors: string[] }[] } | null>(null);
  const pick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => void input.files?.[0]?.text().then((text) => (setFile({ name: input.files![0].name, text }), setError(null)));
    input.click();
  };
  const run = () => {
    let bundle: unknown;
    try { bundle = JSON.parse(file?.text ?? pasted); } catch { return setError("Das ist keine gültige Szenario-Datei (JSON)."); }
    api<NonNullable<typeof result>>(session, "/api/scenarios/import", bundle).then(setResult, (e: Error) => setError(e.message));
  };
  if (result)
    return (
      <Sheet t={t} title="Import fertig" onClose={() => onDone(result.id)}>
        <Text style={{ color: t.text }}>{result.imported} {result.imported === 1 ? "Fall" : "Fälle"} übernommen. Prüfe und gib sie unter „Fälle“ frei, dann sind sie in Übungen wählbar.</Text>
        {result.failed.map((f, i) => <Text key={i} style={{ color: t.red }}>Nicht übernommen: {f.title} – {f.errors.join("; ")}</Text>)}
        <Button t={t} strong label="Zum Szenario" onPress={() => onDone(result.id)} />
      </Sheet>
    );
  return (
    <Sheet t={t} title="Szenario importieren" onClose={onClose}>
      <Text style={{ color: t.quiet }}>Eine Datei, die mit „Als Datei exportieren“ entstanden ist (auch aus einer anderen Organisation).</Text>
      {Platform.OS === "web" && <Button t={t} label={file ? `Datei: ${file.name} (${Math.round(file.text.length / 1024)} KB)` : "Datei wählen"} onPress={pick} />}
      {!file && (
        <TextInput value={pasted} onChangeText={setPasted} multiline placeholder="… oder Inhalt der Datei hier einfügen" placeholderTextColor={t.quiet} accessibilityLabel="Inhalt der Szenario-Datei"
          style={{ minHeight: 120, maxHeight: 240, borderWidth: 2, borderColor: t.edge, backgroundColor: t.card, borderRadius: 12, padding: 12, color: t.text, fontFamily: Platform.OS === "web" ? "monospace" : undefined }} />
      )}
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label="Importieren" disabled={!file && !pasted.trim()} onPress={run} />
    </Sheet>
  );
}
