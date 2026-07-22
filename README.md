# Püttage-Helferplan 2026

Schlanke, statische Website zur Selbst-Anmeldung von Helfern für den Bierstand der St. Sebastian-Schützengilde bei den Beckumer Püttagen (04.–06.09.2026). Vanilla-HTML/CSS/JS + Supabase (EU/Frankfurt), Hosting auf GitHub Pages.

## Betrieb (einmalig einrichten)

1. **Supabase-Projekt anlegen** (Region Frankfurt) – siehe [`supabase/README.md`](supabase/README.md).
2. **DPA (Data Processing Addendum)** im Supabase-Dashboard unter *Settings → Legal* unterschreiben.
3. **Admin-User anlegen** unter *Authentication → Users → Add user*: E-Mail `mormartin@icloud.com`, Passwort selbst setzen (sicher, im Passwort-Manager speichern). Dann im SQL Editor:
   ```sql
   update auth.users
      set raw_app_meta_data = raw_app_meta_data || '{"is_admin": true}'::jsonb
    where email = 'mormartin@icloud.com';
   ```
4. **GitHub-Repo** ist bereits angelegt: <https://github.com/MrSyver/schichtplan-puettage> (privat). Inhalt dieses Ordners in den `main`-Branch pushen.
5. **GitHub-Secrets setzen** (Repo → *Settings → Secrets and variables → Actions*):
   - `SUPABASE_URL` – aus dem Supabase-Dashboard
   - `SUPABASE_ANON_KEY` – der **public anon** Key (nicht `service_role`)
   - `ADMIN_EMAIL` – `mormartin@icloud.com`
6. **GitHub Pages aktivieren** (*Settings → Pages → Source: GitHub Actions*). Push auf `main` deployt automatisch.

## Lokal entwickeln

```bash
cp config.example.js config.js
# Werte eintragen (SUPABASE_URL + anon Key + ADMIN_EMAIL)
python3 -m http.server 8000
# Browser: http://localhost:8000
```

`config.js` ist in `.gitignore` und darf **nie** ins Repo.

## Bestätigungsmail einrichten

Nach jedem Signup mit E-Mail-Adresse wird automatisch eine Bestätigung verschickt (via [Resend](https://resend.com), EU-Server). Setup einmalig in [`supabase/README.md`](supabase/README.md) unter „Slice 2 – Bestätigungsmail via Resend" beschrieben (Account anlegen, API-Key generieren, Edge Function deployen, Secrets setzen).

## Was der Admin im Alltag macht

- **Texte anpassen**: `admin.html` aufrufen, einloggen, im Abschnitt „Redaktionelle Texte" bearbeiten und speichern. Änderungen sind sofort auf der Startseite sichtbar.
- **Anmeldungen sichten**: alle Namen, E-Mails und Telefonnummern einsehen; Einträge einzeln oder gesammelt löschen.
- **Nach dem Fest (ab 04.10.2026)**: im Admin-Bereich „Alle Anmeldungen löschen" ausführen. Damit sind die Kontaktdaten weg – Schichten und Texte bleiben bestehen.

## Impressum und Datenschutz

Beide Sections sind **fest im HTML** in `index.html` (Anker `#impressum` und `#datenschutz`). Änderungen daran erfordern rechtliche Sorgfalt und werden direkt im HTML gepflegt, nicht über den Admin.

## Stack

- Frontend: Vanilla HTML/CSS/ES-Module (kein Build-System)
- Reset: `modern-normalize` (inline in `assets/css/reset.css`)
- Backend: Supabase (Postgres + Auth), EU-Region Frankfurt
- Deploy: GitHub Actions → GitHub Pages

## Lizenz

MIT – siehe [`LICENSE`](LICENSE).
