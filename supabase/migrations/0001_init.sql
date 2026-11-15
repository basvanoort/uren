-- Urenregistratie: basisschema.
-- Alle tabellen zijn per gebruiker afgeschermd met row level security.
-- Saldo's en totalen worden niet opgeslagen maar in de app berekend (web/js/calc.js).

create table klanten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  naam text not null,
  actief boolean not null default true,
  aangemaakt_op timestamptz not null default now()
);

create table projecten (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  klant_id uuid not null references klanten on delete restrict,
  naam text not null,
  standaard_facturabel_pct integer not null default 100
    check (standaard_facturabel_pct between 0 and 100),
  actief boolean not null default true,
  aangemaakt_op timestamptz not null default now()
);

-- Een registratie: kloktijden (start/eind) of alleen een duur.
-- eind is leeg zolang de klok loopt.
create table entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  datum date not null,
  type text not null default 'werk'
    check (type in ('werk', 'verlof', 'ziek', 'feestdag', 'compensatie')),
  start timestamptz,
  eind timestamptz,
  duur_min integer check (duur_min >= 0),
  pauze_min integer not null default 0 check (pauze_min >= 0),
  locatie text check (locatie in ('kantoor', 'thuis', 'onderweg')),
  notitie text not null default '',
  bron text not null default 'app',
  aangemaakt_op timestamptz not null default now(),
  check (eind is null or (start is not null and eind >= start)),
  check (type <> 'werk' or start is not null or duur_min is not null)
);
create index entries_user_datum on entries (user_id, datum);

-- Verdeling van een registratie over projecten.
-- Geen rijen = nog niet toegewezen ("open").
-- Per rij is het aandeel een percentage of een aantal minuten; idem voor facturabel.
create table verdeling (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  entry_id uuid not null references entries on delete cascade,
  project_id uuid not null references projecten on delete restrict,
  aandeel_pct numeric check (aandeel_pct between 0 and 100),
  aandeel_min integer check (aandeel_min >= 0),
  facturabel_pct numeric check (facturabel_pct between 0 and 100),
  facturabel_min integer check (facturabel_min >= 0),
  aangemaakt_op timestamptz not null default now(),
  check ((aandeel_pct is null) <> (aandeel_min is null)),
  check ((facturabel_pct is null) <> (facturabel_min is null))
);
create index verdeling_entry on verdeling (entry_id);

-- Normuren per weekdag in minuten, index 1 = maandag ... 7 = zondag.
create table contract_perioden (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  geldig_vanaf date not null,
  geldig_tot date,
  norm_min integer[] not null check (array_length(norm_min, 1) = 7),
  aangemaakt_op timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['klanten', 'projecten', 'entries', 'verdeling', 'contract_perioden'] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy eigen_rijen on %I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
