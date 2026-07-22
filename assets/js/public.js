// ==========================================================
// Puettage-Helferplan 2026 – oeffentliche Seite (Slice 2.7)
// ==========================================================
// - Passwort-Gate + „Zugriff anfragen"-Formular (Mail an Betreiber)
// - Laedt Schichten + oeffentliche Signups und rendert Plan
// - Redaktionelle Texte aus site_content per textContent ersetzen
// - Modal + Anmeldeformular mit Honeypot, Zeit-Trap, Kapazitaets-
//   Fehlerbehandlung und Toast-Feedback
// - Reminder-Mail-Checkbox erscheint nur bei angegebener E-Mail
// - Nach erfolgreichem Insert: Edge Function fuer Bestaetigungsmail
// - Selbst-Abmelden ueber Delete-Token-Link aus der Bestaetigungsmail
// - Kapazitaet: max_persons + 1 Puffer erlaubt (letzter Slot als
//   „Puffer" gestrichelt/orange dargestellt)
// ==========================================================

import { supabase } from './supabase-client.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

// ---------- Konstanten ----------

const WOCHENTAG = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const MIN_FILL_TIME_MS = 1000;
const GATE_STORAGE_KEY  = 'puettage_unlocked_v1';
// SHA-256 von "Beckum". Client-seitig = nur "Insider-Schwelle", keine echte Sicherheit.
const GATE_PASSWORD_HASH = '3cea008d0226246d57690424108f5d3290abf9127e49eb133f3ae853ab94a6de';

// ---------- Zustand ----------

const zustand = {
    shifts: [],
    publicSignups: [],
    aktuelleSchicht: null,
    modalOffnetAt: 0,
    appGestartet: false,
};

// ---------- Formatierung ----------

function formatiereTagKopf(iso) {
    const d = new Date(iso + 'T12:00:00');
    return `${WOCHENTAG[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}
function trimmeUhrzeit(t) { return t?.slice(0, 5) ?? ''; }
function nurWochentag(iso) { return WOCHENTAG[new Date(iso + 'T12:00:00').getDay()]; }
function kurzDatum(iso) {
    const d = new Date(iso + 'T12:00:00');
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.`;
}
function schichtLabel(s) {
    return `${trimmeUhrzeit(s.start_time)}–${trimmeUhrzeit(s.end_time)}`;
}

// ---------- Passwort-Gate ----------

