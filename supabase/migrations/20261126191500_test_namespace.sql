-- 검증 전용 이름공간(t1, t2): 실제 p1/p2 번호표·데이터를 건드리지 않고 같은 배포본으로 검증
alter table public.expo_items drop constraint if exists expo_items_app_check;
alter table public.expo_items add constraint expo_items_app_check check (app in ('p1','p2','t1','t2'));
alter table public.expo_photos drop constraint if exists expo_photos_app_check;
alter table public.expo_photos add constraint expo_photos_app_check check (app in ('p1','p2','t1','t2'));
create sequence if not exists public.expo_user_seq_t1;
create sequence if not exists public.expo_user_seq_t2;
revoke all on sequence public.expo_user_seq_t1, public.expo_user_seq_t2 from anon, authenticated;
create or replace function public.expo_next_user(p_app text) returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  case p_app
    when 'p1' then return nextval('public.expo_user_seq_p1');
    when 'p2' then return nextval('public.expo_user_seq_p2');
    when 't1' then return nextval('public.expo_user_seq_t1');
    when 't2' then return nextval('public.expo_user_seq_t2');
    else raise exception 'bad app';
  end case;
end $$;
revoke all on function public.expo_next_user(text) from public, anon;
grant execute on function public.expo_next_user(text) to authenticated;
