// Formular-Editor (A1, A4): Fälle und Szenarien ohne JSON anlegen und bearbeiten.
// Der Server prüft jeden Stand live (dieselbe Prüfung wie bei KI-Fällen); gespeichert wird als eigener Entwurf,
// der wie jeder Fall erst nach Freigabe in Übungen wählbar ist.
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { Patient, Sk } from "@dps/schema";
import { api, type LibPatient, type LibScenario, type Session } from "./api";
import { Button, Chip, Field, Sheet, Title, skColor, type Theme } from "./ui";

import { BOOLS, CATEGORIES, DIFFS, EMPTY, EXAMS, NUMS, TOPICS, emptyPhase, fromPatient, toPatient, type Form, type Phase, type Rule, type Tri } from "./caseform";

type Report = { ok: boolean; errors: string[]; warnings: string[]; sk: Sk | null };
type ActionInfo = { id: string; title: string; group: string };

function Section({ t, title, children }: { t: Theme; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderColor: t.line, paddingTop: 12, marginTop: 4 }}>
      <Text style={{ color: t.text, fontWeight: "700", fontSize: 18 }}>{title}</Text>
      {children}
    </View>
  );
}

function Multi({ t, label, value, onChange }: { t: Theme; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.quiet }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} multiline accessibilityLabel={label}
        style={{ minHeight: 70, borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10, color: t.text, fontSize: 16, textAlignVertical: "top" }} />
    </View>
  );
}

const Row = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{children}</View>;

// Maßnahmen auswählen: Chips nach Gruppen in einem Overlay.
function ActionPicker({ t, actions, value, onChange, onClose, title }: {
  t: Theme; actions: ActionInfo[]; value: string[]; onChange: (v: string[]) => void; onClose: () => void; title: string;
}) {
  const groups = [...new Set(actions.map((a) => a.group))];
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <Sheet t={t} title={title} onClose={onClose}>
      {groups.map((g) => (
        <View key={g} style={{ gap: 6 }}>
          <Text style={{ color: t.quiet, fontWeight: "600" }}>{g}</Text>
          <Row>{actions.filter((a) => a.group === g).map((a) => <Chip key={a.id} t={t} label={a.title} selected={value.includes(a.id)} onPress={() => toggle(a.id)} />)}</Row>
        </View>
      ))}
    </Sheet>
  );
}

function Picks({ t, ids, actions, empty, onPress }: { t: Theme; ids: string[]; actions: ActionInfo[]; empty: string; onPress: () => void }) {
  const title = (id: string) => (id === "handover" ? "Übergabe zum Transport" : actions.find((a) => a.id === id)?.title ?? id);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 10 }}>
      <Text style={{ color: ids.length ? t.text : t.quiet }}>{ids.length ? ids.map(title).join(", ") : empty} ›</Text>
    </Pressable>
  );
}

