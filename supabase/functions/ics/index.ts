// ============================================================
// Supabase Edge Function: ics
// ============================================================
// Liefert die ICS-Datei (iCalendar) fuer einen Signup als
// Content-Type: text/calendar aus. Wird per HTTPS-Link aus der
// Bestaetigungsmail aufgerufen – iPhone/Safari oeffnet daraufhin
// direkt Apple Kalender, Desktop laedt sie als Datei.
//
// Auth via signup_id + delete_token (der Token ist ohnehin nur der
// eingetragenen Person bekannt und wird in derselben Mail versendet).
//
// verify_jwt: false (Browser-Klick aus Mail, ohne Auth-Header)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

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

Deno.serve(async (req: Request) => {
    if (req.method !== 'GET') {
        return new Response('method not allowed', { status: 405 });
    }
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return new Response('config missing', { status: 500 });
    }

    const url = new URL(req.url);
    const signupId = url.searchParams.get('signup');
    const token    = url.searchParams.get('t');
    if (!signupId || !token) return new Response('missing params', { status: 400 });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: signup, error } = await admin
        .from('signups')
        .select('id, delete_token, shifts!inner(shift_date, start_time, end_time, ends_next_day)')
        .eq('id', signupId)
        .maybeSingle();

    if (error || !signup) return new Response('not found', { status: 404 });
    if ((signup as any).delete_token !== token) return new Response('invalid token', { status: 403 });

    const sh = (signup as any).shifts;
    const ics = buildIcs(
        `signup-${signup.id}@st-sebastian-schichtplan.de`,
        sh.shift_date, sh.start_time, sh.end_time, !!sh.ends_next_day,
    );

    return new Response(ics, {
        status: 200,
        headers: {
            'content-type': 'text/calendar; charset=utf-8; method=PUBLISH',
            'content-disposition': 'inline; filename="schicht.ics"',
            'cache-control': 'private, no-store',
        },
    });
});
