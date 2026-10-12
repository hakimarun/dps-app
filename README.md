# dPS-App

Digitale dynamische Patientensimulation für MANV-Übungen im Rettungsdienst: Helfer scannen QR-Patienten mit dem eigenen Handy, Patienten verändern sich je nach Behandlung, Praxisanleiter sehen die Lage live und bekommen eine Auswertung.

Stand: Meilenstein 6 – dazu KI: Patienten im Chat befragen (Temperament, ganze Sätze, genervt bei Wiederholungen), KI-Fallgenerator mit automatischer Prüfung, übersichtliche Bibliothek mit 100 Fall- und 100 Szenario-Ideen.

## Aufbau

```text
apps/app/          Helfer-App (Expo): Verbinden, Beitreten, QR-Scan, Befunde, Maßnahmen, Sichtung, Offline-Puffer
apps/server/       Übungsserver: REST für Praxisanleiter, WebSocket für Helfer und Live-Lage, SQLite (node:sqlite) in data/
packages/schema/   Szenarioformat und Protokoll App <-> Server (zod)
packages/engine/   Simulations-Engine: initial, validate, apply, tick, visible, targetSk, triage
library/           Musterverläufe P01–P10, Maßnahmenkatalog, Szenario "Busunfall", ideas/ mit 100 Fall- und 100 Szenario-Ideen (CC BY 4.0)
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
Übung mit Trupps anlegen, Zettel drucken (`/print/<CODE>`: Übungscode, ein Code je Trupp, QR-Zettel je Patient) und starten.
Helfer treten mit dem Code ihres Trupps bei; Sichtungstrupps sichten nur und leisten lebensrettende Sofortmaßnahmen. Nach dem Ende zeigt die Lage die Auswertung;
„Berichte freigeben“ schickt jedem Helfer seinen Bericht. Punktewerte stehen in `apps/server/src/evaluation.ts`.

Auf dem Handy: Expo Go oder Development Build, als Server `ws://<IP des Rechners>:3000` eintragen.
QR-Codes enthalten `dps:<CODE>:p01` und gelten nur für ihre Übung; ohne Kamera lässt sich die Patientennummer eintippen.

## KI (optional)

Ohne KI funktioniert alles: Patienten antworten auf die SAMPLER-Vorschläge aus ihrem Profil. Mit KI sind freie Fragen und der Fallgenerator möglich.
Die KI formuliert nur; Befunde und Verlauf bestimmt immer die Engine, Diagnosen und Messwerte in Antworten werden abgefangen.

| Variable | Werte |
| --- | --- |
| `AI_DIALOG`, `AI_GENERATOR` | `claude`, `local` oder `off` (Standard: `claude` mit API-Key, sonst `local` mit `LOCAL_AI_URL`, sonst aus) |
| `ANTHROPIC_API_KEY` | API-Key aus der Anthropic Console (Dialog: Claude Haiku 5.5, Generator: Claude Opus 5.5) |
| `LOCAL_AI_URL`, `LOCAL_AI_MODEL` | OpenAI-kompatibler Server, z. B. Ollama: `http://localhost:11434` und `gemma3:4b` (Standard) |

Lokal mit Ollama:

```bash
brew install ollama && brew services start ollama
ollama pull gemma3:4b
ollama create dps-gemma3 -f apps/server/Modelfile
AI_DIALOG=local AI_GENERATOR=local LOCAL_AI_URL=http://localhost:11434 LOCAL_AI_MODEL=dps-gemma3 npm run server
```

`dps-gemma3` ist gemma3:4b mit 16k Kontext; der Fallgenerator braucht das (Ollama nimmt sonst 4096 Token). Ein Fall dauert lokal etwa 30–60 s.
Ist die KI nicht erreichbar, antworten Patienten auf die Vorschläge weiter aus ihrem Profil.

`gemma3:4b` antwortet auf einem Mac mit Apple M4 und 16 GB in 3–4 s und braucht 3,4 GB Arbeitsspeicher. Größere Modelle wie `llama3.1:8b` liefen dort
neben Browser und Entwicklungsserver wegen Speichermangels zu langsam, `llama3.2:3b` erfand Fakten. Kleine Modelle verdrehen gelegentlich
Profilfakten; für den Pilot lieber Claude nutzen oder die Antworten stichprobenartig prüfen.

Ganze Szenarien: In der Bibliothek unter „Szenarien“ entwirft die KI aus einer Idee Lage, Einsatzmittel und 1–15 Patienten; die Patienten
entstehen danach einzeln im Hintergrund (lokal etwa eine Minute je Patient). „Patient dazugenerieren“ ergänzt jedes Szenario, auch den Busunfall.
KI-Fälle landen als Entwurf in der Bibliothek und brauchen die Freigabe eines Praxisanleiters oder Arztes.

## Lizenz

Code: [AGPL-3.0](LICENSE). Inhalte der Bibliothek: [CC BY 4.0](library/LICENSE.md).