export function CaseEditor({ t, session, initial, onClose, onSaved }: { t: Theme; session: Session; initial?: Patient; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(() => (initial ? fromPatient(initial) : structuredClone(EMPTY)));
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [picker, setPicker] = useState<null | { title: string; value: string[]; set: (v: string[]) => void; handover?: boolean }>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => void api<ActionInfo[]>(session, "/api/actions").then(setActions), [session.token]);
  // Live-Prüfung, kurz nach der letzten Eingabe
  useEffect(() => {
    const i = setTimeout(() => api<Report>(session, "/api/cases/check", { patient: toPatient(form) }).then(setReport, () => {}), 700);
    return () => clearTimeout(i);
  }, [form]);
  const up = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const upPhase = (i: number, patch: Partial<Phase>) => setForm((f) => ({ ...f, phases: f.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const ids = form.phases.map((p) => p.id);
  const pick = (title: string, value: string[], set: (v: string[]) => void, handover = false) => setPicker({ title, value, set, handover });
  const pickerActions = picker?.handover ? [...actions, { id: "handover", title: "Übergabe zum Transport", group: "Transport" }] : actions;
  const save = () => {
    setSaving(true);
    setError(null);
    api<{ id: string; report: Report }>(session, "/api/cases", { patient: toPatient(form) }).then(
      (r) => (setReport(r.report), onSaved()),
      (e: Error) => (setError(e.message), setSaving(false)),
    );
  };
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: t.bg, paddingTop: 48 }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 10, paddingBottom: 40 }}>
        <Title t={t}>{initial ? "Fall bearbeiten" : "Neuer Fall"}</Title>
        {initial && <Text style={{ color: t.quiet }}>Eigene Fälle bekommen beim Speichern eine neue Version, die neu freigegeben werden muss. Musterfälle und Fälle anderer werden als Kopie gespeichert.</Text>}
        <ReportLine t={t} report={report} />

        <Section t={t} title="Grunddaten">
          <Field t={t} label="Titel (Diagnose, nur für die Leitung sichtbar)" value={form.title} onChange={(title) => up({ title })} />
          <Multi t={t} label="Sichtbares Bild (was Helfer sehen, ohne Diagnose)" value={form.picture} onChange={(picture) => up({ picture })} />
          <Text style={{ color: t.quiet }}>Kategorie</Text>
          <Row>{CATEGORIES.map((c) => <Chip key={c} t={t} label={c} selected={form.category === c} onPress={() => up({ category: c })} />)}</Row>
          <Text style={{ color: t.quiet }}>Schwierigkeit</Text>
          <Row>{DIFFS.map(([id, l]) => <Chip key={id} t={t} label={l} selected={form.difficulty === id} onPress={() => up({ difficulty: id })} />)}</Row>
          <Field t={t} label="Schlagworte, durch Komma getrennt" value={form.tags} onChange={(tags) => up({ tags })} />
        </Section>

        <Section t={t} title="Gesprächsprofil">
          <Field t={t} label="Temperament, z. B. ängstlich, aggressiv, verharmlosend" value={form.temperament} onChange={(temperament) => up({ temperament })} />
          <Field t={t} label="Verhalten / Stolperstein" value={form.pitfall} onChange={(pitfall) => up({ pitfall })} />
          <Text style={{ color: t.quiet }}>Antworten in ganzen Sätzen, Ich-Form. Leer: Standardantwort.</Text>
          {TOPICS.map(([k, l]) => <Field key={k} t={t} label={l} value={form.anamnesis[k] ?? ""} onChange={(v) => up({ anamnesis: { ...form.anamnesis, [k]: v } })} />)}
        </Section>

        <Section t={t} title="Ausgangsbefund">
          <Row>{BOOLS.map(([k, l]) => <Chip key={k} t={t} label={`${l}: ${form.bools[k] ? "ja" : "nein"}`} selected={form.bools[k]} onPress={() => up({ bools: { ...form.bools, [k]: !form.bools[k] } })} />)}</Row>
          <Row>
            {NUMS.map(([k, l]) => (
              <View key={k} style={{ width: "47%" }}>
                <Field t={t} label={l} value={form.nums[k] ?? ""} onChange={(v) => up({ nums: { ...form.nums, [k]: v } })} />
              </View>
            ))}
          </Row>
          <Text style={{ color: t.quiet }}>Erweiterte Befunde (werden erst durch die passende Maßnahme sichtbar)</Text>
          {EXAMS.map(([k, l]) => <Field key={k} t={t} label={l} value={form.exam[k] ?? ""} onChange={(v) => up({ exam: { ...form.exam, [k]: v } })} />)}
        </Section>

        <Section t={t} title="Verlauf in Phasen">
          <Text style={{ color: t.quiet }}>Die erste Phase ist die Startphase. In jeder Phase nur eintragen, was sich gegenüber dem Ausgangsbefund ändert. Regeln greifen am Phasenende; die erste passende gewinnt.</Text>
          {form.phases.map((ph, i) => (
            <View key={i} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, gap: 8 }}>
              <Row>
                <View style={{ width: "47%" }}><Field t={t} label="Name der Phase" value={ph.id} onChange={(v) => renamePhase(setForm, i, v)} /></View>
                <View style={{ width: "47%" }}><Field t={t} label="Dauer min (leer = Übungsvorgabe)" value={ph.minutes} onChange={(minutes) => upPhase(i, { minutes })} /></View>
              </Row>
              <Chip t={t} label={ph.dead ? "Patient ist in dieser Phase verstorben" : "Patient lebt"} selected={ph.dead}
                onPress={() => upPhase(i, ph.dead ? { dead: false } : {
                  // tot: passende Befunde vorausfüllen, eigene Eingaben bleiben
                  dead: true, nums: { rr: "0", hr: "0", bp: "0", gcs: "3", ...ph.nums },
                  bools: { breathing: "nein", radialPulse: "nein", followsCommands: "nein", walking: "nein", ...ph.bools },
                })} />
              <Text style={{ color: t.quiet }}>Änderungen gegenüber dem Ausgangsbefund</Text>
              <Row>
                {BOOLS.map(([k, l]) => {
                  const v = ph.bools[k] ?? "";
                  const next: Tri = v === "" ? "ja" : v === "ja" ? "nein" : "";
                  return <Chip key={k} t={t} label={`${l}: ${v || "unverändert"}`} selected={v !== ""} onPress={() => upPhase(i, { bools: { ...ph.bools, [k]: next } })} />;
                })}
              </Row>
              <Row>
                {NUMS.map(([k, l]) => (
                  <View key={k} style={{ width: "47%" }}>
                    <Field t={t} label={`${l}${form.nums[k] ? ` (Start ${form.nums[k]})` : ""}`} value={ph.nums[k] ?? ""} onChange={(v) => upPhase(i, { nums: { ...ph.nums, [k]: v } })} />
                  </View>
                ))}
              </Row>
              {EXAMS.filter(([k]) => k === "ecg" || k === "glucose" || ph.exam[k] || form.exam[k]).map(([k, l]) => (
                <Field key={k} t={t} label={l} value={ph.exam[k] ?? ""} onChange={(v) => upPhase(i, { exam: { ...ph.exam, [k]: v } })} />
              ))}
              <Text style={{ color: t.quiet }}>Regeln am Phasenende</Text>
              {ph.rules.map((r, j) => {
                const setRule = (patch: Partial<Rule>) => upPhase(i, { rules: ph.rules.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
                return (
                  <View key={j} style={{ gap: 6, backgroundColor: t.tint, borderRadius: 10, padding: 10 }}>
                    <Text style={{ color: t.text }}>Wenn erledigt:</Text>
                    <Picks t={t} ids={r.when} actions={actions} empty="keine Bedingung" onPress={() => pick("Wenn erledigt", r.when, (when) => setRule({ when }))} />
                    <Text style={{ color: t.text }}>und solange läuft:</Text>
                    <Picks t={t} ids={r.active} actions={actions} empty="keine Bedingung" onPress={() => pick("Solange läuft", r.active, (active) => setRule({ active }))} />
                    <Text style={{ color: t.text }}>dann weiter mit Phase:</Text>
                    <Row>{ids.map((id) => <Chip key={id} t={t} label={id} selected={r.then === id} onPress={() => setRule({ then: id })} />)}</Row>
                    <Button t={t} label="Regel entfernen" onPress={() => upPhase(i, { rules: ph.rules.filter((_, k) => k !== j) })} />
                  </View>
                );
              })}
              <Button t={t} label="Regel hinzufügen" onPress={() => upPhase(i, { rules: [...ph.rules, { when: [], active: [], then: "" }] })} />
              <Text style={{ color: t.quiet }}>Sonst nach Phasenende:</Text>
              <Row>
                <Chip t={t} label="bleibt (Endzustand)" selected={!ph.else} onPress={() => upPhase(i, { else: "" })} />
                {ids.filter((id) => id !== ph.id).map((id) => <Chip key={id} t={t} label={`→ ${id}`} selected={ph.else === id} onPress={() => upPhase(i, { else: id })} />)}
              </Row>
              {form.phases.length > 1 && <Button t={t} label="Phase entfernen" onPress={() => up({ phases: form.phases.filter((_, k) => k !== i) })} />}
            </View>
          ))}
          <Button t={t} label="Phase hinzufügen" onPress={() => up({ phases: [...form.phases, emptyPhase(nextId(ids))] })} />
        </Section>

        <Section t={t} title="Auswertung">
          <Text style={{ color: t.quiet }}>Kritische Maßnahmen: eine der gewählten bis zur angegebenen Minute (bei 15-min-Phasen).</Text>
          {form.critical.map((c, j) => (
            <View key={j} style={{ gap: 6, backgroundColor: t.tint, borderRadius: 10, padding: 10 }}>
              <Picks t={t} ids={c.actions} actions={actions} empty="Maßnahme wählen"
                onPress={() => pick("Kritische Maßnahme", c.actions, (a) => up({ critical: form.critical.map((x, k) => (k === j ? { ...x, actions: a } : x)) }), true)} />
              <Field t={t} label="bis Minute" value={c.within} onChange={(within) => up({ critical: form.critical.map((x, k) => (k === j ? { ...x, within } : x)) })} />
              <Button t={t} label="Entfernen" onPress={() => up({ critical: form.critical.filter((_, k) => k !== j) })} />
            </View>
          ))}
          <Button t={t} label="Kritische Maßnahme hinzufügen" onPress={() => up({ critical: [...form.critical, { actions: [], within: "15" }] })} />
          <Text style={{ color: t.quiet }}>Schädliche Maßnahmen</Text>
          <Picks t={t} ids={form.harmful} actions={actions} empty="keine" onPress={() => pick("Schädliche Maßnahmen", form.harmful, (harmful) => up({ harmful }))} />
        </Section>

        <ReportLine t={t} report={report} full />
        {error && <Text style={{ color: t.red }}>{error}</Text>}
        <Button t={t} strong label={saving ? "Speichere …" : "Als Entwurf speichern"} disabled={saving || !form.title.trim() || !form.picture.trim()} onPress={save} />
        <Button t={t} label="Abbrechen" onPress={onClose} />
      </ScrollView>
      {picker && (
        <ActionPicker t={t} title={picker.title} actions={pickerActions} value={picker.value}
          onChange={(v) => (picker.set(v), setPicker({ ...picker, value: v }))} onClose={() => setPicker(null)} />
      )}
    </View>
  );
}

