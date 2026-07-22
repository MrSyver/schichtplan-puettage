# Supabase – Setup und Betrieb

Dieses Verzeichnis enthält alle SQL-Skripte und die Edge Function. Alle SQL-Skripte werden **manuell** im Supabase-Dashboard ausgeführt (kein CLI, keine Migrations-Pipeline – gewollt schlank). Die Edge Function kann per CLI ODER direkt im Dashboard deployt werden.

## Erst-Setup (einmalig)

1. **Neues Supabase-Projekt anlegen**: <https://supabase.com/dashboard> → *New project*
   - Region: **Frankfurt (eu-central-1)** – für DSGVO wichtig
   - Datenbank-Passwort: sicher generieren und im Passwort-Manager speichern
2. **DPA (Data Processing Addendum)** unterschreiben: *Settings → Legal → DPA*, als Privatperson mit Klarname (elektronisch).
3. **Zugangsdaten übernehmen**: *Settings → API* → in `config.js` eintragen (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). **`service_role`-Key darf nirgendwo im Frontend/Repo landen.**
4. **SQL Editor → New query** öffnen und der Reihe nach jeden Inhalt einfügen + *Run*:
   1. `schema.sql`
   2. `seed.sql`
   3. `02_signups.sql`  ← neu in Slice 2
5. **Kontroll-Check im Table Editor:**
   - `shifts` enthält 11 Zeilen
   - `site_content` enthält 3 Zeilen
   - `signups` existiert, ist leer, RLS ist aktiv (Schloss-Icon)

## Slice 2 – Bestätigungsmail via Resend

Wird nach jedem erfolgreichen Signup mit E-Mail-Adresse verschickt.

### Resend-Account einrichten (einmalig)

1. Account auf <https://resend.com> anlegen (kostenlos, EU-Region wählbar).
2. Unter *API Keys* einen neuen Key generieren – Vorschlag: Name „puettage-prod", Permission *Sending access*. Key **einmal kopieren** (wird nur einmal angezeigt).
3. **Absender-Adresse**: Für den Start reicht `onboarding@resend.dev` (Free-Setup, ohne eigene Domain). Später kannst du eine eigene verifizierte Domain einbinden.

### Edge Function deployen

**Variante A (empfohlen, CLI):**

```bash
# Einmalig: Supabase CLI installieren
brew install supabase/tap/supabase

# Im Projektordner
supabase login
supabase link --project-ref <deine-project-ref>
supabase functions deploy send-signup-confirmation
```

**Variante B (Dashboard):**

*Edge Functions → Create a new function* → Name `send-signup-confirmation` → Inhalt von `functions/send-signup-confirmation/index.ts` einfügen → *Deploy*.

### Function-Secrets setzen

Im Dashboard: *Edge Functions → send-signup-confirmation → Secrets*:

| Key | Wert |
|---|---|
| `RESEND_API_KEY` | dein Resend-API-Key |
| `MAIL_FROM` | `Püttage Helfer <onboarding@resend.dev>` (oder deine eigene Domain) |
| `MAIL_REPLY_TO` | `mormartin@icloud.com` (optional, empfohlen) |

`SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden automatisch bereitgestellt – nicht selbst setzen.

### Test

Über den lokalen Server einen Eintrag mit deiner eigenen E-Mail-Adresse machen. Nach 2–5 Sekunden sollte die Bestätigungsmail eintreffen. In der Supabase-UI unter *Edge Functions → send-signup-confirmation → Logs* siehst du bei Problemen den Fehler.

## Slice 3 (Admin) – kommt separat

Legt Policies für den `is_admin`-Claim an und erstellt den Admin-User. Details werden in der nächsten Iteration ergänzt.

## Daten löschen (nach dem Fest, ab 04.10.2026)

Über den Admin-Bereich (kommt in Slice 3) mit einem Klick. Notfalls per SQL:

```sql
truncate table public.signups;
```

`shifts` und `site_content` bleiben bestehen.
