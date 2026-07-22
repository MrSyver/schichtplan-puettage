-- ============================================================
-- Puettage-Helferplan 2026 – Datenbank-Schema (Slice 1)
-- ============================================================
-- Enthaelt:
--   * Tabelle `shifts`        (statische Schichten, wird per Seed befuellt)
--   * Tabelle `site_content`  (redaktionelle Texte, admin-editierbar)
--   * RLS-Policies fuer beide (deny-by-default, lesbar fuer anon)
--
-- Signups + Trigger folgen in Slice 2 (separate Migration).
-- Admin-Policies (UPDATE) folgen in Slice 3, sobald der Admin-User existiert.
--
-- Ausfuehrung: Supabase Dashboard -> SQL Editor -> Kompletten Inhalt
-- einfuegen -> Run. Idempotent (drop + create).
-- ============================================================

-- ----------------------------------------------------------------
-- Tabellen
-- ----------------------------------------------------------------

drop table if exists public.site_content cascade;
drop table if exists public.shifts cascade;

create table public.shifts (
    id             uuid primary key default gen_random_uuid(),
    shift_date     date        not null,
    start_time     time        not null,
    end_time       time        not null,
    ends_next_day  boolean     not null default false,
    min_persons    int         not null check (min_persons >= 0),
    max_persons    int         not null check (max_persons >= min_persons),
    sort_order     int         not null,
    label          text        null,
    created_at     timestamptz not null default now()
);

create index shifts_sort_idx on public.shifts (sort_order);

comment on table public.shifts is
    'Statische Helfer-Schichten fuer die Puettage 2026. Wird per seed.sql befuellt und normalerweise nicht veraendert.';

create table public.site_content (
    key         text primary key,
    value       text        not null,
    updated_at  timestamptz not null default now()
);

comment on table public.site_content is
    'Redaktionelle Kurztexte (Teaser, Plan-Erklaerung). Fester Key-Satz, per Seed initialisiert, im Admin-Bereich editierbar.';

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------

alter table public.shifts        enable row level security;
alter table public.site_content  enable row level security;

-- shifts: oeffentlich lesbar, kein Schreibzugriff von aussen
drop policy if exists "shifts sind oeffentlich lesbar" on public.shifts;
create policy "shifts sind oeffentlich lesbar"
    on public.shifts
    for select
    to anon, authenticated
    using (true);

-- site_content: oeffentlich lesbar, UPDATE nur Admin (kommt in Slice 3)
drop policy if exists "site_content ist oeffentlich lesbar" on public.site_content;
create policy "site_content ist oeffentlich lesbar"
    on public.site_content
    for select
    to anon, authenticated
    using (true);