async function sha256Hex(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function entriegeleUI() {
    document.getElementById('password-gate').hidden = true;
    document.getElementById('app').hidden = false;
    document.body.style.overflow = '';
}

function initGate() {
    const gateForm  = document.getElementById('gate-form');
    const gateInput = document.getElementById('gate-password');
    const gateError = document.getElementById('gate-error');

    // Wenn ein Abmelde-Link (?abmelden=…&t=…) aufgerufen wurde: Gate ueberspringen,
    // damit der Abmelde-Dialog direkt erscheint (Nutzer kommt aus der Mail).
    const params = new URLSearchParams(window.location.search);
    const isUnsubscribe = params.has('abmelden') && params.has('t');

    if (localStorage.getItem(GATE_STORAGE_KEY) === '1' || isUnsubscribe) {
        entriegeleUI();
        startApp();
        return;
    }

    gateForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const hash = await sha256Hex(gateInput.value ?? '');
        if (hash === GATE_PASSWORD_HASH) {
            localStorage.setItem(GATE_STORAGE_KEY, '1');
            gateError.hidden = true;
            entriegeleUI();
            startApp();
        } else {
            gateError.textContent = 'Das Passwort stimmt nicht. Versuch es noch einmal.';
            gateError.hidden = false;
            gateInput.value = '';
            gateInput.focus();
        }
    });

    // „Zugriff anfragen"
    const reqForm = document.getElementById('request-form');
    const reqFeedback = document.getElementById('request-feedback');
    reqForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (new FormData(reqForm).get('email') || '').toString().trim();
        const name  = (new FormData(reqForm).get('name')  || '').toString().trim();
        if (!/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
            reqFeedback.textContent = 'Bitte eine gültige E-Mail-Adresse eintragen.';
            reqFeedback.hidden = false;
            reqFeedback.classList.remove('gate__error--ok');
            return;
        }
        reqFeedback.hidden = true;
        const btn = reqForm.querySelector('button');
        const orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Wird gesendet …';
        try {
            const res = await fetch(`${SUPABASE_URL}/functions/v1/send-access-request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                },
                body: JSON.stringify({ email, name }),
            });
            if (!res.ok) throw new Error('status ' + res.status);
            reqForm.reset();
            reqFeedback.textContent = 'Danke! Wir melden uns kurzfristig per E-Mail.';
            reqFeedback.classList.add('gate__error--ok');
            reqFeedback.hidden = false;
        } catch (err) {
            console.warn('access request failed', err);
            reqFeedback.textContent = 'Anfrage konnte nicht gesendet werden. Bitte per Telefon melden (siehe Startseite).';
            reqFeedback.classList.remove('gate__error--ok');
            reqFeedback.hidden = false;
        } finally {
            btn.disabled = false; btn.textContent = orig;
        }
    });
}

// ---------- Datenzugriff ----------

async function ladeTexte() {
    const { data, error } = await supabase.from('site_content').select('key, value');
    if (error || !data) return;
    for (const row of data) {
        if (row.key === 'contact_alt') {
            rendereKontaktMitWhatsapp(row.value ?? '');
            continue;
        }
        const ziel = document.querySelector(`[data-content="${row.key}"]`);
        if (ziel && typeof row.value === 'string') ziel.textContent = row.value;
    }
}

// Text mit deutschen Handynummern (Format "+49 XXX YYYYYYYY") in
// XSS-sichere DOM-Struktur wandeln: jede Nummer wird zum wa.me-Link.
function rendereKontaktMitWhatsapp(text) {
    const el = document.querySelector('[data-content="contact_alt"]');
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);

    const phoneRe = /(\+49[\s\-]?\d{2,4}[\s\-]?\d[\d\s\-]{4,})/g;
    const zeilen = text.split('\n');

    zeilen.forEach((zeile, idx) => {
        let last = 0;
        let m;
        while ((m = phoneRe.exec(zeile)) !== null) {
            if (m.index > last) el.appendChild(document.createTextNode(zeile.slice(last, m.index)));
            const phoneText = m[1].trim();
            const digits = phoneText.replace(/\D/g, ''); // wa.me will nur Ziffern
            const a = document.createElement('a');
            a.href = `https://wa.me/${digits}`;
            a.className = 'wa-link';
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('aria-label', `WhatsApp-Chat mit ${phoneText}`);
            a.textContent = phoneText;
            el.appendChild(a);
            last = m.index + m[1].length;
        }
        if (last < zeile.length) el.appendChild(document.createTextNode(zeile.slice(last)));
        if (idx < zeilen.length - 1) el.appendChild(document.createTextNode('\n'));
    });
}

async function ladeSchichten() {
    const { data, error } = await supabase.from('shifts').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    zustand.shifts = data ?? [];
}

async function ladePublicSignups() {
    const { data, error } = await supabase.rpc('get_public_signups');
    if (error) {
        console.warn('[get_public_signups] Ladefehler – Belegung startet leer.', error);
        zustand.publicSignups = [];
        return;
    }
    zustand.publicSignups = data ?? [];
}

// ---------- Rendering ----------

function zaehleFuer(shiftId) {
    let n = 0;
    for (const s of zustand.publicSignups) if (s.shift_id === shiftId) n++;
    return n;
}
function namenFuer(shiftId) {
    const namen = [];
    for (const s of zustand.publicSignups) {
        if (s.shift_id === shiftId) namen.push(s.display_name ?? 'anonym');
    }
    return namen;
}

function zeigePlanFehler(msg) {
    const el = document.getElementById('plan-grid');
    el.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'plan__loading';
    p.textContent = msg;
    el.appendChild(p);
}

