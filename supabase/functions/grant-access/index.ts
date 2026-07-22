// ============================================================
// Supabase Edge Function: grant-access
// ============================================================
// Wird vom Admin geklickt (Link in der Zugriffs-Anfrage-Mail).
// Empfaengt GET mit ?email=…&expires=…&sig=… (HMAC-signiert vom
// send-access-request-Endpoint). Bei gueltiger Signatur: schickt
// das Passwort per Resend an <email> und zeigt eine Erfolgsseite.
//
// Env vars:
//   RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO
//   GRANT_TOKEN_SECRET   (HMAC-Geheimnis, mit send-access-request geteilt)
//   GATE_PASSWORD        (das eigentliche Zugangspasswort, z. B. "Püttage")
// verify_jwt: false (Browser-Klick aus Mail, ohne Auth-Header)
// ============================================================

const encoder = new TextEncoder();

function esc(s: string): string {
    return s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

async function importHmacKey(secret: string) {
    return await crypto.subtle.importKey(
        'raw', encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign', 'verify'],
    );
}

function toHex(buf: ArrayBuffer): string {
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
    const m = hex.match(/.{2}/g);
    if (!m) return new Uint8Array();
    return new Uint8Array(m.map(h => parseInt(h, 16)));
}

async function verifyHmac(msg: string, sigHex: string, secret: string): Promise<boolean> {
    try {
        const key = await importHmacKey(secret);
        return await crypto.subtle.verify('HMAC', key, fromHex(sigHex), encoder.encode(msg));
    } catch {
        return false;
    }
}

function htmlPage(status: number, title: string, body: string): Response {
    const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, system-ui, sans-serif; background: #F7F7F8; color: #0F172A; margin: 0; padding: 3rem 1rem; }
  .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 2rem; box-shadow: 0 8px 24px rgba(15,23,42,0.08); text-align: center; }
  h1 { margin: 0 0 0.75rem; color: #0F172A; }
  p  { color: #475569; line-height: 1.55; }
  .icon { font-size: 3rem; margin-bottom: 0.5rem; }
  .err { color: #DC2626; }
</style></head>
<body><div class="card">${body}</div></body></html>`;
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req: Request) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return htmlPage(405, 'Nicht erlaubt', `<div class="icon">✗</div><h1>Methode nicht erlaubt</h1>`);
    }

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const MAIL_FROM      = Deno.env.get('MAIL_FROM') ?? 'Helferplan St. Sebastian <helfer@st-sebastian-schichtplan.de>';
    const MAIL_REPLY_TO  = Deno.env.get('MAIL_REPLY_TO') ?? '';
    const SECRET         = Deno.env.get('GRANT_TOKEN_SECRET');
    const PASSWORD       = Deno.env.get('GATE_PASSWORD');

    if (!RESEND_API_KEY || !SECRET || !PASSWORD) {
        console.error('Missing env vars');
        return htmlPage(500, 'Fehler', `<div class="icon err">✗</div><h1 class="err">Server-Konfiguration unvollständig</h1><p>Bitte in den Function-Secrets prüfen.</p>`);
    }

    const url = new URL(req.url);
    const email   = url.searchParams.get('email')   ?? '';
    const expires = url.searchParams.get('expires') ?? '';
    const sig     = url.searchParams.get('sig')     ?? '';

    if (!email || !expires || !sig) {
        return htmlPage(400, 'Link unvollständig', `<div class="icon err">✗</div><h1 class="err">Ungültiger Link</h1><p>Der Link ist unvollständig oder abgeschnitten.</p>`);
    }
    if (Date.now() > Number(expires)) {
        return htmlPage(400, 'Link abgelaufen', `<div class="icon err">⌛</div><h1 class="err">Link abgelaufen</h1><p>Bitte den Anfrager erneut anfragen lassen.</p>`);
    }
    const msg = `${email}|${expires}`;
    if (!(await verifyHmac(msg, sig, SECRET))) {
        return htmlPage(400, 'Signatur ungültig', `<div class="icon err">✗</div><h1 class="err">Link ungültig</h1><p>Signatur stimmt nicht. Der Link wurde ggf. manipuliert.</p>`);
    }

    // Passwort per Resend an die anfragende Person senden
    const subject = 'Dein Zugang zum Helferplan Bierwagen';
    const text =
`Horrido,

hier das Passwort für den Helferplan:

    ${PASSWORD}

Öffne dazu https://st-sebastian-schichtplan.de/ und trag dich in eine Schicht ein.

Bis zum Fest,
Familie Martin`;

    const html = `<!doctype html>
<html lang="de"><body style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; color:#0F172A; line-height:1.5; max-width:520px; margin:0 auto; padding:24px;">
    <h2 style="color:#0F172A; margin:0 0 12px;">Horrido!</h2>
    <p>Hier das Passwort für den Helferplan:</p>
    <div style="background:#FBE9EC; border-left:4px solid #C8102E; padding:14px 18px; border-radius:8px; margin:16px 0; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:1.15rem; font-weight:600; letter-spacing:0.05em;">${esc(PASSWORD)}</div>
    <p><a href="https://st-sebastian-schichtplan.de/" style="display:inline-block; padding:10px 18px; background:#C8102E; color:#fff; border-radius:8px; text-decoration:none; font-weight:600;">Zum Helferplan</a></p>
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
        return htmlPage(502, 'Versand fehlgeschlagen', `<div class="icon err">✗</div><h1 class="err">Mail-Versand fehlgeschlagen</h1><p>Bitte manuell antworten. Details in Function-Logs.</p>`);
    }

    return htmlPage(200, 'Passwort gesendet',
        `<div class="icon">✅</div>
         <h1>Passwort verschickt</h1>
         <p>Wir haben das Passwort per E-Mail an <strong>${esc(email)}</strong> gesendet.</p>`);
});
