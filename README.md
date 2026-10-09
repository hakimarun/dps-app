# dPS-App

Digitale dynamische Patientensimulation für MANV-Übungen im Rettungsdienst: Helfer scannen QR-Patienten mit dem eigenen Handy, Patienten verändern sich je nach Behandlung, Praxisanleiter sehen die Lage live und bekommen eine Auswertung.

Stand: Meilenstein 1 – Szenarioformat und Engine, noch ohne Oberfläche.

## Aufbau

```text
packages/schema/   Szenarioformat (zod): Patient, Phase, Regel, Maßnahme, Szenario
packages/engine/   Simulations-Engine: initial, validate, apply, tick, visible, targetSk, triage
library/           Musterverläufe P01–P10, Maßnahmenkatalog, Szenario "Busunfall" (CC BY 4.0)
```

Die Engine ist deterministisch: `events.reduce(apply, initial(scenario, defs, settings, seed))` ergibt immer denselben Zustand.
Der Server prüft jede Absicht mit `validate`, hängt sie an und ruft regelmäßig `tick(state, now)` für Phasenwechsel und Maßnahmenenden auf.

## Entwickeln

Node 24 oder neuer (führt TypeScript direkt aus).

```bash
npm install
npm test
npm run typecheck
```

## Lizenz

Code: [AGPL-3.0](LICENSE). Inhalte der Bibliothek: [CC BY 4.0](library/LICENSE.md).
