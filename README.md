# dPS-App

Digitale dynamische Patientensimulation für MANV-Übungen im Rettungsdienst: Helfer scannen QR-Patienten mit dem eigenen Handy, Patienten verändern sich je nach Behandlung, Praxisanleiter sehen die Lage live und bekommen eine Auswertung.

Stand: Meilenstein 2 – Helfer-App (iOS, Android, Web) und Übungsserver; eine Übung ist spielbar.

## Aufbau

```text
apps/app/          Helfer-App (Expo): Verbinden, Beitreten, QR-Scan, Befunde, Maßnahmen, Sichtung, Offline-Puffer
apps/server/       Übungsserver (WebSocket): prüft Aktionen, speichert sie als Protokoll (data/<CODE>.jsonl)
packages/schema/   Szenarioformat und Protokoll App <-> Server (zod)
packages/engine/   Simulations-Engine: initial, validate, apply, tick, visible, targetSk, triage
library/           Musterverläufe P01–P10, Maßnahmenkatalog, Szenario "Busunfall" (CC BY 4.0)
```

Die Engine ist deterministisch: `events.reduce(apply, initial(scenario, defs, settings, seed))` ergibt immer denselben Zustand.
Der Server speichert nur angenommene Helfer-Aktionen und berechnet den Zustand daraus neu (`stateAt`). So landen offline gepufferte Aktionen an ihrer echten Zeit.

## Entwickeln

Node 24 oder neuer (führt TypeScript direkt aus).

```bash
npm install
npm test
npm run typecheck
```

Übung starten (Code DEMO, nur P01 und P04) und App im Browser öffnen:

```bash
npm run server -- --code DEMO --patients p01,p04
npm run web -w @dps/app
```

Auf dem Handy: Expo Go bzw. Development Build, als Server `ws://<IP des Rechners>:3000` eintragen.
QR-Codes enthalten `dps:p01` usw.; ohne Kamera lässt sich die Patientennummer eintippen.

## Lizenz

Code: [AGPL-3.0](LICENSE). Inhalte der Bibliothek: [CC BY 4.0](library/LICENSE.md).
