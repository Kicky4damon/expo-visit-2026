-- 녹음 변환을 '수동'으로: 업로드만으로는 처리하지 않고, 사용자가 [변환] 버튼을 누르면 처리.
-- 새 상태 'uploaded' (업로드 완료·변환 전). 버튼 → rpc expo_request_rec(id) → 'pending' → 작업자가 가져감.
-- 기존 행 호환: 이미 'pending' 인 행은 그대로(작업자가 처리), done/failed 도 그대로.
alter table public.expo_recordings drop constraint if exists expo_recordings_status_check;
alter table public.expo_recordings add constraint expo_recordings_status_check
  check (status in ('uploaded','pending','processing','done','failed'));
alter table public.expo_recordings alter column status set default 'uploaded';
alter table public.expo_recordings add column if not exists requested_at timestamptz;   -- [변환] 누른 시각
alter table public.expo_recordings add column if not exists requested_by int;           -- 누른 사용자 번호

-- 새 녹음은 'uploaded' 로 들어감(나머지 동작은 기존과 같음)
create or replace function public.expo_put_rec(p_id text, p_app text, p_cid text, p_path text, p_mime text, p_duration int, p_size int, p_created bigint, p_ts bigint, p_by int, p_deleted boolean)
returns public.expo_recordings language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  insert into public.expo_recordings(id,app,cid,path,mime,duration_ms,size_bytes,created,ts,by_no,deleted,status)
  values (p_id,p_app,p_cid,p_path,p_mime,p_duration,p_size,p_created,p_ts,p_by,p_deleted,'uploaded')
  on conflict (id) do update set path=excluded.path, mime=excluded.mime, duration_ms=excluded.duration_ms, size_bytes=excluded.size_bytes,
    ts=excluded.ts, by_no=excluded.by_no, deleted=excluded.deleted, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_recordings.ts, expo_recordings.by_no);
  select * into r from public.expo_recordings where id=p_id;
  return r;
end $$;

-- [변환] 버튼: uploaded/failed/done → pending (done 이면 '다시 변환'). 처리 중이면 그대로.
create or replace function public.expo_request_rec(p_id text, p_by int default null) returns public.expo_recordings
language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  update public.expo_recordings
     set status='pending', error=null, worker=null, claimed_at=null, attempts=0,
         requested_at=now(), requested_by=p_by, updated_at=now()
   where id=p_id and not deleted and path is not null and status in ('uploaded','failed','done');
  select * into r from public.expo_recordings where id=p_id;
  return r;
end $$;
revoke all on function public.expo_request_rec(text,int) from public, anon;
grant execute on function public.expo_request_rec(text,int) to authenticated;

-- 작업자: 먼저 누른 것부터
create or replace function public.expo_claim_rec(p_worker text) returns public.expo_recordings
language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  update public.expo_recordings set status='processing', worker=p_worker, claimed_at=now(), attempts=attempts+1, updated_at=now()
   where id = (select id from public.expo_recordings
               where status='pending' and not deleted and path is not null
               order by requested_at nulls last, created nulls last for update skip locked limit 1)
  returning * into r;
  return r;
end $$;
revoke all on function public.expo_claim_rec(text) from public, anon, authenticated;
grant execute on function public.expo_claim_rec(text) to service_role;
