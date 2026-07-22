// ============================================================
// Supabase Edge Function: send-signup-confirmation
// ============================================================
// Wird nach erfolgreichem Insert vom Client aufgerufen. Sendet via
// Resend eine Bestaetigungsmail inkl. Abmelde-Link an die
// eingetragene E-Mail. Ohne E-Mail: kein Versand, kein Fehler.
//
// Erforderliche Env vars:
//   RESEND_API_KEY, MAIL_FROM, optional MAIL_REPLY_TO
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
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

function icsDates(shift_date: string, start_time: string, end_time: string, endsNextDay: boolean) {
    const [y, m, d] = shift_date.split('-');
    const h1 = start_time.slice(0, 2), min1 = start_time.slice(3, 5);
    const h2 = end_time.slice(0, 2),   min2 = end_time.slice(3, 5);
    let endY = y, endM = m, endD = d;
    if (endsNextDay) {
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

function buildIcs(uid: string, shift_date: string, start_time: string, end_time: string, endsNextDay: boolean): string {
    const { start, end } = icsDates(shift_date, start_time, end_time, endsNextDay);
    const now = new Date();
    const dtstamp =
        now.getUTCFullYear().toString() +
        String(now.getUTCMonth() + 1).padStart(2, '0') +
        String(now.getUTCDate()).padStart(2, '0') + 'T' +
        String(now.getUTCHours()).padStart(2, '0') +
        String(now.getUTCMinutes()).padStart(2, '0') +
        String(now.getUTCSeconds()).padStart(2, '0') + 'Z';
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

function googleUrl(shift_date: string, start_time: string, end_time: string, endsNextDay: boolean): string {
    const { start, end } = icsDates(shift_date, start_time, end_time, endsNextDay);
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

function toBase64(str: string): string {
    // btoa mit UTF-8-Safe
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
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

    let body: { signup_id?: string; unsubscribe_url_base?: string };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }

    const signup_id = body.signup_id;
    if (!signup_id || typeof signup_id !== 'string') {
        return new Response('missing signup_id', { status: 400, headers: CORS });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: signup, error: sErr } = await admin
        .from('signups')
        .select('id, name, email, shift_id, delete_token, created_at')
        .eq('id', signup_id)
        .maybeSingle();

    if (sErr) {
        console.error('signup lookup failed', sErr);
        return new Response('lookup failed', { status: 500, headers: CORS });
    }
    if (!signup) {
        return new Response(JSON.stringify({ ok: false, error: 'not_found' }), {
            status: 404, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }
    if (!signup.email) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_email' }), {
            headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const ageMs = Date.now() - new Date(signup.created_at as string).getTime();
    if (ageMs > 5 * 60 * 1000) {
        return new Response(JSON.stringify({ ok: false, error: 'too_old' }), {
            status: 403, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const { data: shift, error: shErr } = await admin
        .from('shifts')
        .select('shift_date, start_time, end_time, ends_next_day')
        .eq('id', signup.shift_id)
        .maybeSingle();

    if (shErr || !shift) {
        console.error('shift lookup failed', shErr);
        return new Response('shift lookup failed', { status: 500, headers: CORS });
    }

    const dateStr = formatDatum(shift.shift_date as string);
    const zeitStr = `${hhmm(shift.start_time as string)}–${hhmm(shift.end_time as string)}`;
    const subject = `Danke fürs Eintragen – ${dateStr}, ${zeitStr}`;

    const urlBase = (body.unsubscribe_url_base || '').replace(/[?#].*$/, '');
    const unsubUrl = urlBase
        ? `${urlBase}?abmelden=${encodeURIComponent(signup.id as string)}&t=${encodeURIComponent(signup.delete_token as string)}`
        : '';

    const gcalUrl = googleUrl(
        shift.shift_date as string,
        shift.start_time as string,
        shift.end_time   as string,
        !!shift.ends_next_day,
    );
    // Kalender-Button-URL: liefert ICS-Datei aus der ics-Function; iPhone/Safari
    // erkennt text/calendar und oeffnet direkt Apple Kalender.
    const icsUrl = `${SUPABASE_URL}/functions/v1/ics?signup=${encodeURIComponent(signup.id as string)}&t=${encodeURIComponent(signup.delete_token as string)}`;

    const text =
`Horrido ${signup.name},

vielen Dank fürs Eintragen! Deine Helfer-Schicht am Bierwagen bei den Beckumer Püttagen 2026:

    ${dateStr}
    ${zeitStr}

In den Kalender:
- Apple/iPhone/Outlook: ${icsUrl}
- Google Calendar:      ${gcalUrl}

Du bist auf der Liste. Solltest du nicht können, kein Problem. Melde dich nur bitte rechtzeitig ab:
${unsubUrl || '[Abmelden per Antwort auf diese Mail]'}

Bis zum Fest,
Familie Martin

--
Diese Mail wurde automatisch versendet, weil deine E-Mail-Adresse beim Eintragen angegeben wurde.`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.5; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 12px;">Horrido ${esc(signup.name as string)}!</h2>
    <p>Vielen Dank fürs Eintragen. Deine Helfer-Schicht am Bierwagen bei den <strong>Püttagen 2026</strong> ist gebucht:</p>
    <div style="background:#FBE9EC; border-left:4px solid #C8102E; padding:14px 18px; border-radius:8px; margin:16px 0;">
        <div style="font-weight:600; font-size:1.05rem;">${esc(dateStr)}</div>
        <div style="font-variant-numeric:tabular-nums;">${esc(zeitStr)}</div>
    </div>
    <p style="margin:20px 0 8px; font-weight:600;">In deinen Kalender speichern:</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin:0 0 8px;">
        <tr>
            <td style="padding:0 8px 8px 0;">
                <a href="${esc(icsUrl)}" style="display:inline-block; padding:10px 18px; background:#0F172A; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">📅 Apple / iPhone / Outlook</a>
            </td>
            <td style="padding:0 0 8px 0;">
                <a href="${esc(gcalUrl)}" style="display:inline-block; padding:10px 18px; background:#1A73E8; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">🗓 Google Calendar</a>
            </td>
        </tr>
    </table>
    <p style="color:#64748B; font-size:0.8rem; margin:0 0 24px;">Auf dem iPhone öffnet der erste Button den Kalender direkt.</p>

    <hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0 20px;">

    <p style="font-weight:600; margin:0 0 8px;">Du kannst nicht?</p>
    <p style="margin:0 0 12px; color:#475569;">Kein Problem – melde dich nur bitte rechtzeitig ab, damit wir jemand anderes anfragen können.</p>
    ${unsubUrl
        ? `<p style="margin:0 0 24px;"><a href="${esc(unsubUrl)}" style="display:inline-block; padding:10px 18px; background:#F1F2F4; color:#0F172A; border-radius:8px; text-decoration:none; border:1px solid #CBD5E1; font-weight:600;">Aus dieser Schicht austragen</a></p>`
        : `<p style="margin:0 0 24px; color:#64748B;">Zum Abmelden einfach kurz auf diese E-Mail antworten.</p>`}

    <p style="margin-top:24px;">Bis zum Fest,<br><strong>Familie Martin</strong></p>
    <hr style="border:none; border-top:1px solid #E2E8F0; margin:32px 0 12px;">
    <p style="color:#64748B; font-size:0.8125rem;">Diese Mail wurde automatisch versendet, weil deine E-Mail-Adresse beim Eintragen angegeben wurde.</p>
</body></html>`;

    const payload: Record<string, unknown> = {
        from: MAIL_FROM,
        to: [signup.email],
        subject, text, html,
    };
    if (MAIL_REPLY_TO) payload.reply_to = MAIL_REPLY_TO;

    const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!resendRes.ok) {
        const errText = await resendRes.text();
        console.error('Resend error', resendRes.status, errText);
        return new Response(JSON.stringify({ ok: false, error: 'mail_failed', status: resendRes.status }), {
            status: 502, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const resendData = await resendRes.json();
    return new Response(JSON.stringify({ ok: true, id: resendData.id }), {
        headers: { ...CORS, 'content-type': 'application/json' },
    });
});
