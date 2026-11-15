-- Dit is een app voor één persoon: zodra er een account bestaat, kan niemand er nog een aanmaken.
create function public.alleen_eerste_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from auth.users) then
    raise exception 'Er bestaat al een account; nieuwe aanmeldingen zijn uitgeschakeld.';
  end if;
  return new;
end $$;
revoke execute on function public.alleen_eerste_account() from public, anon, authenticated;

create trigger alleen_eerste_account before insert on auth.users
  for each row execute function public.alleen_eerste_account();
