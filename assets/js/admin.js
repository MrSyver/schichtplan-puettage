// ==========================================================
// Puettage-Helferplan 2026 – Admin-Bereich
// ==========================================================
// - Passwort-Login (E-Mail programmatisch, Nutzer sieht nur Passwort)
// - Session-Handling (Reload -> eingeloggt bleiben)
// - Anmeldungen anzeigen inkl. Kontaktdaten
// - Einzel-Loeschen + „Alle loeschen" (doppelte Bestaetigung)
// - Redaktionelle Texte bearbeiten (Upsert)
// ==========================================================

import { supabase } from './supabase-client.js';
import { ADMIN_EMAIL } from '../../config.js';

const WOCHENTAG = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const DELETE_CONFIRMATION_TEXT = 'LÖSCHEN';

// ---------- Zustand ----------

let signupsCache = [];
let shiftsCache = [];

// ---------- Utility ----------

function esc(s) { return s == null ? '' : String(s); }
function fmtDatum(iso) {
    const d = new Date(iso + 'T12:00:00');
    return `${WOCHENTAG[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function hhmm(t) { return t?.slice(0, 5) ?? ''; }
function fmtTs(iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

let toastTimer = null;
function toast(text, variant = 'ok') {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.toggle('toast--error', variant === 'error');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// ---------- Login ----------

function setzeLoginFehler(txt) {
    const el = document.getElementById('login-error');
    if (!txt) { el.hidden = true; return; }
    el.textContent = txt;
    el.hidden = false;
}

async function handleLogin(e) {
    e.preventDefault();
    setzeLoginFehler(null);
    const pw = document.getElementById('login-password').value;
    if (!pw) return;

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Prüfe …';

    const { data, error } = await supabase.auth.signInWithPassword({
        email: ADMIN_EMAIL,
        password: pw,
    });

    btn.disabled = false;
    btn.textContent = orig;

    if (error) {
        console.warn('login failed', error);
        setzeLoginFehler('Passwort falsch oder Admin-User noch nicht angelegt.');
        return;
    }

    const isAdmin = data?.session?.user?.app_metadata?.is_admin === true;
    if (!isAdmin) {
        await supabase.auth.signOut();
        setzeLoginFehler('Dieser Nutzer hat keinen Admin-Zugriff.');
        return;
    }

    zeigeAdminApp();
    await ladeDaten();
}

async function handleLogout() {
    await supabase.auth.signOut();
    document.getElementById('admin-app').hidden = true;
    document.getElementById('login-panel').hidden = false;
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
}

function zeigeAdminApp() {
    document.getElementById('login-panel').hidden = true;
    document.getElementById('admin-app').hidden = false;
}

// ---------- Daten laden ----------

async function ladeDaten() {
    // Shifts (fuer Zuordnung), Signups (alle Details), Texte
    const [sh, si, txt] = await Promise.all([
        supabase.from('shifts').select('*').order('sort_order'),
        supabase.from('signups').select('*').order('created_at'),
        supabase.from('site_content').select('key, value'),
    ]);

    if (sh.error || si.error || txt.error) {
        console.error('ladeDaten failed', { sh: sh.error, si: si.error, txt: txt.error });
        toast('Daten konnten nicht geladen werden.', 'error');
        return;
    }

    shiftsCache  = sh.data ?? [];
    signupsCache = si.data ?? [];

    rendereSignups();
    rendereTexte(txt.data ?? []);
}

// ---------- Signups rendern ----------

function rendereSignups() {
    const list = document.getElementById('signups-list');
    const count = document.getElementById('signups-count');
    const delAll = document.getElementById('delete-all-btn');
    list.innerHTML = '';
    count.textContent = `${signupsCache.length} Anmeldungen gesamt`;
    delAll.hidden = signupsCache.length === 0;

    if (signupsCache.length === 0) {
        const p = document.createElement('p');
        p.className = 'plan__loading';
        p.textContent = 'Noch keine Anmeldungen.';
        list.appendChild(p);
        return;
    }

    // Gruppieren nach shift_id
    const byShift = new Map();
    for (const s of signupsCache) {
        if (!byShift.has(s.shift_id)) byShift.set(s.shift_id, []);
        byShift.get(s.shift_id).push(s);
    }

    // Schichten in sort_order-Reihenfolge (auch wenn keine Signups drauf)
    for (const shift of shiftsCache) {
        const rows = byShift.get(shift.id);
        if (!rows || rows.length === 0) continue;
        list.appendChild(rendereShiftGruppe(shift, rows));
    }
}

function rendereShiftGruppe(shift, rows) {
    const wrap = document.createElement('section');
    wrap.className = 'admin-shift';
    const head = document.createElement('div');
    head.className = 'admin-shift__head';
    head.innerHTML = `
        <div class="admin-shift__title">${fmtDatum(shift.shift_date)}</div>
        <div class="admin-shift__meta">${hhmm(shift.start_time)}–${hhmm(shift.end_time)} · ${rows.length} / ${shift.max_persons} (+1 Puffer)</div>
    `;
    wrap.appendChild(head);

    for (const s of rows) {
        const row = document.createElement('details');
        row.className = 'admin-row';
        const contact = [s.email, s.phone].filter(Boolean).join(' · ') || 'keine Kontaktdaten';
        row.innerHTML = `
            <summary>
                <span class="admin-row__name">${esc(s.name)}</span>
                <span class="admin-row__tags">
                    ${s.show_name_publicly ? '<span class="tag tag--ok">öffentlich</span>' : '<span class="tag">anonym</span>'}
                    ${s.remind_via_email ? '<span class="tag tag--info">Reminder</span>' : ''}
                    ${s.reminder_sent_at ? '<span class="tag tag--ok">Reminder gesendet</span>' : ''}
                </span>
            </summary>
            <div class="admin-row__body">
                <div><strong>Kontakt:</strong> ${esc(contact)}</div>
                <div><strong>E-Mail:</strong> ${esc(s.email || '–')}</div>
                <div><strong>Telefon:</strong> ${esc(s.phone || '–')}</div>
                <div><strong>Eingetragen:</strong> ${fmtTs(s.created_at)}</div>
                <div><strong>Einwilligung:</strong> ${fmtTs(s.consent_given_at)}</div>
                <div class="admin-row__actions">
                    <button type="button" class="btn admin-danger" data-delete="${s.id}" data-name="${esc(s.name)}">Diesen Eintrag löschen</button>
                </div>
            </div>
        `;
        wrap.appendChild(row);
    }
    return wrap;
}

async function handleListClick(e) {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const id = btn.dataset.delete;
    const name = btn.dataset.name;
    if (!window.confirm(`Eintrag von ${name} wirklich löschen?\n\nDie Person wird darüber NICHT automatisch benachrichtigt.`)) return;
    const { error } = await supabase.from('signups').delete().eq('id', id);
    if (error) {
        console.error('delete failed', error);
        toast('Löschen fehlgeschlagen.', 'error');
        return;
    }
    toast(`Eintrag von ${name} gelöscht.`);
    await ladeDaten();
}

async function handleDeleteAll() {
    const first = window.confirm(
        `ALLE ${signupsCache.length} Anmeldungen unwiderruflich löschen?\n\n` +
        `Empfehlung: nach dem 04.10.2026 (vier Wochen nach Ende der Püttage).`
    );
    if (!first) return;
    const bestaetigung = window.prompt(
        `Zur Bestätigung bitte "${DELETE_CONFIRMATION_TEXT}" eintippen:`
    );
    if (bestaetigung !== DELETE_CONFIRMATION_TEXT) {
        toast('Nicht bestätigt – nichts gelöscht.', 'error');
        return;
    }
    // Alle löschen: bulk delete
    const ids = signupsCache.map(s => s.id);
    const { error } = await supabase.from('signups').delete().in('id', ids);
    if (error) {
        console.error('delete-all failed', error);
        toast('Massenlöschung fehlgeschlagen.', 'error');
        return;
    }
    toast(`${ids.length} Anmeldungen gelöscht.`);
    await ladeDaten();
}

// ---------- Texte ----------

function rendereTexte(rows) {
    const form = document.getElementById('texts-form');
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    for (const key of ['hero_title', 'hero_body', 'plan_intro', 'contact_alt']) {
        const el = form.querySelector(`[name="${key}"]`);
        if (el) el.value = map[key] ?? '';
    }
}

async function handleTexteSave(e) {
    e.preventDefault();
    const btn = document.getElementById('texts-save');
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Speichere …';

    const fd = new FormData(e.target);
    const now = new Date().toISOString();
    const errors = [];

    // Reines UPDATE pro Key (Keys existieren per Seed) – umgeht fehlende INSERT-Policy
    for (const key of ['hero_title', 'hero_body', 'plan_intro', 'contact_alt']) {
        const value = (fd.get(key) ?? '').toString();
        const { error } = await supabase.from('site_content')
            .update({ value, updated_at: now })
            .eq('key', key);
        if (error) {
            console.error('save failed for', key, error);
            errors.push(`${key}: ${error.message}`);
        }
    }
    btn.disabled = false;
    btn.textContent = orig;

    if (errors.length > 0) {
        toast(`Speichern fehlgeschlagen (${errors.length}). Details in der Konsole.`, 'error');
        return;
    }
    toast('Texte gespeichert. Änderungen sind sofort auf der Startseite sichtbar.');
}

// ---------- Session-Check bei Start ----------

async function pruefeSession() {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.user?.app_metadata?.is_admin === true) {
        zeigeAdminApp();
        await ladeDaten();
    }
}

// ---------- Init ----------

function init() {
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('signups-list').addEventListener('click', handleListClick);
    document.getElementById('delete-all-btn').addEventListener('click', handleDeleteAll);
    document.getElementById('texts-form').addEventListener('submit', handleTexteSave);
    pruefeSession();
}

init();
