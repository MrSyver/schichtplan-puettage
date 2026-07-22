// ============================================================
// Supabase Edge Function: notify-deletion
// ============================================================
// Wird vom AFTER-DELETE-Trigger auf signups aufgerufen (via pg_net).
// Schickt eine Info-Mail an MAIL_REPLY_TO (Betreiber), sobald sich
// jemand austraegt oder ausgetragen wird.
//
// TRUNCATE feuert keinen ROW-DELETE-Trigger – d. h. Auto-Delete am
// 04.10.2026 und der Admin "Alle loeschen" (RPC admin_delete_all_signups
// nutzt TRUNCATE) loesen KEINE Info-Mail aus.
//
// Env vars: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO
// verify_jwt: true (mit Anon-Key aufgerufen)
// ============================================================

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
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Helferplan St. Sebastian <helfer@st-sebastian-schichtplan.de>';
    const RECIPIENT      = Deno.env.get('MAIL_REPLY_TO');

    if (!RESEND_API_KEY || !RECIPIENT) {
        console.error('Missing env vars');
        return new Response(JSON.stringify({ ok: false, error: 'config_missing' }), {
            status: 500, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    let body: {
        name?: string;
        email?: string | null;
        phone?: string | null;
        show_name_publicly?: boolean;
        shift_date?: string;
        start_time?: string;
        end_time?: string;
    };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }

    const name  = (body.name  ?? 'Unbekannt').toString();
    const email = body.email ?? '';
    const phone = body.phone ?? '';
    const dateStr = body.shift_date ? formatDatum(body.shift_date) : 'unbekannter Tag';
    const zeitStr = body.start_time && body.end_time
        ? `${hhmm(body.start_time)}–${hhmm(body.end_time)}`
        : '';
    const sichtbar = body.show_name_publicly ? 'öffentlich' : 'anonym';
    const kontakt = [email, phone].filter(Boolean).join(' · ') || 'keine Kontaktdaten hinterlegt';

    const subject = `Abmeldung: ${name} · ${dateStr}`;
    const text =
`Info: Eine Person hat sich vom Helferplan ausgetragen.

  Name:      ${name} (${sichtbar})
  Schicht:   ${dateStr}${zeitStr ? ', ' + zeitStr : ''}
  Kontakt:   ${kontakt}

Falls du der Person nachhaken willst, kontaktiere sie direkt.`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.55; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 8px;">Abmeldung im Helferplan</h2>
    <p style="color:#64748B;">Eine Person hat sich gerade aus einer Schicht ausgetragen.</p>
    <ul style="background:#F7F7F8; padding:14px 22px; border-radius:8px; list-style:none; margin:12px 0;">
        <li style="margin-bottom:4px;"><strong>Name:</strong> ${esc(name)} <span style="color:#64748B; font-size:0.85rem;">(${sichtbar})</span></li>
        <li style="margin-bottom:4px;"><strong>Schicht:</strong> ${esc(dateStr)}${zeitStr ? ', ' + esc(zeitStr) : ''}</li>
        <li><strong>Kontakt:</strong> ${esc(kontakt)}</li>
    </ul>
    <p style="color:#94A3B8; font-size:0.85rem;">Falls du nachfragen willst, kontaktiere die Person direkt.</p>
</body></html>`;

    const payload: Record<string, unknown> = {
        from: MAIL_FROM,
        to: [RECIPIENT],
        subject, text, html,
    };

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
