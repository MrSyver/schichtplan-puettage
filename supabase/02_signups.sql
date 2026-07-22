-- ============================================================
-- Puettage-Helferplan 2026 – Signups (Slice 2)
-- ============================================================
-- Enthaelt:
--   * Tabelle `signups`
--   * BEFORE-INSERT-Trigger `check_shift_capacity` (SECURITY DEFINER)
--   * RPC `get_public_signups()` fuer anonymisierte Anzeige
--   * RLS-Policies (INSERT fuer anon, kein direktes SELECT)
--
-- Voraussetzung: schema.sql und seed.sql wurden bereits ausgefuehrt.
-- Ausfuehrung: Supabase Dashboard -> SQL Editor -> Kompletten Inhalt
-- einfuegen -> Run. Idempotent (drop + create).
-- ============================================================

-- ----------------------------------------------------------------
-- Tabelle
-- ----------------------------------------------------------------

drop table if exists public.signups cascade;

create table public.signups (
    id                  uuid primary key default gen_random_uuid(),
    shift_id            uuid not null references public.shifts(id) on delete cascade,
    name                text not null,
    email               text null,
    phone               text null,
    show_name_publicly  boolean not null default false,
    remind_via_email    boolean not null default false,
    consent_given_at    timestamptz not null default now(),
    created_at          timestamptz not null default now(),

    constraint name_length       check (length(trim(name)) between 2 and 80),
    constraint email_plausible   check (email is null or email ~* '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$'),
    constraint phone_length      check (phone is null or length(trim(phone)) between 5 and 30)
    -- Kontaktangaben (E-Mail + Telefon) sind vollstaendig freiwillig.
);

create index signups_shift_idx   on public.signups (shift_id);
create index signups_created_idx on public.signups (created_at desc);

comment on table public.signups is
    'Helfer-Anmeldungen fuer die Schichten. Sichtbar fuer Admins; oeffentlich nur maskiert via RPC get_public_signups().';

-- ----------------------------------------------------------------
-- Kapazitaets-Trigger
-- ----------------------------------------------------------------

create or replace function public.check_shift_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    cap int;
    cnt int;
begin
    select max_persons into cap from public.shifts where id = new.shift_id;
    if cap is null then
        raise exception 'Unbekannte Schicht (id=%)', new.shift_id
            using errcode = 'foreign_key_violation';
    end if;

    select count(*) into cnt from public.signups where shift_id = new.shift_id;
    if cnt >= cap then
        raise exception 'Schicht ist bereits voll (% / %)', cnt, cap
            using errcode = 'check_violation',
                  hint    = 'CAPACITY_FULL';
    end if;

    return new;
end;
$$;

drop trigger if exists enforce_shift_capacity on public.signups;
create trigger enforce_shift_capacity
    before insert on public.signups
    for each row execute function public.check_shift_capacity();

-- ----------------------------------------------------------------
-- RPC fuer maskierte, oeffentliche Anzeige
-- ----------------------------------------------------------------
-- SECURITY DEFINER umgeht RLS auf signups gezielt, gibt aber
-- ausschliesslich unkritische Spalten zurueck (Name nur wenn opt-in).

create or replace function public.get_public_signups()
returns table (
    id            uuid,
    shift_id      uuid,
    display_name  text,
    created_at    timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
    select
        id,
        shift_id,
        case when show_name_publicly then name else null end as display_name,
        created_at
    from public.signups
    order by created_at asc;
$$;

revoke all on function public.get_public_signups() from public;
grant execute on function public.get_public_signups() to anon, authenticated;

comment on function public.get_public_signups is
    'Anonymisierte Sicht auf Anmeldungen: Name nur bei show_name_publicly=true, keine Kontaktdaten. Fuer den oeffentlichen Schichtplan.';

-- ----------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------

alter table public.signups enable row level security;

-- INSERT von anonymen Besuchern erlaubt (mit Basis-Plausibilitaet).
-- Die eigentliche Kapazitaetspruefung erledigt der Trigger oben.
drop policy if exists "anon darf sich eintragen" on public.signups;
create policy "anon darf sich eintragen"
    on public.signups
    for insert
    to anon, authenticated
    with check (length(trim(name)) between 2 and 80);

-- Kein direkter SELECT/UPDATE/DELETE fuer anon.
-- Admin-Policies (SELECT/UPDATE/DELETE fuer is_admin=true) kommen in Slice 3.
