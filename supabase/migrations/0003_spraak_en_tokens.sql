-- Persoonlijke tokens voor Siri-opdrachten. Alleen de hash wordt bewaard;
-- het token zelf ziet de gebruiker één keer in de app.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  naam text not null default 'Siri',
  token_hash text not null unique,
  laatst_gebruikt timestamptz,
  aangemaakt_op timestamptz not null default now()
);

-- Controlespoor van spraakinvoer: wat er gezegd is en wat de app ervan maakte.
-- entry_id is gevuld zodra het concept via een opdracht is opgeslagen.
create table spraak_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  transcript text not null,
  concept jsonb not null,
  bron text not null,
  entry_id uuid references entries on delete set null,
  aangemaakt_op timestamptz not null default now()
);
create index spraak_log_user on spraak_log (user_id, aangemaakt_op desc);
create index spraak_log_entry on spraak_log (entry_id);
create index api_tokens_user on api_tokens (user_id);

alter table api_tokens enable row level security;
create policy eigen_rijen on api_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- De app mag het logboek alleen lezen; schrijven doet de Edge Function.
alter table spraak_log enable row level security;
create policy eigen_rijen_lezen on spraak_log for select to authenticated
  using (user_id = (select auth.uid()));