function rendereSchichten() {
    const grid = document.getElementById('plan-grid');
    grid.innerHTML = '';

    const nachTag = new Map();
    for (const s of zustand.shifts) {
        if (!nachTag.has(s.shift_date)) nachTag.set(s.shift_date, []);
        nachTag.get(s.shift_date).push(s);
    }

    for (const [datum, tagesSchichten] of nachTag) {
        const spalte = document.createElement('section');
        spalte.className = 'day';
        spalte.setAttribute('aria-labelledby', `day-${datum}`);

        const header = document.createElement('header');
        header.className = 'day__header';
        const titel = document.createElement('h2');
        titel.className = 'day__title';
        titel.id = `day-${datum}`;
        titel.textContent = nurWochentag(datum);
        const datumEl = document.createElement('span');
        datumEl.className = 'day__date';
        datumEl.textContent = kurzDatum(datum);
        header.append(titel, datumEl);
        spalte.appendChild(header);

        for (const s of tagesSchichten) spalte.appendChild(rendereSchicht(s));
        grid.appendChild(spalte);
    }
}

function rendereSchicht(s) {
    const belegte  = zaehleFuer(s.id);
    const namen    = namenFuer(s.id);
    const kapazitaet = s.max_persons + 1; // +1 Puffer
    const voll = belegte >= kapazitaet;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shift';
    btn.dataset.shiftId = s.id;
    if (voll) {
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('tabindex', '-1');
    }

    const zeit = document.createElement('span');
    zeit.className = 'shift__time';
    zeit.textContent = schichtLabel(s);
    btn.appendChild(zeit);

    const status = document.createElement('span');
    status.className = 'shift__status';
    if (belegte > s.max_persons) {
        status.textContent = `${s.max_persons} / ${s.max_persons} · +${belegte - s.max_persons} Reserve`;
    } else {
        status.textContent = `${belegte} / ${s.max_persons} Plätze`;
    }
    btn.appendChild(status);

    const slots = document.createElement('span');
    slots.className = 'shift__slots';
    slots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < kapazitaet; i++) {
        const dot = document.createElement('span');
        let cls = 'slot';
        if (i === s.max_persons) cls += ' slot--buffer';
        if (i < belegte) cls += ' slot--filled';
        dot.className = cls;
        slots.appendChild(dot);
    }
    btn.appendChild(slots);

    if (namen.length) {
        const namenEl = document.createElement('span');
        namenEl.className = 'shift__names';
        namenEl.textContent = namen.join(', ');
        btn.appendChild(namenEl);
    }

    if (!voll) btn.addEventListener('click', () => oeffneModal(s));
    return btn;
}

// ---------- Modal (Anmeldung) ----------

let letzterFokus = null;

