# CLAUDE.md – Verbindliche Regeln für Folge-Sessions

Diese Datei ist der Vertrag zwischen dir (Claude) und dem Betreiber. Halte dich strikt daran, auch wenn es scheinbar einfacher wäre, davon abzuweichen. Bei Konflikten: nachfragen.

## Projekt in einem Satz

Onepager-Website zur Selbst-Anmeldung von Helfern für den Bierstand der St. Sebastian-Schützengilde bei den Beckumer **Püttagen 04.–06.09.2026**. Betreiber: private Einzelperson (E-Mail `mormartin@icloud.com`).

## Stack – NICHT abweichen ohne Rückfrage

- **Vanilla HTML5 + CSS3 (CSS Custom Properties) + ES-Module-JavaScript**. Kein React, Vue, Svelte, Next, Astro, Tailwind, kein npm-Build.
- CSS-Reset: `modern-normalize` (bereits inline in `assets/css/reset.css`).
- Supabase-Client per ESM-CDN: `https://esm.sh/@supabase/supabase-js@2.45.4` (Version gepinnt).
- Backend: Supabase Free Tier, Region **Frankfurt (eu-central-1)**.
- Auth: Supabase Auth mit **einem** Admin-User. Kein Signup, keine Nutzerverwaltung.
- Hosting: GitHub Pages, Deploy via `.github/workflows/pages.yml`.

## Rot-weiße Farbwelt

Definiert in `assets/css/main.css` unter `:root`. Zum Anpassen dort die CSS-Variablen ändern, nicht Farben verstreut hard-coden.

## Absolute Regeln

- **NIE** `service_role`-Key ins Frontend, Repo, Commit oder Kommentar schreiben. Nur `SUPABASE_URL` + `SUPABASE_ANON_KEY` (public) sind clientseitig zulässig.
- **NIE** dynamische Texte (aus `site_content`) per `innerHTML` einsetzen – immer `textContent`. Kein HTML im Textarea, keine XSS-Fläche.
- **NIE** Impressum oder Datenschutz über den Admin-Bereich editierbar machen. Diese Sections sind fest im HTML in `index.html`.
- **NIE** ohne Rückfrage: Framework einführen, `git push --force`, Branch löschen, Tabellen droppen, Migrationen ohne Backup.
- **NIE** Cookie-Banner einbauen, solange nur funktional-notwendige Session-Cookies gesetzt werden.
- **NIE** Personendaten (Testdaten mit echten Namen/Kontakten) committen.
- Vor Commits mit potentiell echten Kontaktdaten (auch in Fixtures) **Rückfrage** stellen.

## Sprache

- UI-Texte, Commit-Messages, Kommentare in Code, README: **Deutsch**.
- Identifier (Variablen, Funktionen, Tabellen, Spalten): **Englisch**, `camelCase`/`snake_case` je Kontext.
- Commit-Messages: imperativ („Ergänze …", „Behebe …").

## Admin-Login – wichtiger Sonderfall

Der Betreiber möchte sich nur mit Passwort einloggen. Supabase Auth verlangt aber technisch immer eine E-Mail. Kompromiss:
- Feste Kennung `mormartin@icloud.com` in `config.js` als `ADMIN_EMAIL` hinterlegt.
- Auf `admin.html` erscheint **nur ein Passwortfeld**. Beim Submit wird `ADMIN_EMAIL` programmatisch mit dem Passwort an `supabase.auth.signInWithPassword()` geschickt.
- Nicht durch einen selbstgebauten Passwort-Check ersetzen – RLS + JWT bleiben so sauber.

## Datenmodell (aktueller Stand)

Slice 1 fertig:
- `shifts` (11 Zeilen aus `seed.sql`)
- `site_content` (3 Zeilen: `hero_title`, `hero_body`, `plan_intro`)
- RLS aktiv, `anon` + `authenticated` dürfen beides lesen.

Slice 2 (offen) fügt hinzu: `signups`, View `signups_public`, Trigger `check_shift_capacity`, INSERT-Policy für `anon`.

Slice 3 (offen) fügt hinzu: UPDATE-Policy auf `site_content` für Admin, SELECT/UPDATE/DELETE-Policies auf `signups` für Admin.

## Arbeitsweise

- **Vertikale Slices** (DB + Frontend + Test), nicht horizontale Phasen. Nach jedem Slice: kurze Zusammenfassung + Testanleitung + Status-Notiz im Vault fortschreiben.
- Kleine, thematische Commits.
- Bei Unsicherheit im Fachlichen (Farben, Klarname, Vereinsdetails): **nachfragen**, nicht raten. Platzhalter mit `[TODO: ...]` markieren.
- Aufwand-Minimum-Prinzip: bei zwei technisch gleichwertigen Lösungen die mit weniger Konfiguration, weniger Klicks, weniger Wartung.

## Vault-Integration

Projektstatus liegt im Obsidian-Vault des Betreibers unter
`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Second Brain/01_Projekte/Puettage-Helferplan-2026/`
(3-Datei-Struktur: Info / Status / Dateien). Nach jedem abgeschlossenen Slice: **Status-Notiz fortschreiben** (neue Einträge oben, jeweils mit Testanleitung).
