-- ============================================================
-- Puettage-Helferplan 2026 – Seed-Daten
-- ============================================================
-- Fuellt shifts + site_content mit den finalen Ausgangswerten.
-- Idempotent (delete + insert / upsert), kann mehrfach ausgefuehrt werden.
-- Reihenfolge: erst schema.sql, dann seed.sql.
-- ============================================================

-- ------------------------------------------------------------
-- Schichten (11 Stueck, sort_order aufsteigend chronologisch)
-- ------------------------------------------------------------

truncate table public.shifts restart identity cascade;

insert into public.shifts
    (shift_date,   start_time, end_time, ends_next_day, min_persons, max_persons, sort_order, label)
values
    -- Freitag, 04.09.2026
    ('2026-09-04', '15:00',    '18:00',  false,         1,           2,           1,          null),
    ('2026-09-04', '18:00',    '21:00',  false,         4,           4,           2,          null),
    ('2026-09-04', '20:45',    '01:00',  true,          4,           4,           3,          'Nachtschicht'),
    -- Samstag, 05.09.2026
    ('2026-09-05', '10:30',    '13:00',  false,         1,           2,           4,          null),
    ('2026-09-05', '13:00',    '15:30',  false,         2,           3,           5,          null),
    ('2026-09-05', '15:30',    '18:00',  false,         3,           3,           6,          null),
    ('2026-09-05', '18:00',    '21:00',  false,         4,           4,           7,          null),
    ('2026-09-05', '20:45',    '01:00',  true,          4,           4,           8,          'Nachtschicht'),
    -- Sonntag, 06.09.2026
    ('2026-09-06', '12:00',    '15:00',  false,         1,           2,           9,          null),
    ('2026-09-06', '15:00',    '18:00',  false,         2,           3,           10,         null),
    ('2026-09-06', '18:00',    '20:00',  false,         2,           3,           11,         null);

-- ------------------------------------------------------------
-- Redaktionelle Texte (Default-Wording, im Admin editierbar)
-- ------------------------------------------------------------

insert into public.site_content (key, value) values
    ('hero_title',
     'Püttage 2026 – Helfer für unseren Bierstand gesucht'),
    ('hero_body',
     'Vom 4. bis 6. September betreiben wir bei den Püttagen wieder unseren Bierstand. Damit wir die drei Tage stemmen, brauchen wir Zapfer, Kassierer und helfende Hände in jeder Schicht. Such dir eine Schicht aus, die dir passt – jede Stunde zählt.'),
    ('plan_intro',
     'Wähl eine Schicht und trag dich mit Namen und einer Kontaktmöglichkeit (E-Mail oder Telefon) ein. Deine Kontaktdaten sehen nur die Verantwortlichen. Ob dein Name für andere sichtbar ist, entscheidest du selbst beim Eintragen.')
on conflict (key) do update
    set value      = excluded.value,
        updated_at = now();