function oeffneModal(s) {
    zustand.aktuelleSchicht = s;
    zustand.modalOffnetAt = Date.now();
    letzterFokus = document.activeElement;

    document.getElementById('modal-shift-info').textContent =
        `${formatiereTagKopf(s.shift_date)}, ${schichtLabel(s)}`;

    setzeFormularFehler(null);
    document.getElementById('signup-form').reset();
    aktualisiereReminderSichtbarkeit();
    setzeSubmitLoading(false);
    rendereBestehendeImModal(s);

    const modal = document.getElementById('signup-modal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('input[name="name"]').focus();
}

function rendereBestehendeImModal(s) {
    const wrap = document.getElementById('modal-existing');
    const list = document.getElementById('modal-existing-list');
    list.innerHTML = '';
    const eintraege = zustand.publicSignups.filter(x => x.shift_id === s.id);
    if (eintraege.length === 0) {
        wrap.hidden = true;
        return;
    }
    for (const eintrag of eintraege) {
        const li = document.createElement('li');
        const nameEl = document.createElement('span');
        if (eintrag.display_name) {
            nameEl.textContent = eintrag.display_name;
        } else {
            nameEl.textContent = 'anonym';
            nameEl.className = 'name-anonym';
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal__existing-delete';
        btn.setAttribute('aria-label', 'Diese Person aus der Schicht austragen');
        btn.title = 'Aus Schicht austragen';
        btn.textContent = '×';
        btn.addEventListener('click', () => bestaetigeUndLoesche(eintrag));
        li.append(nameEl, btn);
        list.appendChild(li);
    }
    wrap.hidden = false;
}

async function bestaetigeUndLoesche(eintrag) {
    const anzeigeName = eintrag.display_name ?? 'diese anonyme Anmeldung';
    const ok = window.confirm(
        `${anzeigeName} wirklich aus der Schicht austragen?\n\n` +
        `Achtung: Die Person wird darüber NICHT automatisch benachrichtigt. ` +
        `Bitte gib ihr vorher kurz Bescheid.`
    );
    if (!ok) return;

    const { data, error } = await supabase.rpc('delete_signup_open', { p_signup_id: eintrag.id });
    if (error) {
        console.error('delete_signup_open failed', error);
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('rate') || (error.hint || '').includes('DELETE_RATE_LIMIT')) {
            zeigeToast('Zu viele Löschungen in kurzer Zeit. Bitte einen Moment warten.', 'error');
        } else {
            zeigeToast('Austragen fehlgeschlagen. Bitte erneut versuchen.', 'error');
        }
        return;
    }
    if (data === false) {
        zeigeToast('Dieser Eintrag existiert nicht mehr.', 'error');
    } else {
        zeigeToast(`${anzeigeName} ist ausgetragen.`);
    }
    await ladePublicSignups();
    // Modal-Inhalt und Plan aktualisieren
    if (zustand.aktuelleSchicht) rendereBestehendeImModal(zustand.aktuelleSchicht);
    rendereSchichten();
}

function schliesseModal() {
    for (const id of ['signup-modal', 'unsubscribe-modal', 'success-modal']) {
        const m = document.getElementById(id);
        if (m && !m.hidden) m.hidden = true;
    }
    document.body.style.overflow = '';
    if (letzterFokus?.focus) letzterFokus.focus();
}

function initModalSteuerung() {
    const s = document.getElementById('signup-modal');
    s.querySelector('.modal__close').addEventListener('click', schliesseModal);
    s.addEventListener('click', (e) => { if (e.target === s) schliesseModal(); });

    const u = document.getElementById('unsubscribe-modal');
    u.querySelector('.modal__close').addEventListener('click', schliesseModal);
    u.addEventListener('click', (e) => { if (e.target === u) schliesseModal(); });
    document.getElementById('unsub-cancel').addEventListener('click', schliesseModal);

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') schliesseModal(); });
}

// ---------- Formular ----------

function aktualisiereReminderSichtbarkeit() {
    const emailWert = document.getElementById('signup-email').value.trim();
    const wrap = document.getElementById('reminder-wrap');
    const cb = wrap.querySelector('input[name="remind_via_email"]');
    if (emailWert === '') {
        wrap.hidden = true;
        cb.checked = false;
    } else {
        wrap.hidden = false;
    }
}

function setzeFormularFehler(text) {
    const el = document.getElementById('form-error');
    if (!text) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = text;
    el.hidden = false;
}

function setzeSubmitLoading(loading) {
    const btn = document.getElementById('form-submit');
    btn.disabled = loading;
    btn.querySelector('.btn__label').textContent =
        loading ? 'Wird gespeichert …' : 'Verbindlich eintragen';
    btn.querySelector('.btn__spinner').hidden = !loading;
}

function initFormular() {
    const form = document.getElementById('signup-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSubmit(new FormData(form));
    });
    document.getElementById('signup-email').addEventListener('input', aktualisiereReminderSichtbarkeit);
}

