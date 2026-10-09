# dPS-App

Digitale dynamische Patientensimulation für MANV-Übungen im Rettungsdienst: Helfer scannen QR-Patienten mit dem eigenen Handy, Patienten verändern sich je nach Behandlung, Praxisanleiter sehen die Lage live und bekommen eine Auswertung.

Stand: Meilenstein 3 – Helfer-App und Praxisanleiter-Bereich (Bibliothek, Übung anlegen, QR-Zettel, Start/Pause, Live-Lage).

## Aufbau

```text
apps/app/          Helfer-App (Expo): Verbinden, Beitreten, QR-Scan, Befunde, Maßnahmen, Sichtung, Offline-Puffer
apps/server/       Übungsserver: REST für Praxisanleiter, WebSocket für Helfer und Live-Lage, SQLite (node:sqlite) in data/
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

Server und App im Browser starten:

```bash
npm run server
npm run web -w @dps/app
```

Als Praxisanleiter anmelden: Ohne `SMTP_URL` steht der Anmeldecode im Server-Log. Für echten Mailversand
`SMTP_URL` (z. B. `smtps://user:pass@host`) und `MAIL_FROM` setzen. Dann Fälle in der Bibliothek freigeben,
Übung anlegen, QR-Zettel drucken (`/print/<CODE>`) und starten.

Auf dem Handy: Expo Go oder Development Build, als Server `ws://<IP des Rechners>:3000` eintragen.
QR-Codes enthalten `dps:<CODE>:p01` und gelten nur für ihre Übung; ohne Kamera lässt sich die Patientennummer eintippen.

## Lizenz

Code: [AGPL-3.0](LICENSE). Inhalte der Bibliothek: [CC BY 4.0](library/LICENSE.md).
