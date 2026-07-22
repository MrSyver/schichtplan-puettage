// ============================================================
// Supabase Edge Function: send-access-request
// ============================================================
// Wird vom Passwort-Gate aufgerufen. Sendet eine Info-Mail an den
// Betreiber (MAIL_REPLY_TO). Rate-Limit: max 3 Anfragen pro
// E-Mail-Adresse innerhalb einer Stunde.
//
// Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Globales Limit ueber ALLE Anfragen (Anti-Spam/DoS).
// 15 Anfragen pro Stunde ist reichlich fuer einen Verein und stoppt Bots.
const MAX_REQUESTS_PER_HOUR_GLOBAL = 15;

function esc(s: string): string {
    return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST')    return new Response('method not allowed', { status: 405, headers: CORS });

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Puettage Helfer <onboarding@resend.dev>';
    const RECIPIENT      = Deno.env.get('MAIL_REPLY_TO');
    const SUPABASE_URL   = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!RESEND_API_KEY || !RECIPIENT || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        console.error('Missing env vars');
        return new Response(JSON.stringify({ ok: false, error: 'config_missing' }), {
            status: 500, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    let body: { email?: string; name?: string };
    try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }

    const email = (body.email ?? '').toString().trim().toLowerCase().slice(0, 120);
    const name  = (body.name  ?? '').toString().trim().slice(0, 80);

    if (!email || !/^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/.test(email)) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid_email' }), {
            status: 400, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Rate-Limit-Check: globales Fenster - wie viele Anfragen in der letzten Stunde ueberhaupt?
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: cntErr } = await admin
        .from('access_requests')
        .select('id', { count: 'exact', head: true })
        .gte('requested_at', oneHourAgo);

    if (cntErr) {
        console.error('rate-limit lookup failed', cntErr);
    } else if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR_GLOBAL) {
        return new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), {
            status: 429, headers: { ...CORS, 'content-type': 'application/json' },
        });
    }

    // Anfrage protokollieren (fuer Rate-Limit); alte Zeilen (>24h) opportunistisch aufraeumen
    await admin.from('access_requests').insert({ email });
    await admin.from('access_requests').delete().lt('requested_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    const subject = `Zugriffs-Anfrage Puettage-Helferplan${name ? ` (${name})` : ''}`;
    const text =
`Neue Anfrage fuer den Zugriff auf den Helferplan:

  E-Mail: ${email}
  Name:   ${name || '(nicht angegeben)'}

Antworte dieser Person mit dem Passwort.`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.5; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 8px;">Zugriffs-Anfrage Puettage-Helferplan</h2>
    <ul style="background:#F7F7F8; padding:14px 24px; border-radius:8px;">
        <li><strong>E-Mail:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></li>
        <li><strong>Name:</strong> ${esc(name || '(nicht angegeben)')}</li>
    </ul>
    <p>Antworte dieser Person mit dem Passwort.</p>
</body></html>`;

    const payload: Record<string, unknown> = {
        from: MAIL_FROM,
        to: [RECIPIENT],
        subject, text, html,
        reply_to: email,
    };

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
