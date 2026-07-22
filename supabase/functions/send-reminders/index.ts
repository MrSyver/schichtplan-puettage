// ============================================================
// Supabase Edge Function: send-reminders
// ============================================================
// Wird stuendlich per pg_cron aufgerufen. Sucht alle Signups mit
// remind_via_email=true und E-Mail, deren Schicht in ~24 h beginnt
// (Fenster: 23–25 h vor Schichtstart, Europe/Berlin), und sendet
// eine Erinnerungsmail. Idempotent: reminder_sent_at wird gesetzt.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WOCHENTAG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

function formatDatum(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return `${WOCHENTAG[d.getUTCDay()]}, ${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}
function hhmm(t: string): string { return t.slice(0, 5); }
function esc(s: string): string {
    return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST')    return new Response('method not allowed', { status: 405, headers: CORS });

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Puettage Helfer <onboarding@resend.dev>';
    const MAIL_REPLY_TO  = Deno.env.get('MAIL_REPLY_TO') ?? '';
    const SUPABASE_URL   = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Missing env vars');
        return new Response(JSON.stringify({ ok: false, error: 'config_missing' }), {
            status: 500, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Alle unversendeten Reminder + zugehoerige Shift laden
    const { data: pending, error } = await admin
        .from('signups')
        .select('id, name, email, delete_token, shifts!inner(id, shift_date, start_time, end_time)')
        .eq('remind_via_email', true)
        .is('reminder_sent_at', null)
        .not('email', 'is', null);

    if (error) {
        console.error('lookup failed', error);
        return new Response(JSON.stringify({ ok: false, error: 'lookup_failed' }), {
            status: 500, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const now = Date.now();
    const WINDOW_LOW  = 23 * 60 * 60 * 1000;
    const WINDOW_HIGH = 25 * 60 * 60 * 1000;

    // Europe/Berlin-Offset heuristisch: DST-Faustregel Sept = +2h
    // Wir verwenden Intl.DateTimeFormat, um die Zeitzone korrekt umzurechnen.
    function shiftStartUtc(shift_date: string, start_time: string): number {
        // Konstruiere "YYYY-MM-DD HH:MM:00" in Berlin, dann konvertiere zu UTC
        const localDateStr = `${shift_date}T${start_time}`;
        // Trick: parse als UTC, dann Berlin-Offset abziehen
        const asUtc = Date.parse(localDateStr + 'Z');
        // Berlin-Offset zu diesem Datum ermitteln:
        const dtf = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Berlin',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hour12: false,
        });
        const parts = dtf.formatToParts(new Date(asUtc)).reduce((acc: Record<string,string>, p) => {
            if (p.type !== 'literal') acc[p.type] = p.value;
            return acc;
        }, {});
        // parts sind lokale Zeit in Berlin an dem UTC-Zeitpunkt asUtc
        const asBerlin = Date.UTC(
            Number(parts.year), Number(parts.month) - 1, Number(parts.day),
            Number(parts.hour), Number(parts.minute), Number(parts.second),
        );
        const offset = asBerlin - asUtc; // Berlin-UTC-Offset in ms
        return asUtc - offset; // Der UTC-Zeitpunkt, der genau "localDateStr Berlin" entspricht
    }

    let sent = 0, skipped = 0, failed = 0;
    for (const s of pending ?? []) {
        const sh = (s as any).shifts;
        if (!sh) { skipped++; continue; }
        const startUtc = shiftStartUtc(sh.shift_date as string, sh.start_time as string);
        const delta = startUtc - now;
        if (delta < WINDOW_LOW || delta > WINDOW_HIGH) { skipped++; continue; }

        const dateStr = formatDatum(sh.shift_date as string);
        const zeitStr = `${hhmm(sh.start_time as string)}–${hhmm(sh.end_time as string)}`;
        const subject = `Erinnerung: Morgen ist deine Bierwagen-Schicht`;

        const urlBase = 'https://mrsyver.github.io/schichtplan-puettage/'; // Fallback fuer Abmelde-Link
        const unsubUrl = `${urlBase}?abmelden=${encodeURIComponent(s.id as string)}&t=${encodeURIComponent(s.delete_token as string)}`;

        const text =
`Horrido ${s.name},

nur zur Erinnerung: morgen ist deine Bierwagen-Schicht bei den Beckumer Püttagen 2026!

    ${dateStr}
    ${zeitStr}

Wir freuen uns auf dich.

Falls du kurzfristig doch nicht kannst:
${unsubUrl}

Danke für deine Unterstützung!
Horrido und bis morgen,
Familie Martin`;

        const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.5; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 12px;">Horrido ${esc(s.name as string)}! Morgen ist deine Schicht 🍺</h2>
    <p>Nur zur Erinnerung: morgen ist deine Bierwagen-Schicht bei den <strong>Beckumer Püttagen 2026</strong>:</p>
    <div style="background:#FBE9EC; border-left:4px solid #C8102E; padding:14px 18px; border-radius:8px; margin:16px 0;">
        <div style="font-weight:600; font-size:1.05rem;">${esc(dateStr)}</div>
        <div style="font-variant-numeric:tabular-nums;">${esc(zeitStr)}</div>
    </div>
    <p>Wir freuen uns auf dich!</p>
    <p style="margin:20px 0;"><a href="${esc(unsubUrl)}" style="color:#64748B; font-size:0.85rem; text-decoration:underline;">Doch nicht können? Hier austragen.</a></p>
    <p style="margin-top:24px;">Danke für deine Unterstützung!<br>Horrido und bis morgen,<br><strong>Familie Martin</strong></p>
</body></html>`;

        const payload: Record<string, unknown> = { from: MAIL_FROM, to: [s.email], subject, text, html };
        if (MAIL_REPLY_TO) payload.reply_to = MAIL_REPLY_TO;

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error('Resend error for', s.email, res.status, errText);
            failed++;
            continue;
        }

        await admin.from('signups').update({ reminder_sent_at: new Date().toISOString() }).eq('id', s.id);
        sent++;
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped, failed, pending_total: pending?.length ?? 0 }), {
        headers: { ...CORS, 'content-type': 'application/json' },
    });
});
