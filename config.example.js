// Vorlage für lokale Konfiguration.
// Kopiere diese Datei nach `config.js` und trage die echten Werte aus dem
// Supabase-Dashboard (Project Settings → API) ein.
//
// WICHTIG:
// - `config.js` ist in .gitignore und darf NIE ins Repo.
// - Verwende ausschließlich den `anon` Public Key. Der `service_role` Key
//   darf niemals im Frontend/Repo landen.

export const SUPABASE_URL = 'https://xxxxxxxxxxxxxxxx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...-anon-public-key-hier-einfuegen';

// Admin-Login: Kennung ist fest hinterlegt, damit auf der Login-Seite
// nur ein Passwortfeld erscheint. Passwort wird im Supabase-Dashboard
// gesetzt (Authentication → Users).
export const ADMIN_EMAIL = 'mormartin@icloud.com';
