# Abrechnungsklar – automatische Prüfung einrichten

So funktioniert es:

1. Ein Kunde schickt das Formular mit seiner Rechnung ab.
2. Netlify startet die Funktion `submission-created`. Sie lädt die Dateien und gibt die Prüfung als Auftrag an Claude (Anthropic-API).
3. Alle 5 Minuten schaut die Funktion `berichte-abholen` nach fertigen Prüfungen. Sie schickt dir den Bericht per Mail und löscht den Auftrag danach.
4. Du prüfst den Bericht kurz und leitest ihn an den Kunden weiter (Modus „Freigabe“).

Einrichtungszeit: etwa 30–45 Minuten. Kosten pro Prüfung: wenige Cent.

---

## 1. Anthropic (das Modell)

1. Auf **console.anthropic.com** ein Konto anlegen.
2. **Billing**: Guthaben aufladen, z. B. 10 $.
3. Empfohlen: unter **Workspaces** einen eigenen Workspace „abrechnungsklar“ anlegen, getrennt von Energieklar. Sonst können beide Seiten dieselben Aufträge abholen, und Berichte kommen doppelt.
4. **API Keys → Create Key**, im Workspace „abrechnungsklar“. Den Schlüssel sofort kopieren und sicher ablegen, er wird nur einmal angezeigt.

## 2. Resend (Versand der Berichte)

1. Auf **resend.com** ein Konto mit deiner E-Mail-Adresse anlegen (m.riede@web.de).
2. **API Keys → Create API Key** und den Schlüssel kopieren.
3. Ohne eigene Domain verschickt Resend Mails nur an die Adresse, mit der du registriert bist. Für den Modus „Freigabe“ ist das genau richtig. Absender ist dann `onboarding@resend.dev`.

## 3. GitHub (Code-Ablage)

1. Auf **github.com** ein Konto anlegen.
2. Oben rechts **+ → New repository**, Name `abrechnungsklar`, Sichtbarkeit **Private**, dann **Create repository**.
3. Auf der leeren Repository-Seite auf **uploading an existing file** klicken.
4. Den entpackten Ordner öffnen und **alles darin markieren**: `index.html`, `netlify.toml`, `package.json`, `ANLEITUNG.md` und den Ordner `netlify`. Dann alles zusammen in das Upload-Feld ziehen.
5. Prüfen, ob die Ordnerstruktur angekommen ist: `netlify/functions/…` und `netlify/lib/…`.
6. Unten auf **Commit changes** klicken.

## 4. Netlify mit GitHub verbinden

1. Bei Netlify die Site **abrechnungsklar** öffnen.
2. **Project configuration → Build & deploy → Continuous deployment → Link repository**.
3. **GitHub** wählen, Netlify den Zugriff erlauben und das Repository `abrechnungsklar` auswählen.
4. Build-Einstellungen: Build command **leer lassen**, Publish directory **`.`** (ein Punkt). Dann speichern bzw. **Deploy**.

Ab jetzt veröffentlicht jede Änderung auf GitHub die Seite automatisch neu. Das Hochladen per Drag & Drop fällt weg.

## 5. Schlüssel bei Netlify hinterlegen

**Project configuration → Environment variables → Add a variable**, jeweils mit „Same value for all deploy contexts“:

| Name | Wert |
|---|---|
| `ANTHROPIC_API_KEY` | dein Anthropic-Schlüssel |
| `RESEND_API_KEY` | dein Resend-Schlüssel |
| `REPORT_TO` | m.riede@web.de |
| `MODUS` | `freigabe` |
| `MODEL` | optional, Standard ist `claude-sonnet-5-5` |

Danach **Deploys → Trigger deploy → Deploy site**, damit die Funktionen die Schlüssel kennen. Die Schlüssel stehen nie in der Seite selbst und sind für Besucher unsichtbar.

## 6. Prüfen, ob alles läuft

1. **Logs → Functions**: Dort müssen `submission-created` und `berichte-abholen` stehen, Letztere mit dem Hinweis „Scheduled“.
2. Ganz unten auf abrechnungsklar.netlify.app muss „Version 4 · … automatische Prüfung“ stehen.
3. Formular mit einer echten Rechnung absenden. Ein Zahlenbeispiel reicht nicht, der Spam-Filter muss die Anfrage durchlassen.
4. Nach 5–30 Minuten kommt die Mail „[NK] Prüfbericht …“. Prüfaufträge laufen meist in wenigen Minuten durch, können in Spitzenzeiten aber länger dauern.

Kommt nichts, sieh in diesen drei Logs nach: **Logs → Functions → submission-created**, **Logs → Functions → berichte-abholen** und auf console.anthropic.com unter **Batches**.

## Wichtig

- **Nur nicht als Spam markierte Anfragen** lösen die Prüfung aus. Landet eine Anfrage im Netlify-Spam, prüfst du sie am besten manuell mit der Prompt-Vorlage aus dem Prüf-Kit.
- **iPhone-Fotos im HEIC-Format** kann das Modell nicht lesen. Der Bericht vermerkt das dann unter „Technische Hinweise“. Safari wandelt Fotos beim Hochladen meist automatisch in JPEG um.
- **Datenschutz:** Die Unterlagen gehen an Anthropic (USA). Daten aus der API werden laut Anthropic standardmäßig nicht zum Training verwendet. Nimm Anthropic, Resend und Netlify in deine Datenschutzerklärung auf, bevor der Link öffentlich wird.
- **Abrechnungsklar** nutzt dasselbe Modul. Der Prompt für das Formular `pilot-anfrage` ist schon enthalten. Dafür braucht die Abrechnungsklar-Site ein eigenes Repository mit derselben Struktur und ihrer `index.html`.
- **Direkt an Kunden** (`MODUS=direkt`) erst, wenn die Berichte über mehrere Tests zuverlässig sind. Dafür braucht es eine eigene Domain bei Resend und eine kleine Code-Erweiterung, die die Kundenadresse mitführt.

## Dateien

- `netlify/lib/prompts.mjs`: die Prüfanweisungen. Hier verbesserst du nach den ersten Tests die Prüfpunkte.
- `netlify/lib/pruefung.mjs`: Hochladen, Auftrag ans Modell, Bericht als Mail.
- `netlify/functions/submission-created.mjs`: startet bei jeder Anfrage.
- `netlify/functions/berichte-abholen.mjs`: läuft alle 5 Minuten.