async function handleSubmit(fd) {
    const schicht = zustand.aktuelleSchicht;
    if (!schicht) return;

    if ((fd.get('website') || '').toString().trim() !== '') {
        schliesseModal();
        return;
    }
    if (Date.now() - zustand.modalOffnetAt < MIN_FILL_TIME_MS) {
        setzeFormularFehler('Bitte etwas langsamer – kurz überprüfen und erneut senden.');
        return;
    }

    const name  = (fd.get('name')  || '').toString().trim();
    const email = (fd.get('email') || '').toString().trim();
    const phone = (fd.get('phone') || '').toString().trim();
    const show_name_publicly = fd.get('show_name_publicly') === 'on';
    const remind_via_email   = !!email && fd.get('remind_via_email') === 'on';
    const consent = fd.get('consent') === 'on';

    if (name.length < 2) { setzeFormularFehler('Bitte trag deinen Namen ein (mind. 2 Zeichen).'); return; }
    if (email && !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
        setzeFormularFehler('Die E-Mail-Adresse sieht nicht richtig aus.'); return;
    }
    if (!consent) { setzeFormularFehler('Bitte die Datenschutz-Einwilligung bestätigen.'); return; }

    setzeFormularFehler(null);
    setzeSubmitLoading(true);

    const signupId = crypto.randomUUID();

    const { error } = await supabase
        .from('signups')
        .insert({
            id: signupId,
            shift_id: schicht.id,
            name,
            email: email || null,
            phone: phone || null,
            show_name_publicly,
            remind_via_email,
        });

    if (error) {
        setzeSubmitLoading(false);
        const msg = (error.message || '') + ' ' + (error.hint || '') + ' ' + (error.details || '');
        if (msg.includes('CAPACITY_FULL') || msg.toLowerCase().includes('voll')) {
            setzeFormularFehler('Diese Schicht ist inzwischen leider voll geworden. Bitte wähl eine andere.');
            await ladePublicSignups();
            rendereSchichten();
        } else {
            console.error('signup insert failed', error);
            setzeFormularFehler('Der Eintrag konnte nicht gespeichert werden. Bitte erneut versuchen.');
        }
        return;
    }

    if (email) void sendeMailBestaetigung(signupId);

    await ladePublicSignups();
    rendereSchichten();
    setzeSubmitLoading(false);
    // Signup-Modal ausblenden, dann Erfolgs-Dialog mit Kalender-Buttons zeigen
    document.getElementById('signup-modal').hidden = true;
    zeigeErfolgModal(schicht, !!email);
}

