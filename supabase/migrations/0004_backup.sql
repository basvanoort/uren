-- Nachtelijke back-up naar pCloud.
-- backup_koppeling bevat het pCloud-token en is alleen leesbaar voor de Edge Function
-- (service role): geen policies voor de app, dus het token komt nooit terug in de browser.
create table backup_koppeling (
  user_id uuid primary key references auth.users on delete cascade,
  hostname text not null check (hostname in ('api.pcloud.com', 'eapi.pcloud.com')),
  access_token text not null,
  pcloud_email text not null default '',
  gekoppeld_op timestamptz not null default now(),
  laatste_backup timestamptz,
  laatste_bestand text,
  laatste_fout text,
  laatste_poging timestamptz
);
alter table backup_koppeling enable row level security;
revoke all on backup_koppeling from anon, authenticated;

-- Interne instellingen, alleen voor de service role.
create table systeem (naam text primary key, waarde text not null);
alter table systeem enable row level security;
revoke all on systeem from anon, authenticated;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Willekeurige sleutel waarmee de nachtelijke taak zich bij de Edge Function meldt.
-- Elke nacht om 02:17 UTC (03:17 of 04:17 Nederlandse tijd).
do $$
declare sleutel text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into systeem (naam, waarde) values ('backup_sleutel', sleutel);
  perform cron.schedule('nachtelijke-backup', '17 2 * * *', format(
    $cmd$select net.http_post(
      url := 'https://ufandoutisuqwgpvwpsx.supabase.co/functions/v1/uren',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer %s'),
      body := '{"actie": "backup-alle"}'::jsonb,
      timeout_milliseconds := 120000)$cmd$, sleutel));
end $$;
