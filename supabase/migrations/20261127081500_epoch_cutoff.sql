-- 데이터 시대(epoch) 2026-11-27: 2026-11-27 08:15:38 KST 초기화 이전 시각(p_ts)으로 오는 쓰기는 거부.
-- 휴대폰에 남은 옛 기록·보낼 것(옛 앱 버전 포함)이 다시 올라오지 않게 함. 함수 본문만 바꿈(인자·반환·권한·RLS 그대로).

CREATE OR REPLACE FUNCTION public.expo_put_item(p_app text, p_cid text, p_field text, p_value text, p_ts bigint, p_by integer)
 RETURNS expo_items
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.expo_items;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  if p_ts < 1795734938065 then raise exception 'stale epoch' using errcode = 'P0001', hint = 'local data from before reset 2026-11-27 08:15:38 KST'; end if;
  insert into public.expo_items(app,cid,field,value_enc,ts,by_no) values (p_app,p_cid,p_field,p_value,p_ts,p_by)
  on conflict (app,cid,field) do update set value_enc=excluded.value_enc, ts=excluded.ts, by_no=excluded.by_no, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_items.ts, expo_items.by_no);
  select * into r from public.expo_items where app=p_app and cid=p_cid and field=p_field;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.expo_put_photo(p_id text, p_app text, p_cid text, p_kind text, p_path text, p_w integer, p_h integer, p_created bigint, p_ts bigint, p_by integer, p_deleted boolean)
 RETURNS expo_photos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.expo_photos;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  if p_ts < 1795734938065 then raise exception 'stale epoch' using errcode = 'P0001', hint = 'local data from before reset 2026-11-27 08:15:38 KST'; end if;
  insert into public.expo_photos(id,app,cid,kind,path,w,h,created,ts,by_no,deleted) values (p_id,p_app,p_cid,p_kind,p_path,p_w,p_h,p_created,p_ts,p_by,p_deleted)
  on conflict (id) do update set path=excluded.path, w=excluded.w, h=excluded.h, ts=excluded.ts, by_no=excluded.by_no, deleted=excluded.deleted, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_photos.ts, expo_photos.by_no);
  select * into r from public.expo_photos where id=p_id;
  return r;
end $function$;

CREATE OR REPLACE FUNCTION public.expo_put_rec(p_id text, p_app text, p_cid text, p_path text, p_mime text, p_duration integer, p_size integer, p_created bigint, p_ts bigint, p_by integer, p_deleted boolean)
 RETURNS expo_recordings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.expo_recordings;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  if p_ts < 1795734938065 then raise exception 'stale epoch' using errcode = 'P0001', hint = 'local data from before reset 2026-11-27 08:15:38 KST'; end if;
  insert into public.expo_recordings(id,app,cid,path,mime,duration_ms,size_bytes,created,ts,by_no,deleted,status)
  values (p_id,p_app,p_cid,p_path,p_mime,p_duration,p_size,p_created,p_ts,p_by,p_deleted,'uploaded')
  on conflict (id) do update set path=excluded.path, mime=excluded.mime, duration_ms=excluded.duration_ms, size_bytes=excluded.size_bytes,
    ts=excluded.ts, by_no=excluded.by_no, deleted=excluded.deleted, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_recordings.ts, expo_recordings.by_no);
  select * into r from public.expo_recordings where id=p_id;
  return r;
end $function$;
