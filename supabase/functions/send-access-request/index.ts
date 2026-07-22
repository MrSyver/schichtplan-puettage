// ============================================================
// Supabase Edge Function: send-access-request
// ============================================================
// Wird vom Passwort-Gate aufgerufen. Sendet Info-Mail an Betreiber
// (MAIL_REPLY_TO) mit „Passwort verschicken"-Button (HMAC-Link auf
// grant-access). Rate-Limit: 15 Anfragen pro Stunde global.
//
// Env: RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO, GRANT_TOKEN_SECRET,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_REQUESTS_PER_HOUR_GLOBAL = 15;
const GRANT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 Tage
const encoder = new TextEncoder();

function esc(s: string): string {
    return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

async function signHmac(msg: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(msg));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST')    return new Response('method not allowed', { status: 405, headers: CORS });

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Helferplan St. Sebastian <helfer@st-sebastian-schichtplan.de>';
    const RECIPIENT      = Deno.env.get('MAIL_REPLY_TO');
    const SUPABASE_URL   = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const GRANT_SECRET   = Deno.env.get('GRANT_TOKEN_SECRET');

    if (!RESEND_API_KEY || !RECIPIENT || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GRANT_SECRET) {
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

    // Rate-Limit-Check: globales Fenster
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

    // Anfrage protokollieren (fuer Rate-Limit); alte Zeilen aufraeumen
    await admin.from('access_requests').insert({ email });
    await admin.from('access_requests').delete().lt('requested_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    // HMAC-signierten Grant-Link erzeugen (Passwort automatisch versenden bei Klick)
    const expires = Date.now() + GRANT_TOKEN_TTL_MS;
    const sig = await signHmac(`${email}|${expires}`, GRANT_SECRET);
    const grantUrl = `${SUPABASE_URL}/functions/v1/grant-access?email=${encodeURIComponent(email)}&expires=${expires}&sig=${sig}`;

    const subject = `Zugriffs-Anfrage: ${name || email}`;
    const text =
`Neue Anfrage fuer den Zugriff auf den Helferplan:

  Name:  ${name || '(nicht angegeben)'}
  Mail:  ${email}

Klicke auf folgenden Link, um das Passwort per Mail an ${email} zu senden:
${grantUrl}

Der Link ist 7 Tage gueltig.`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.55; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 8px;">Neue Zugriffs-Anfrage</h2>
    <ul style="background:#F7F7F8; padding:14px 22px; border-radius:8px; list-style:none; margin:0;">
        <li style="margin-bottom:4px;"><strong>Name:</strong> ${esc(name || '(nicht angegeben)')}</li>
        <li><strong>E-Mail:</strong> <a href="mailto:${esc(email)}">${esc(email)}</a></li>
    </ul>
    <p style="margin-top:20px;">Ein Klick auf den Button unten schickt dieser Person das Passwort automatisch per Mail:</p>
    <p style="margin:16px 0 8px;">
        <a href="${esc(grantUrl)}" style="display:inline-block; padding:12px 22px; background:#C8102E; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">
            Passwort an ${esc(email)} senden
        </a>
    </p>
    <p style="color:#64748B; font-size:0.85rem; margin-top:8px;">Der Link ist 7 Tage gültig. Ohne Klick passiert nichts.</p>
    <hr style="border:none; border-top:1px solid #E2E8F0; margin:24px 0 12px;">
    <p style="color:#94A3B8; font-size:0.8rem;">Falls du der Person NICHT das Passwort geben willst: einfach diese Mail ignorieren. Ohne Klick wird nichts versendet.</p>
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
