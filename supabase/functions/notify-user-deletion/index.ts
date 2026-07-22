// ============================================================
// Supabase Edge Function: notify-user-deletion
// ============================================================
// Wird vom AFTER-DELETE-Trigger aufgerufen, wenn die ausgetragene
// Person eine E-Mail hinterlegt hatte. Zwei Fassungen:
//   source = 'self'  -> Bestaetigung „Deine Abmeldung ist raus"
//   source = 'other' -> Info „Du wurdest aus der Schicht ausgetragen"
//
// Env vars: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO
// verify_jwt: true (mit Anon-Key aufgerufen)
// ============================================================

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WOCHENTAG = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

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
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Helferplan St. Sebastian <helfer@st-sebastian-schichtplan.de>';
    const MAIL_REPLY_TO  = Deno.env.get('MAIL_REPLY_TO') ?? '';

    if (!RESEND_API_KEY) {
        return new Response(JSON.stringify({ ok: false, error: 'config_missing' }), {
            status: 500, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    let body: {
        name?: string;
        email?: string | null;
        shift_date?: string;
        start_time?: string;
        end_time?: string;
        source?: 'self' | 'other';
    };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }

    const email = (body.email ?? '').toString().trim();
    if (!email) {
        return new Response(JSON.stringify({ ok: true, skipped: 'no_email' }), {
            headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const name    = (body.name ?? '').toString();
    const dateStr = body.shift_date ? formatDatum(body.shift_date) : 'deiner Schicht';
    const zeitStr = body.start_time && body.end_time
        ? `${hhmm(body.start_time)}–${hhmm(body.end_time)}`
        : '';
    const isSelf  = body.source === 'self';

    const subject = isSelf
        ? `Abmeldung bestätigt · ${dateStr}`
        : `Info: Du wurdest aus der Schicht ausgetragen (${dateStr})`;

    const einleitung = isSelf
        ? 'deine Abmeldung ist raus – wir haben dich aus der folgenden Schicht ausgetragen:'
        : 'jemand hat dich gerade aus dieser Schicht ausgetragen:';

    const nachtext = isSelf
        ? 'Falls das ein Versehen war, kannst du dich jederzeit wieder eintragen: https://st-sebastian-schichtplan.de/'
        : 'Falls das ein Versehen war oder du davon nichts wusstest, meld dich bitte kurz bei uns – Kontakt findest du auf der Seite. Und wenn du weiter dabei sein willst, trag dich einfach wieder ein: https://st-sebastian-schichtplan.de/';

    const text =
`Horrido ${name},

${einleitung}

    ${dateStr}${zeitStr ? ', ' + zeitStr : ''}

${nachtext}

Bis zum Fest,
Familie Martin`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.55; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 10px;">Horrido ${esc(name)},</h2>
    <p>${esc(einleitung)}</p>
    <div style="background:#FBE9EC; border-left:4px solid #C8102E; padding:14px 18px; border-radius:8px; margin:14px 0;">
        <div style="font-weight:600; font-size:1.05rem;">${esc(dateStr)}</div>
        ${zeitStr ? `<div style="font-variant-numeric:tabular-nums;">${esc(zeitStr)}</div>` : ''}
    </div>
    <p>${isSelf
        ? 'Falls das ein Versehen war, kannst du dich jederzeit wieder eintragen:'
        : 'Falls das ein Versehen war oder du davon nichts wusstest, meld dich bitte kurz bei uns – die Kontakte findest du auf der Seite. Und wenn du weiter dabei sein willst:'}</p>
    <p style="margin:12px 0;">
        <a href="https://st-sebastian-schichtplan.de/" style="display:inline-block; padding:10px 18px; background:#C8102E; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">Zum Helferplan</a>
    </p>
    <p style="margin-top:24px;">Bis zum Fest,<br><strong>Familie Martin</strong></p>
</body></html>`;

    const payload: Record<string, unknown> = {
        from: MAIL_FROM,
        to: [email],
        subject, text, html,
    };
    if (MAIL_REPLY_TO) payload.reply_to = MAIL_REPLY_TO;

    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const t = await res.text();
        console.error('Resend send failed', res.status, t);
        return new Response(JSON.stringify({ ok: false, error: 'mail_failed', status: res.status }), {
            status: 502, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }
    const data = await res.json();
    return new Response(JSON.stringify({ ok: true, id: data.id }), {
        headers: { ...CORS, 'content-type': 'application/json' },
    });
});