const nextId = (ids: string[]) => String(Math.max(0, ...ids.map((x) => Number(x) || 0)) + 1);

// Umbenennen einer Phase zieht alle Verweise darauf mit.
function renamePhase(setForm: (fn: (f: Form) => Form) => void, i: number, name: string) {
  setForm((f) => {
    const old = f.phases[i].id;
    const ren = (x: string) => (x === old ? name : x);
    return { ...f, phases: f.phases.map((p, j) => ({ ...p, id: j === i ? name : p.id, else: ren(p.else), rules: p.rules.map((r) => ({ ...r, then: ren(r.then) })) })) };
  });
}

function ReportLine({ t, report, full }: { t: Theme; report: Report | null; full?: boolean }) {
  if (!report) return <Text style={{ color: t.quiet }}>Prüfe …</Text>;
  return (
    <View style={{ gap: 4, borderWidth: 1, borderColor: report.ok ? t.line : t.red, borderRadius: 10, padding: 10 }}>
      <Text style={{ color: report.ok ? t.text : t.red, fontWeight: "600" }}>
        {report.ok ? "✓ Fall ist gültig" : `${report.errors.length} Fehler`} · {report.warnings.length} Hinweise
        {report.sk ? <Text style={{ color: skColor(t, report.sk) }}> · Soll-SK zu Beginn: {report.sk}</Text> : null}
      </Text>
      {(full ? [...report.errors, ...report.warnings] : report.errors.slice(0, 3)).map((x, i) => (
        <Text key={i} style={{ color: report.errors.includes(x) ? t.red : t.quiet }}>• {x}</Text>
      ))}
    </View>
  );
}

