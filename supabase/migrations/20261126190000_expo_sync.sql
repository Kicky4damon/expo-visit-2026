-- EXPO 방문 기록: 함께 쓰기(실시간) 스키마. 모든 값은 브라우저에서 AES-GCM으로 암호화된 상태로만 저장된다.
-- 접근: 로그인한 공용 계정(authenticated)만. anon은 읽기·쓰기·스토리지 모두 거부.

create table if not exists public.expo_items (
  app text not null check (app in ('p1','p2')),
  cid text not null,
  field text not null,
  value_enc text,
  ts bigint not null,
  by_no int not null,
  updated_at timestamptz not null default now(),
  primary key (app, cid, field)
);
create table if not exists public.expo_photos (
  id text primary key,
  app text not null check (app in ('p1','p2')),
  cid text not null,
  kind text not null check (kind in ('photo','card')),
  path text,
  w int, h int,
  created bigint,
  ts bigint not null,
  by_no int not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists expo_photos_app on public.expo_photos(app);

create sequence if not exists public.expo_user_seq_p1;
create sequence if not exists public.expo_user_seq_p2;

alter table public.expo_items enable row level security;
alter table public.expo_photos enable row level security;
alter table public.expo_items replica identity full;
alter table public.expo_photos replica identity full;

revoke all on public.expo_items, public.expo_photos from anon;
revoke all on sequence public.expo_user_seq_p1, public.expo_user_seq_p2 from anon, authenticated;
grant select on public.expo_items, public.expo_photos to authenticated;

drop policy if exists expo_items_read on public.expo_items;
create policy expo_items_read on public.expo_items for select to authenticated using (true);
drop policy if exists expo_photos_read on public.expo_photos;
create policy expo_photos_read on public.expo_photos for select to authenticated using (true);
-- 쓰기는 아래 함수로만(나중 값 우선 규칙 보장)

create or replace function public.expo_next_user(p_app text) returns int
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  if p_app = 'p1' then return nextval('public.expo_user_seq_p1');
  elsif p_app = 'p2' then return nextval('public.expo_user_seq_p2');
  else raise exception 'bad app'; end if;
end $$;

create or replace function public.expo_put_item(p_app text, p_cid text, p_field text, p_value text, p_ts bigint, p_by int)
returns public.expo_items language plpgsql security definer set search_path = public as $$
declare r public.expo_items;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  insert into public.expo_items(app,cid,field,value_enc,ts,by_no) values (p_app,p_cid,p_field,p_value,p_ts,p_by)
  on conflict (app,cid,field) do update set value_enc=excluded.value_enc, ts=excluded.ts, by_no=excluded.by_no, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_items.ts, expo_items.by_no);
  select * into r from public.expo_items where app=p_app and cid=p_cid and field=p_field;
  return r;
end $$;

create or replace function public.expo_put_photo(p_id text, p_app text, p_cid text, p_kind text, p_path text, p_w int, p_h int, p_created bigint, p_ts bigint, p_by int, p_deleted boolean)
returns public.expo_photos language plpgsql security definer set search_path = public as $$
declare r public.expo_photos;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  insert into public.expo_photos(id,app,cid,kind,path,w,h,created,ts,by_no,deleted) values (p_id,p_app,p_cid,p_kind,p_path,p_w,p_h,p_created,p_ts,p_by,p_deleted)
  on conflict (id) do update set path=excluded.path, w=excluded.w, h=excluded.h, ts=excluded.ts, by_no=excluded.by_no, deleted=excluded.deleted, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_photos.ts, expo_photos.by_no);
  select * into r from public.expo_photos where id=p_id;
  return r;
end $$;

revoke all on function public.expo_next_user(text) from public, anon;
revoke all on function public.expo_put_item(text,text,text,text,bigint,int) from public, anon;
revoke all on function public.expo_put_photo(text,text,text,text,text,int,int,bigint,bigint,int,boolean) from public, anon;
grant execute on function public.expo_next_user(text) to authenticated;
grant execute on function public.expo_put_item(text,text,text,text,bigint,int) to authenticated;
grant execute on function public.expo_put_photo(text,text,text,text,text,int,int,bigint,bigint,int,boolean) to authenticated;

-- Realtime
do $$ begin
  begin alter publication supabase_realtime add table public.expo_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.expo_photos; exception when duplicate_object then null; end;
end $$;

-- 비공개 Storage 버킷(암호화된 사진 조각만 저장)
insert into storage.buckets (id, name, public, file_size_limit) values ('expo','expo', false, 5242880)
on conflict (id) do update set public = false, file_size_limit = 5242880;
drop policy if exists expo_obj_select on storage.objects;
drop policy if exists expo_obj_insert on storage.objects;
drop policy if exists expo_obj_update on storage.objects;
drop policy if exists expo_obj_delete on storage.objects;
create policy expo_obj_select on storage.objects for select to authenticated using (bucket_id = 'expo');
create policy expo_obj_insert on storage.objects for insert to authenticated with check (bucket_id = 'expo');
create policy expo_obj_update on storage.objects for update to authenticated using (bucket_id = 'expo');
create policy expo_obj_delete on storage.objects for delete to authenticated using (bucket_id = 'expo');