async function sendeMailBestaetigung(signupId) {
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/send-signup-confirmation`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                signup_id: signupId,
                unsubscribe_url_base: window.location.origin + window.location.pathname.replace(/[^\/]*$/, 'index.html'),
            }),
        });
        if (!res.ok) console.warn('[Bestaetigungsmail] Versand fehlgeschlagen', res.status, await res.text());
    } catch (e) {
        console.warn('[Bestaetigungsmail] Fetch-Fehler', e);
    }
}

// ---------- Selbst-Abmelden ----------

let pendingUnsub = null; // {signup_id, token}

function pruefeAbmeldeLink() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('abmelden');
    const token = params.get('t');
    if (!id || !token) return;
    pendingUnsub = { signup_id: id, token };
    const modal = document.getElementById('unsubscribe-modal');
    document.getElementById('unsub-error').hidden = true;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function initAbmeldeButton() {
    document.getElementById('unsub-confirm').addEventListener('click', async () => {
        if (!pendingUnsub) return;
        const errBox = document.getElementById('unsub-error');
        errBox.hidden = true;
        const btn = document.getElementById('unsub-confirm');
        btn.disabled = true; btn.textContent = 'Wird ausgetragen …';
        const { data, error } = await supabase.rpc('delete_signup', {
            p_signup_id: pendingUnsub.signup_id,
            p_token:     pendingUnsub.token,
        });
        btn.disabled = false; btn.textContent = 'Ja, austragen';
        if (error) {
            console.error('delete rpc failed', error);
            errBox.textContent = 'Abmelden nicht möglich. Bitte per Telefon melden.';
            errBox.hidden = false;
            return;
        }
        if (data === false) {
            errBox.textContent = 'Dieser Eintrag wurde bereits ausgetragen oder der Link ist ungültig.';
            errBox.hidden = false;
            return;
        }
        pendingUnsub = null;
        schliesseModal();
        // URL-Parameter entfernen
        history.replaceState({}, '', window.location.pathname);
        await ladePublicSignups();
        rendereSchichten();
        zeigeToast('Du bist ausgetragen. Danke für die Rückmeldung!');
    });
}

// ---------- Kalender (ICS + Google) ----------

function icsDatumFuer(schicht) {
    const [y, m, d] = schicht.shift_date.split('-');
    const [h1, min1] = trimmeUhrzeit(schicht.start_time).split(':');
    const [h2, min2] = trimmeUhrzeit(schicht.end_time).split(':');
    let endY = y, endM = m, endD = d;
    if (schicht.ends_next_day) {
        const dt = new Date(Number(y), Number(m) - 1, Number(d));
        dt.setDate(dt.getDate() + 1);
        endY = String(dt.getFullYear());
        endM = String(dt.getMonth() + 1).padStart(2, '0');
        endD = String(dt.getDate()).padStart(2, '0');
    }
    return {
        start: `${y}${m}${d}T${h1}${min1}00`,
        end:   `${endY}${endM}${endD}T${h2}${min2}00`,
    };
}

function baueIcs(schicht) {
    const { start, end } = icsDatumFuer(schicht);
    const now = new Date();
    const dtstamp =
        now.getUTCFullYear().toString() +
        String(now.getUTCMonth() + 1).padStart(2, '0') +
        String(now.getUTCDate()).padStart(2, '0') + 'T' +
        String(now.getUTCHours()).padStart(2, '0') +
        String(now.getUTCMinutes()).padStart(2, '0') +
        String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
    const uid = `signup-${crypto.randomUUID()}@st-sebastian-schichtplan.de`;
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Puettage-Helferplan//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;TZID=Europe/Berlin:${start}`,
        `DTEND;TZID=Europe/Berlin:${end}`,
        'SUMMARY:Bierwagen-Schicht Püttage 2026',
        'DESCRIPTION:Deine Schicht am Bierwagen bei den Beckumer Püttagen 2026.',
        'LOCATION:Beckum',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}

function baueGoogleUrl(schicht) {
    const { start, end } = icsDatumFuer(schicht);
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: 'Bierwagen-Schicht Püttage 2026',
        dates: `${start}/${end}`,
        details: 'Deine Schicht am Bierwagen bei den Beckumer Püttagen 2026.',
        location: 'Beckum',
        ctz: 'Europe/Berlin',
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function ladeICSDownload(schicht) {
    const ics = baueIcs(schicht);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bierwagen-${schicht.shift_date}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------- Erfolgs-Dialog ----------

function zeigeErfolgModal(schicht, mitMail) {
    document.getElementById('success-shift').textContent =
        `${formatiereTagKopf(schicht.shift_date)}, ${schichtLabel(schicht)}`;
    document.getElementById('success-mailhint').hidden = !mitMail;
    document.getElementById('cal-google').href = baueGoogleUrl(schicht);

    document.getElementById('cal-download').onclick = () => ladeICSDownload(schicht);
    document.getElementById('success-close').onclick = () => schliesseModal();

    const modal = document.getElementById('success-modal');
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
}

function initErfolgModal() {
    const modal = document.getElementById('success-modal');
    modal.querySelector('.modal__close').addEventListener('click', schliesseModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) schliesseModal(); });
}

// ---------- Toast ----------

let toastTimer = null;
function zeigeToast(text, variante = 'ok') {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.classList.toggle('toast--error', variante === 'error');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
}

// ---------- Start ----------

async function startApp() {
    if (zustand.appGestartet) return;
    zustand.appGestartet = true;

    initModalSteuerung();
    initFormular();
    initAbmeldeButton();
    initErfolgModal();
    ladeTexte();

    try {
        await Promise.all([ladeSchichten(), ladePublicSignups()]);
        rendereSchichten();
    } catch (err) {
        console.error('[start] Ladefehler', err);
        zeigePlanFehler('Schichten konnten nicht geladen werden. Bitte später erneut versuchen.');
    }

    pruefeAbmeldeLink();
}

initGate();