// Szenario-Editor (A4): Lage, Fahrzeuge mit Eintreffzeit, Patienten aus der Bibliothek.
export function ScenarioEditor({ t, session, initial, cases, onClose, onSaved }: {
  t: Theme; session: Session; initial?: LibScenario; cases: LibPatient[]; onClose: () => void; onSaved: (id: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [situation, setSituation] = useState(initial?.situation ?? "");
  const [units, setUnits] = useState(initial?.units.map((u) => ({ kind: u.kind, arrivesAt: String(u.arrivesAt) })) ?? [{ kind: "RTW", arrivesAt: "0" }, { kind: "NEF", arrivesAt: "10" }]);
  const [patients, setPatients] = useState<string[]>(initial?.patients ?? []);
  const [error, setError] = useState<string | null>(null);
  const playable = cases.filter((c) => c.errors.length === 0);
  const save = () => {
    setError(null);
    api<{ id: string }>(session, "/api/scenarios/save", {
      id: initial?.editable ? initial.id : undefined, title, situation, patients,
      units: units.map((u) => ({ kind: u.kind, arrivesAt: Number(u.arrivesAt) || 0 })),
    }).then((r) => onSaved(r.id), (e: Error) => setError(e.message));
  };
  return (
    <Sheet t={t} title={initial ? (initial.editable ? "Szenario bearbeiten" : "Szenario als Kopie bearbeiten") : "Neues Szenario"} onClose={onClose}>
      <Field t={t} label="Titel" value={title} onChange={setTitle} />
      <Multi t={t} label="Lagemeldung" value={situation} onChange={setSituation} />
      <Text style={{ color: t.text, fontWeight: "700" }}>Fahrzeuge</Text>
      <Text style={{ color: t.quiet }}>Beladung und Plätze wie im Musterszenario; das erste Fahrzeug ist bei Minute 0 vor Ort.</Text>
      {units.map((u, i) => (
        <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <Row>{["RTW", "NEF", "KTW"].map((k) => <Chip key={k} t={t} label={k} selected={u.kind === k} onPress={() => setUnits(units.map((x, j) => (j === i ? { ...x, kind: k } : x)))} />)}</Row>
          <View style={{ width: 110 }}><Field t={t} label="ab Minute" value={u.arrivesAt} onChange={(v) => setUnits(units.map((x, j) => (j === i ? { ...x, arrivesAt: v } : x)))} /></View>
          <Button t={t} label="×" onPress={() => setUnits(units.filter((_, j) => j !== i))} />
        </View>
      ))}
      <Button t={t} label="Fahrzeug hinzufügen" onPress={() => setUnits([...units, { kind: "RTW", arrivesAt: "15" }])} />
      <Text style={{ color: t.text, fontWeight: "700" }}>Patienten · {patients.length} gewählt</Text>
      <Row>
        {playable.map((c) => (
          <Chip key={c.id} t={t} label={`${c.id.toUpperCase()} ${c.title}${c.sk ? ` (${c.sk})` : ""}`} selected={patients.includes(c.id)}
            onPress={() => setPatients(patients.includes(c.id) ? patients.filter((x) => x !== c.id) : [...patients, c.id])} />
        ))}
      </Row>
      {error && <Text style={{ color: t.red }}>{error}</Text>}
      <Button t={t} strong label="Szenario speichern" disabled={title.trim().length < 3 || !units.length || !patients.length} onPress={save} />
    </Sheet>
  );
}
