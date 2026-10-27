# Conversational Job Search

Du schreibst einen Satz. Links antwortet das Sprachmodell mit dem, was es verstanden hat. Rechts liegen echte Stellen aus der Jobsuche der Bundesagentur für Arbeit.

Das Modell sucht keine Jobs. Es füllt ein Formular. Der Server fragt damit die Stellendatenbank und prüft den Anzeigentext.

## In einer Minute

Die App hat zwei getrennte Aufgaben. Ein Sprachmodell versteht den Satz, weil eine Suche Ort, Gehalt, Skills, Homeoffice und Ausschlüsse mischt. Es erfindet keine Stellen. Der Server nimmt das Formular und ruft die Jobsuche auf, die auf [jobsuche.api.bund.dev](https://jobsuche.api.bund.dev/) dokumentiert ist. Die Trefferliste enthält oft kein Gehalt und nicht den vollen Text. Deshalb liest der Server die ersten 20 Detailanzeigen und prüft Skills, Homeoffice, Gehalt und Ausschlüsse im Text. Eine weitere Jobbörse käme später als neue Datei in `server/sources/` dazu.

## Start

Node 20 oder neuer.

```bash
npm install
cp .env.example .env
```

In `.env` den NVIDIA-Key eintragen. Die Datei bleibt lokal, Git ignoriert sie. Wenn der Key irgendwo im Klartext stand, unter [build.nvidia.com/settings](https://build.nvidia.com/settings) widerrufen.

```bash
npm start
```

Dann [http://localhost:3000](http://localhost:3000) öffnen. Ist der Port belegt, in `.env` zum Beispiel `PORT=3010` setzen und diese Adresse öffnen.

Für den Ausfallweg einmal `ollama pull llama3.2`. Ohne Ollama läuft die App mit Nemotron. Fallen beide aus, bleibt der bisherige Chat stehen und es erscheint ein Fehlersatz.

## Was bei einem Satz passiert

1. `public/app.js` schickt den ganzen Chat und das letzte Formular an `POST /api/chat`.
2. `server/llm.js` lässt `nvidia/nemotron-3.5-bolt-e4b` das Formular füllen. Bei Fehler versucht es einmal lokal `llama3.2`.
3. `server/sources/arbeitsagentur.js` ruft `GET /pc/v6/jobs` auf `rest.arbeitsagentur.de` auf. Zwei Städte werden zwei Aufrufe, zusammengeführt über die Referenznummer.
4. Dieselbe Datei holt für die ersten 20 Treffer `GET /pc/v4/jobdetails/{base64 der Referenznummer}`.
5. `server/search.js` behält nur Anzeigen, deren Text die Bedingungen belegt.
6. Die Seite zeigt den Satz links und die Kacheln rechts.

`arbeitszeit=ho` wird nicht benutzt. Ein Live-Aufruf damit kam mit 0 Treffern zurück, obwohl Stellen `homeofficemoeglich: true` hatten. Homeoffice prüft der Code am Feld und am Text.

## Welche Datei was darf

- `server/schema.js` beschreibt das Formular. Sie macht keinen Netzwerkaufruf.
- `server/llm.js` spricht mit NVIDIA und Ollama. Sie kennt keine Stellen.
- `server/sources/arbeitsagentur.js` ist die einzige Datei, die die Agentur aufruft.
- `server/sources/index.js` ist die Liste der Quellen. Heute steht dort nur die Arbeitsagentur.
- `server/search.js` prüft den Text und teilt in passende Jobs und Jobs ohne Gehaltszahl.
- `server/index.js` liefert die Seite aus und hat `POST /api/chat` und `GET /api/health`.
- `public/index.html`, `public/styles.css` und `public/app.js` sind die Oberfläche: Chat links, Kacheln rechts.

Eine neue Börse ist eine Datei mit `search(filters)`, die Karten in derselben Form liefert, plus eine Zeile in `server/sources/index.js`.

## Grenzen

Gehalt steht oft nur als Satz im Text, zum Beispiel „72.600 €“. Fehlt eine erkennbare Jahreszahl, landet die Anzeige unter „Gehalt steht nicht in der Anzeige“ und gilt nicht als Treffer für dein Minimum. Tarifangaben ohne Zahl fallen in dieselbe Gruppe.

„Kein Startup“ kann die Schnittstelle nicht als Firmenart filtern. Der Code entfernt nur Anzeigen, in denen das Wort selbst vorkommt. Der Chat sagt das.

Über den Kacheln steht, wie viele Treffer es gab und wie viele Anzeigen gelesen wurden. Mehr als 20 Details pro Suche werden nicht geholt.
