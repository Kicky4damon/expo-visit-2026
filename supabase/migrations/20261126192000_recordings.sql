-- 녹음 + 받아쓰기/요약 작업 테이블 (작업 큐 겸용). 내용은 모두 AES-GCM 암호문.
create table if not exists public.expo_recordings (
  id text primary key,
  app text not null check (app in ('p1','p2','t1','t2')),
  cid text not null,
  path text,                       -- Storage 'expo' 버킷 안 경로 (암호화된 오디오)
  mime text,                       -- 원본 오디오 형식: audio/webm;codecs=opus | audio/mp4 등
  duration_ms int,
  size_bytes int,
  created bigint,                  -- 녹음 시각(ms, 기기 시계)
  ts bigint not null,              -- 사용자 쪽 마지막 변경 시각(ms). 나중 값 우선
  by_no int not null,              -- 마지막으로 바꾼 사용자 번호
  deleted boolean not null default false,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  error text,                      -- 실패 사유(짧게, 내용 없이)
  transcript_enc text,             -- 받아쓰기 원문 (암호문)
  summary_enc text,                -- 요약 JSON (암호문)
  worker text,
  attempts int not null default 0,
  claimed_at timestamptz,
  result_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists expo_recordings_status on public.expo_recordings(status) where not deleted;
alter table public.expo_recordings enable row level security;
alter table public.expo_recordings replica identity full;
revoke all on public.expo_recordings from anon;
grant select on public.expo_recordings to authenticated;
drop policy if exists expo_rec_read on public.expo_recordings;
create policy expo_rec_read on public.expo_recordings for select to authenticated using (true);

create or replace function public.expo_put_rec(p_id text, p_app text, p_cid text, p_path text, p_mime text, p_duration int, p_size int, p_created bigint, p_ts bigint, p_by int, p_deleted boolean)
returns public.expo_recordings language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  insert into public.expo_recordings(id,app,cid,path,mime,duration_ms,size_bytes,created,ts,by_no,deleted,status)
  values (p_id,p_app,p_cid,p_path,p_mime,p_duration,p_size,p_created,p_ts,p_by,p_deleted,'pending')
  on conflict (id) do update set path=excluded.path, mime=excluded.mime, duration_ms=excluded.duration_ms, size_bytes=excluded.size_bytes,
    ts=excluded.ts, by_no=excluded.by_no, deleted=excluded.deleted, updated_at=now()
  where (excluded.ts, excluded.by_no) > (expo_recordings.ts, expo_recordings.by_no);
  select * into r from public.expo_recordings where id=p_id;
  return r;
end $$;

create or replace function public.expo_retry_rec(p_id text) returns public.expo_recordings
language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed'; end if;
  update public.expo_recordings set status='pending', error=null, worker=null, claimed_at=null, updated_at=now()
   where id=p_id and status='failed' and not deleted;
  select * into r from public.expo_recordings where id=p_id;
  return r;
end $$;

-- 작업자(service_role) 전용: 대기 작업 1건을 원자적으로 가져가기
create or replace function public.expo_claim_rec(p_worker text) returns public.expo_recordings
language plpgsql security definer set search_path = public as $$
declare r public.expo_recordings;
begin
  update public.expo_recordings set status='processing', worker=p_worker, claimed_at=now(), attempts=attempts+1, updated_at=now()
   where id = (select id from public.expo_recordings
               where status='pending' and not deleted and path is not null
               order by created nulls last for update skip locked limit 1)
  returning * into r;
  return r;
end $$;

revoke all on function public.expo_put_rec(text,text,text,text,text,int,int,bigint,bigint,int,boolean) from public, anon;
revoke all on function public.expo_retry_rec(text) from public, anon;
revoke all on function public.expo_claim_rec(text) from public, anon, authenticated;
grant execute on function public.expo_put_rec(text,text,text,text,text,int,int,bigint,bigint,int,boolean) to authenticated;
grant execute on function public.expo_retry_rec(text) to authenticated;
grant execute on function public.expo_claim_rec(text) to service_role;

do $$ begin
  begin alter publication supabase_realtime add table public.expo_recordings; exception when duplicate_object then null; end;
end $$;
update storage.buckets set file_size_limit = 26214400 where id = 'expo';  -- 녹음 최대 25MB
