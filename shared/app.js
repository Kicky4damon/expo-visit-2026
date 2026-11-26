/* KINTEX 스마트건설 EXPO 방문 기록 v2 — 엘림주식회사. 실시간 함께 쓰기(Supabase), 오프라인 우선, 빌드 도구 없음. */
(function () {
  'use strict';
  const CFG = window.APP; // {id, title, db}
  const NS_TEST = new URLSearchParams(location.search).get('ns') === 'test';
  const SYNC_APP = NS_TEST ? 't' + CFG.id.slice(1) : CFG.id;           // 서버 쪽 앱 이름(검증용 t1/t2 분리)
  const DBNAME = CFG.db + (NS_TEST ? '-test' : '');
  const LS = 'expo2026-' + CFG.id + (NS_TEST ? '-test' : '') + '-';
  const SC = window.SYNC_CONFIG || { kind: 'none' };
  const COMPANY = '엘림주식회사';
  const FIELDS = ['answer', 'met'];                       // 자유 메모·후속 조치·사진은 2026-11-26 21:38 요청으로 화면·보고서에서 뺌(옛 값은 무시)
  const V1_FIELDS = ['answer', 'met', 'memo', 'followup'];
  const FIELD_LABEL = { answer: '받은 답변', met: '만난 사람', memo: '자유 메모', followup: '후속 조치' };
  const STATUS = { none: '미방문', doing: '방문중', done: '완료' };
  const REC_STATUS = { local: '보낼 준비(오프라인 저장)', uploading: '올리는 중', uploaded: '변환 전', pending: '변환 대기', processing: '변환 중', done: '완료', failed: '실패' };
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const hhmmss = d => hhmm(d) + ':' + pad(d.getSeconds());
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fmtTime = t => { if (!t) return ''; const d = new Date(t); return ymd(d) + ' ' + hhmm(d); };
  const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const newer = (a, b) => !b || (a.ts > b.ts) || (a.ts === b.ts && (a.by || 0) > (b.by || 0));

  /* ---------- IndexedDB (v1 → v2 업그레이드 시 기존 자료 보존) ---------- */
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DBNAME, 2);
      r.onupgradeneeded = ev => {
        const d = r.result, names = d.objectStoreNames;
        if (!names.contains('kv')) d.createObjectStore('kv');
        if (!names.contains('entries')) d.createObjectStore('entries');            // v1 자료(이관 후에도 보존)
        if (!names.contains('photos')) { const p = d.createObjectStore('photos', { keyPath: 'id' }); p.createIndex('cid', 'cid'); }
        if (!names.contains('items')) d.createObjectStore('items');
        if (!names.contains('recs')) d.createObjectStore('recs', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store); let out;
      Promise.resolve(fn(s)).then(v => { out = v; });
      t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out);
      t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
    });
  }
  const idbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
  const idbPut = (st, v, k) => tx(st, 'readwrite', s => k === undefined ? s.put(v) : s.put(v, k));
  const idbDel = (st, k) => tx(st, 'readwrite', s => s.delete(k));
  const idbAll = st => tx(st, 'readonly', s => s.getAll());
  const idbAllKeys = st => tx(st, 'readonly', s => s.getAllKeys());
  const idbClear = st => tx(st, 'readwrite', s => s.clear());

  /* ---------- 암호 ---------- */
  const te = new TextEncoder(), td = new TextDecoder();
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const b64e = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  async function pbkdf2(pw, salt, iter) { return crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveKey', 'deriveBits']).then(base => ({ base, salt, iter })); }
  async function deriveAes(pw, salt, iter) { const { base } = await pbkdf2(pw); return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: typeof salt === 'string' ? te.encode(salt) : salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); }
  async function deriveHex(pw, salt, iter) { const { base } = await pbkdf2(pw); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode(salt), iterations: iter, hash: 'SHA-256' }, base, 256); return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join(''); }
  let SKEY = null, AUTHPW = null;
  async function encBytes(u8) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, SKEY, u8)); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function decBytes(u8) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12) }, SKEY, u8.subarray(12))); }
  const encText = async s => b64e(await encBytes(te.encode(String(s == null ? '' : s))));
  const decText = async s => s == null ? '' : td.decode(await decBytes(b64d(s)));

  /* ---------- 상태 ---------- */
  let DATA = null;
  const ITEMS = {};   // "cid|field" -> {cid, field, v, ts, by, dirty}
  const PHOTOS = {};  // id -> {id,cid,kind,blob,w,h,created,ts,by,path,deleted,dirty,oldPaths}
  const RECS = {};    // id -> {id,cid,mime,duration,size,created,ts,by,path,deleted,dirty,enc(Blob),status,error,transcript,summary,oldPaths}
  let ME = { no: null, tmp: null };
  const urls = new Map();
  let lastSaved = 0;
  const NET = { online: navigator.onLine, connected: false, peers: [], lastSync: 0, err: '' };
  const isConn = () => !!(chan && chan.state === 'joined') && navigator.onLine;

  const key = (cid, f) => cid + '|' + f;
  const item = (cid, f) => ITEMS[key(cid, f)];
  const val = (cid, f, d = '') => { const it = item(cid, f); return it ? it.v : d; };
  const status = cid => val(cid, 'status', 'none') || 'none';
  const myBy = () => ME.no || 0;
  const who = by => by ? '사용자 ' + by : '사용자 ?(임시)';
  const marker = obj => obj && obj.ts ? `${who(obj.by)} · ${hhmm(new Date(obj.ts))}` : '';
  const photosOf = (cid, kind) => Object.values(PHOTOS).filter(p => p.cid === cid && !p.deleted && (!kind || p.kind === kind)).sort((a, b) => a.created - b.created);
  const recsOf = cid => Object.values(RECS).filter(r => r.cid === cid && !r.deleted).sort((a, b) => a.created - b.created);
  const urlOf = p => { if (!p.blob) return ''; const k = p.id + ':' + p.ts; if (!urls.has(k)) urls.set(k, URL.createObjectURL(p.blob)); return urls.get(k); };
  const dirtyCount = () => Object.values(ITEMS).filter(x => x.dirty).length + Object.values(PHOTOS).filter(x => x.dirty).length + Object.values(RECS).filter(x => x.dirty).length;

  /* ---------- 로컬 저장 ---------- */
  function lsPut(it) { try { localStorage.setItem(LS + 'i-' + key(it.cid, it.field), JSON.stringify(it)); } catch (_) {} }
  async function saveItem(it) { lsPut(it); await idbPut('items', it, key(it.cid, it.field)); lastSaved = Date.now(); showSaved(); renderNet(); }
  const photoRec = p => ({ id: p.id, cid: p.cid, kind: p.kind, blob: p.blob, w: p.w, h: p.h, created: p.created, ts: p.ts, by: p.by, path: p.path || null, deleted: !!p.deleted, dirty: !!p.dirty, oldPaths: p.oldPaths || [] });
  async function savePhoto(p) { await idbPut('photos', photoRec(p)); lastSaved = Date.now(); showSaved(); renderNet(); }
  const recRec = r => { const o = Object.assign({}, r); delete o.url; return o; };
  async function saveRec(r) { await idbPut('recs', recRec(r)); lastSaved = Date.now(); showSaved(); renderNet(); }

  function setField(cid, f, v) {   // 로컬 편집
    const it = ITEMS[key(cid, f)] = { cid, field: f, v, ts: Date.now(), by: myBy(), dirty: true };
    saveItem(it); kick(); return it;
  }

  // 데이터 시대(epoch): 서버를 초기화할 때마다 올림. 기기의 값이 다르면 이 기기의 기록·보낼 것·사용자 번호를 버리고 새로 시작
  // (비밀번호로 연 잠금 정보·회사 자료·로그인은 그대로). 서버도 초기화 전 시각의 쓰기는 거부함(migrations/20261127081500_epoch_cutoff.sql).
  const DATA_EPOCH = '20261127a';
  async function epochCheck() {
    if ((await idbGet('kv', 'epoch')) === DATA_EPOCH) return false;
    for (const st of ['items', 'photos', 'recs', 'entries']) await idbClear(st);
    for (const k of ['me', 'meta']) await idbDel('kv', k);
    await idbPut('kv', Date.now(), 'migrated2');                       // 옛 v1 자료도 다시 옮기지 않음
    Object.keys(localStorage).filter(k => k.startsWith(LS + 'i-') || k.startsWith(LS + 'e-') || k === LS + 'meta').forEach(k => localStorage.removeItem(k));
    ME = { no: null, tmp: null };
    await idbPut('kv', DATA_EPOCH, 'epoch');
    return true;
  }
  async function loadLocal() {
    await epochCheck();
    const keys = await idbAllKeys('items'), vals = await idbAll('items');
    keys.forEach((k, i) => { ITEMS[k] = vals[i]; });
    // localStorage 사본(닫기 직전 입력)이 더 새로우면 반영
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); if (!k || !k.startsWith(LS + 'i-')) continue;
      try { const it = JSON.parse(localStorage.getItem(k)); const cur = ITEMS[key(it.cid, it.field)]; if (newer(it, cur)) { ITEMS[key(it.cid, it.field)] = it; await idbPut('items', it, key(it.cid, it.field)); } } catch (_) {}
    }
    for (const p of await idbAll('photos')) PHOTOS[p.id] = p;
    for (const r of await idbAll('recs')) RECS[r.id] = r;
    ME = (await idbGet('kv', 'me')) || ME;
    SKEY = (await idbGet('kv', 'skey')) || null; AUTHPW = (await idbGet('kv', 'authpw')) || null;
    lastSaved = Math.max(0, ...Object.values(ITEMS).map(x => x.ts || 0));
    await migrateV1();
  }
  async function migrateV1() {    // v1(동기화 전) 자료 → v2 항목. 원본 v1 저장소는 지우지 않음
    if (await idbGet('kv', 'migrated2')) return;
    const keys = await idbAllKeys('entries'), vals = await idbAll('entries');
    const ent = {}; keys.forEach((k, i) => { ent[k] = vals[i]; });
    for (const c of (DATA ? DATA.companies : [])) {   // v1 localStorage 사본
      try { const ls = JSON.parse(localStorage.getItem(LS + 'e-' + c.id) || 'null'); if (ls && (!ent[c.id] || (ls.updatedAt || 0) > (ent[c.id].updatedAt || 0))) ent[c.id] = ls; } catch (_) {}
    }
    const put = async (cid, f, v, ts) => { if (v == null || v === '' || item(cid, f)) return; const it = { cid, field: f, v, ts: ts || Date.now(), by: 0, dirty: true }; ITEMS[key(cid, f)] = it; await saveItem(it); };
    for (const [cid, e] of Object.entries(ent)) {
      if (e.visited) await put(cid, 'status', 'done', e.visitedAt || e.updatedAt);
      for (const f of V1_FIELDS) await put(cid, f, e[f], e.updatedAt);
    }
    let meta = await idbGet('kv', 'meta');
    try { const lm = JSON.parse(localStorage.getItem(LS + 'meta') || 'null'); if (lm && (!meta || (lm.updatedAt || 0) > (meta.updatedAt || 0))) meta = lm; } catch (_) {}
    if (meta) { await put('_meta', 'opinion', meta.opinion, meta.updatedAt); await put('_meta', 'writer', meta.writer, meta.updatedAt); if (meta.maskPhones) localStorage.setItem(LS + 'mask', '1'); }
    for (const p of Object.values(PHOTOS)) if (p.ts == null) { Object.assign(p, { ts: p.created || Date.now(), by: 0, path: null, deleted: false, dirty: true, oldPaths: [] }); await savePhoto(p); }
    await idbPut('kv', Date.now(), 'migrated2');
  }

  /* ---------- 동기화 (Supabase) ---------- */
  let sb = null, chan = null, kickT = null, loopT = null, syncing = false, presenceKey = rid();
  const syncReady = () => SC.kind === 'supabase' && SKEY && AUTHPW;
  function kick(ms = 600) { clearTimeout(kickT); kickT = setTimeout(syncNow, ms); }
  window.addEventListener('online', () => { NET.online = true; renderNet(); kick(100); setTimeout(() => { if (sb && syncReady()) pullAll().catch(() => {}); }, 2500); });
  setInterval(() => { const c = isConn(); if (c !== NET.connected) { const was = NET.connected; NET.connected = c; renderNet(); if (c && !was && sb) pullAll().catch(() => {}); } }, 2000);
  window.addEventListener('offline', () => { NET.online = false; NET.connected = false; renderNet(); });
  async function ensureClient() {
    if (sb) return sb;
    sb = window.supabase.createClient(SC.url, SC.anonKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'expo2026-auth' + (NS_TEST ? '-test' : '') }, realtime: { params: { eventsPerSecond: 20 } } });
    return sb;
  }
  async function ensureSession() {
    await ensureClient();
    const { data } = await sb.auth.getSession();
    if (data && data.session) return data.session;
    const r = await sb.auth.signInWithPassword({ email: SC.authEmail, password: AUTHPW });
    if (r.error) throw r.error; return r.data.session;
  }
  async function ensureNumber() {
    if (ME.no) return;
    const { data, error } = await sb.rpc('expo_next_user', { p_app: SYNC_APP });
    if (error) throw error;
    ME = { no: data, tmp: null }; await idbPut('kv', ME, 'me');
    // 임시 번호로 적은 것들 → 진짜 번호로
    for (const it of Object.values(ITEMS)) if (it.dirty && !it.by) { it.by = ME.no; await saveItem(it); }
    for (const p of Object.values(PHOTOS)) if (p.dirty && !p.by) { p.by = ME.no; await savePhoto(p); }
    for (const r of Object.values(RECS)) if (r.dirty && !r.by) { r.by = ME.no; await saveRec(r); }
    if (chan) chan.track({ no: ME.no });
    renderMe(); refreshView();
  }
  function subscribe() {
    if (chan) return;
    chan = sb.channel('expo-' + SYNC_APP, { config: { presence: { key: presenceKey } } });
    const filt = 'app=eq.' + SYNC_APP;
    chan.on('postgres_changes', { event: '*', schema: 'public', table: 'expo_items', filter: filt }, p => p.new && p.new.cid && applyItem(p.new).then(refreshView))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expo_photos', filter: filt }, p => p.new && p.new.id && applyPhoto(p.new).then(refreshView))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expo_recordings', filter: filt }, p => p.new && p.new.id && applyRec(p.new).then(refreshView))
      .on('presence', { event: 'sync' }, () => {
        const st = chan.presenceState(); const nos = new Set();
        Object.values(st).forEach(arr => arr.forEach(m => { if (m.no) nos.add(m.no); }));
        NET.peers = [...nos].sort((a, b) => a - b); renderNet();
      })
      .subscribe(async s => {
        if (s === 'SUBSCRIBED') { NET.connected = true; renderNet(); if (ME.no) chan.track({ no: ME.no }); pullAll().then(() => kick(50)); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') { NET.connected = false; renderNet(); }
      });
  }
  async function syncNow() {
    clearTimeout(kickT);
    if (!syncReady() || syncing || !navigator.onLine) { renderNet(); return; }
    syncing = true;
    try {
      await ensureSession(); await ensureNumber(); subscribe();
      await pushAll();
      NET.lastSync = Date.now(); NET.err = '';
    } catch (e) { NET.err = (e && (e.message || e.error_description)) || String(e); console.warn('sync', e); }
    finally { syncing = false; renderNet(); }
    if (dirtyCount()) { clearTimeout(loopT); loopT = setTimeout(syncNow, 5000); }
  }
  setInterval(() => { if (syncReady() && navigator.onLine && (dirtyCount() || !isConn())) syncNow(); }, 10000);

  async function pushAll() {
    for (const it of Object.values(ITEMS)) if (it.dirty) {
      const ts = it.ts, by = it.by;
      const { data, error } = await sb.rpc('expo_put_item', { p_app: SYNC_APP, p_cid: it.cid, p_field: it.field, p_value: await encText(it.v), p_ts: ts, p_by: by });
      if (error) throw error;
      const cur = ITEMS[key(it.cid, it.field)];
      if (cur.ts === ts && cur.by === by) { if (data.ts === ts && data.by_no === by) { cur.dirty = false; await saveItem(cur); } else { cur.dirty = false; await applyItem(data, true); } }
    }
    for (const p of Object.values(PHOTOS)) if (p.dirty) await pushPhoto(p);
    for (const r of Object.values(RECS)) if (r.dirty) await pushRec(r);
    refreshView();
  }
  async function storagePut(path, u8) { const { error } = await sb.storage.from('expo').upload(path, new Blob([u8], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream', upsert: true }); if (error) throw error; }
  async function storageGet(path) { const { data, error } = await sb.storage.from('expo').download(path); if (error) throw error; return new Uint8Array(await data.arrayBuffer()); }
  async function storageDel(paths) { paths = paths.filter(Boolean); if (!paths.length) return; const { error } = await sb.storage.from('expo').remove(paths); if (error) console.warn('remove', error); }
  async function pushPhoto(p) {
    const ts = p.ts;
    if (!p.deleted && !p.path) { const path = `${SYNC_APP}/ph/${p.id}/${ts}.bin`; await storagePut(path, await encBytes(new Uint8Array(await p.blob.arrayBuffer()))); p.path = path; await savePhoto(p); }
    const { data, error } = await sb.rpc('expo_put_photo', { p_id: p.id, p_app: SYNC_APP, p_cid: p.cid, p_kind: p.kind, p_path: p.deleted ? null : p.path, p_w: p.w || null, p_h: p.h || null, p_created: p.created, p_ts: ts, p_by: p.by, p_deleted: !!p.deleted });
    if (error) throw error;
    if (PHOTOS[p.id] !== p || p.ts !== ts) return;     // 그 사이 또 바뀜 → 다음 차례
    const won = data.ts === ts && data.by_no === p.by;
    if (won) { await storageDel(p.oldPaths || []); p.oldPaths = []; p.dirty = false; await savePhoto(p); }
    else { if (p.path && p.path !== data.path) await storageDel([p.path]); p.dirty = false; p.path = null; await applyPhoto(data, true); }
  }
  async function pushRec(r) {
    const ts = r.ts;
    if (!r.deleted && !r.path && r.enc) { r.status = 'uploading'; renderRecsSoon(); const path = `${SYNC_APP}/rec/${r.id}/${ts}.bin`; await storagePut(path, new Uint8Array(await r.enc.arrayBuffer())); r.path = path; await saveRec(r); }
    const { data, error } = await sb.rpc('expo_put_rec', { p_id: r.id, p_app: SYNC_APP, p_cid: r.cid, p_path: r.deleted ? null : r.path, p_mime: r.mime, p_duration: r.duration || null, p_size: r.size || null, p_created: r.created, p_ts: ts, p_by: r.by, p_deleted: !!r.deleted });
    if (error) throw error;
    if (RECS[r.id] !== r || r.ts !== ts) return;
    if (data.ts === ts && data.by_no === r.by) { if (r.deleted) await storageDel([...(r.oldPaths || []), data.path, r.path]); r.dirty = false; await applyRec(data, true); }
    else { r.dirty = false; await applyRec(data, true); }
    if (r.conv && !r.deleted && r.path && data.status === 'uploaded') { const q = await sb.rpc('expo_request_rec', { p_id: r.id, p_by: (ME && ME.no) || null }); if (!q.error && q.data) { r.conv = false; await applyRec(q.data, false); } }
  }
  async function pullAll() {
    for (const [table, fn] of [['expo_items', applyItem], ['expo_photos', applyPhoto], ['expo_recordings', applyRec]]) {
      const { data, error } = await sb.from(table).select('*').eq('app', SYNC_APP);
      if (error) { NET.err = error.message; continue; }
      for (const row of data) await fn(row);
    }
    NET.lastSync = Date.now(); refreshView(); renderNet();
  }
  async function applyItem(r, force) {
    const k = key(r.cid, r.field), cur = ITEMS[k];
    const remote = { ts: Number(r.ts), by: r.by_no };
    if (!force && cur && !newer(remote, cur)) return;
    let v; try { v = await decText(r.value_enc); } catch (e) { return; }
    const it = ITEMS[k] = { cid: r.cid, field: r.field, v, ts: remote.ts, by: remote.by, dirty: false };
    await saveItem(it); markChanged('item', r.cid, r.field);
  }
  async function applyPhoto(r, force) {
    const cur = PHOTOS[r.id]; const remote = { ts: Number(r.ts), by: r.by_no };
    if (!force && cur && !newer(remote, cur)) return;
    if (cur && cur.dirty && !force && !newer(remote, cur)) return;
    const p = Object.assign(cur || { id: r.id, oldPaths: [] }, { cid: r.cid, kind: r.kind, w: r.w, h: r.h, created: Number(r.created) || remote.ts, ts: remote.ts, by: remote.by, deleted: r.deleted, dirty: false });
    if (r.deleted) { p.blob = null; p.path = null; }
    else if (!cur || cur.path !== r.path || !cur.blob) {
      try { p.blob = new Blob([await decBytes(await storageGet(r.path))], { type: 'image/jpeg' }); p.path = r.path; }
      catch (e) { console.warn('photo get', e); if (!cur) return; }
    }
    PHOTOS[r.id] = p; await savePhoto(p); markChanged('photo', r.cid);
  }
  async function applyRec(r, force) {
    const cur = RECS[r.id]; const remote = { ts: Number(r.ts), by: r.by_no };
    const userSideNewer = !cur || newer(remote, cur) || force;
    if (cur && cur.dirty && !userSideNewer) return;
    const x = cur || { id: r.id, oldPaths: [] };
    if (userSideNewer) Object.assign(x, { cid: r.cid, mime: r.mime, duration: r.duration_ms, size: r.size_bytes, created: Number(r.created) || remote.ts, ts: remote.ts, by: remote.by, deleted: r.deleted, path: r.path, dirty: false });
    x.status = r.status; x.error = r.error || '';
    try { x.transcript = r.transcript_enc ? await decText(r.transcript_enc) : ''; } catch (_) { x.transcript = ''; }
    try { const s = r.summary_enc ? await decText(r.summary_enc) : ''; x.summary = s; } catch (_) { x.summary = ''; }
    if (x.deleted) x.enc = null;
    RECS[r.id] = x; await saveRec(x); markChanged('rec', r.cid);
  }

  /* ---------- 화면 공통 ---------- */
  let ROUTE = '#list';
  const CHANGED = new Set(); let refreshT = null;
  function markChanged(kind, cid, f) { CHANGED.add(kind + ':' + cid + ':' + (f || '')); }
  function refreshView() { clearTimeout(refreshT); refreshT = setTimeout(doRefresh, 120); }
  function doRefresh() {
    CHANGED.clear();
    if (!DATA || !$('main')) return;
    if (ROUTE.startsWith('#c/')) updateDetail(ROUTE.slice(3));
    else if (ROUTE === '#report') updateReport();
    else if (ROUTE === '#more') { /* 정적 */ }
    else { const y = window.scrollY; renderList(); window.scrollTo(0, y); }
    renderNet();
  }
  function showSaved() { const el = $('#saved'); if (el) el.textContent = lastSaved ? '저장됨 ' + hhmmss(new Date(lastSaved)) : '자동 저장'; }
  function renderMe() { const el = $('#me'); if (el) el.textContent = ME.no ? '나: 사용자 ' + ME.no : '나: 임시 번호'; }
  function renderNet() {
    renderMe();
    const el = $('#net'); if (!el) return;
    const n = dirtyCount();
    let cls = 'off', txt;
    if (SC.kind !== 'supabase') txt = '이 기기에만 저장';
    else if (!SKEY) txt = '함께 쓰기 꺼짐(비밀번호 필요)';
    else if (!navigator.onLine) txt = `오프라인 · 보낼 것 ${n}건`;
    else if (NET.connected) { cls = 'on'; txt = n ? `보내는 중 ${n}건` : '실시간 연결됨'; }
    else txt = '연결 중…';
    el.className = 'net ' + cls; el.textContent = txt;
    const pe = $('#peers'); if (pe) pe.textContent = NET.connected && NET.peers.length ? '접속: ' + NET.peers.map(n => '사용자 ' + n).join(', ') : '';
  }
  function shell(title, back, body, nav) {
    document.body.className = CFG.id;
    document.body.innerHTML = `<div class="top">${back ? '<button class="back" id="back" aria-label="뒤로">‹</button>' : ''}<h1>${esc(title)}</h1><span class="saved" id="saved"></span></div>
      <div class="who">${NS_TEST ? '<span class="testns">테스트 공간</span>' : ''}<b id="me"></b><span id="net" class="net"></span><span id="peers" class="peers"></span></div>
      <main>${body}</main>${nav || ''}<div class="toast" id="toast"></div><div id="print-root"></div>`;
    if (back) $('#back').onclick = () => { location.hash = back; };
    showSaved(); renderNet();
    document.querySelectorAll('.nav button').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
  }
  const navBar = on => `<nav class="nav">${[['#list', '업체 목록'], ['#report', '보고서'], ['#more', '보내기·설정']].map(([h, t]) => `<button data-go="${h}" class="${on === h ? 'on' : ''}">${t}</button>`).join('')}</nav>`;
  let toastT; function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }

  /* ---------- 잠금 해제 ---------- */
  async function unlockWith(pw) {
    const enc = await (await fetch('data.enc.json', { cache: 'no-cache' })).json();
    const k = await deriveAes(pw, b64d(enc.salt), enc.iter);
    const data = JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.iv) }, k, b64d(enc.ct))));
    const skey = await deriveAes(pw, 'expo2026-sync-v1', 310000);
    const authpw = await deriveHex(pw, 'expo2026-auth-v1', 310000);
    await idbPut('kv', data, 'data'); await idbPut('kv', skey, 'skey'); await idbPut('kv', authpw, 'authpw');
    DATA = data; SKEY = skey; AUTHPW = authpw;
  }
  function renderLock() {
    document.body.innerHTML = `<div class="top"><h1>${esc(CFG.title)}</h1></div>
    <div class="lock"><div class="sec"><h2>처음 한 번만 비밀번호를 넣어 주세요</h2>
    <p class="small">업체 담당자 연락처가 들어 있어서 잠가 두었어요. 한 번 열면 이 폰에서는 다시 묻지 않아요. 같은 링크를 연 사람끼리 기록이 실시간으로 함께 보여요.</p>
    <form id="lf"><input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호">
    <div class="err" id="lerr"></div><button class="btn big" id="lbtn">열기</button></form></div></div>`;
    $('#lf').onsubmit = async ev => {
      ev.preventDefault(); const b = $('#lbtn'); b.classList.add('busy'); b.textContent = '여는 중…'; $('#lerr').textContent = '';
      try { await unlockWith($('#pw').value.trim()); await start(); }
      catch (e) { $('#lerr').textContent = (e && e.name === 'OperationError') ? '비밀번호가 맞지 않아요.' : '열지 못했어요. 인터넷 연결을 확인해 주세요.'; b.classList.remove('busy'); b.textContent = '열기'; }
    };
  }
  const upgradeBanner = () => (SC.kind === 'supabase' && !SKEY) ? `<form class="sec warnbox" id="upf"><b>새 기능: 함께 쓰기</b><p class="small">이 폰에 적어 둔 기록은 그대로 있어요. 다른 사람과 실시간으로 함께 보려면 비밀번호를 한 번만 다시 넣어 주세요.</p>
      <input id="upw" type="password" placeholder="비밀번호" aria-label="비밀번호"><div class="err" id="uperr"></div><button class="btn big" id="upb">함께 쓰기 켜기</button></form>` : '';
  function bindUpgrade() {
    const f = $('#upf'); if (!f) return;
    f.onsubmit = async ev => { ev.preventDefault(); const b = $('#upb'); b.classList.add('busy');
      try { await unlockWith($('#upw').value.trim()); toast('함께 쓰기를 켰어요'); kick(50); route(); }
      catch (e) { $('#uperr').textContent = (e && e.name === 'OperationError') ? '비밀번호가 맞지 않아요.' : '지금은 켤 수 없어요. 인터넷을 확인해 주세요.'; b.classList.remove('busy'); } };
  }

  /* ---------- 목록 ---------- */
  function renderList() {
    const cs = DATA.companies;
    const cnt = { none: 0, doing: 0, done: 0 }; cs.forEach(c => cnt[status(c.id)]++);
    const items = cs.map(c => {
      const st = status(c.id), sit = item(c.id, 'status');
      const nr = recsOf(c.id).length;
      const filled = FIELDS.filter(f => (val(c.id, f) || '').trim()).length;
      return `<div class="card st-${st}" data-id="${c.id}"><div class="crow"><div class="mark">${esc(c.mark)}</div>
      <div class="cmain" data-open="${c.id}"><div class="cname">${esc(c.name)}</div>${c.topic ? `<div class="ctopic">${esc(c.topic)}</div>` : ''}
      <span class="badge ${c.booth ? '' : 'none'}">${esc(c.booth || '부스 위치 미표기')}</span>
      <div class="cask">물어볼 것: ${esc(c.ask)}</div>
      <div class="cstat">적은 칸 ${filled}/${FIELDS.length} · 녹음 ${nr}</div></div>
      <div class="stcol"><button class="chk s-${st}" data-cyc="${c.id}" aria-label="방문 상태 바꾸기">${STATUS[st]}</button>${sit ? `<div class="mk">${esc(marker(sit))}</div>` : ''}</div></div></div>`;
    }).join('');
    shell(CFG.title, null, `${upgradeBanner()}
      <div class="dash"><div class="d done"><b>${cnt.done}</b>완료</div><div class="d doing"><b>${cnt.doing}</b>방문중</div><div class="d none"><b>${cnt.none}</b>미방문</div></div>
      <div class="bar"><i class="b-done" style="width:${cnt.done / cs.length * 100}%"></i><i class="b-doing" style="width:${cnt.doing / cs.length * 100}%"></i></div>
      <div id="cards">${items}</div>`, navBar('#list'));
    bindUpgrade();
    document.querySelectorAll('[data-open]').forEach(el => el.onclick = () => { location.hash = '#c/' + el.dataset.open; });
    document.querySelectorAll('[data-cyc]').forEach(el => el.onclick = () => { const cid = el.dataset.cyc; const nx = { none: 'doing', doing: 'done', done: 'none' }[status(cid)]; setField(cid, 'status', nx); renderList(); });
  }

  /* ---------- 업체 상세 ---------- */
  function renderDetail(cid) {
    const c = DATA.companies.find(x => x.id === cid); if (!c) { location.hash = '#list'; return; }
    const contacts = c.contacts.length ? c.contacts.map(p => `<div class="contact"><div><b>${esc(p.name)}</b> <span class="small">${esc(p.role)}</span></div>${p.phone ? `<a class="tel" href="tel:${esc(p.phone.replace(/[^0-9+]/g, ''))}">📞 ${esc(p.phone)}</a>` : '<span class="small">번호 없음</span>'}</div>`).join('') : '<p class="small">명함 미수령 — 부스에서 담당자를 확인하세요.</p>';
    const ta = (f, ph) => `<label class="f" for="f-${f}">${FIELD_LABEL[f]}</label><textarea id="f-${f}" data-f="${f}" placeholder="${esc(ph)}">${esc(val(cid, f))}</textarea><div class="mk" id="mk-${f}">${esc(marker(item(cid, f)))}</div>`;
    shell(c.mark + '. ' + c.name, '#list', `
      <div class="seg" id="seg">${Object.entries(STATUS).map(([k, t]) => `<button data-st="${k}">${t}</button>`).join('')}</div><div class="mk" id="mk-status" style="text-align:center"></div>
      <div class="sec" style="margin-top:10px"><h2>${esc(c.topic || c.name)}</h2><span class="badge ${c.booth ? '' : 'none'}">${esc(c.booth || '부스 위치 미표기')}</span>
      <ul style="margin-top:8px">${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>${c.extra ? `<p class="small">※ ${esc(c.extra)}</p>` : ''}</div>
      <div class="sec"><h2>물어볼 것</h2><div class="ask">${esc(c.ask)}</div>${ta('answer', '물어본 내용에 대한 답을 적어 주세요')}</div>
      <div class="sec" id="recsec"></div>
      <div class="sec"><h2>담당자</h2>${contacts}</div>
      <div class="sec">${ta('met', '직책 · 연락처 (이름은 적어도 되고 안 적어도 돼요)')}</div>`,
      `<div class="savebar"><button class="btn sub" id="prev">‹ 이전</button><button class="btn" id="savebtn">저장</button><button class="btn sub" id="next">다음 ›</button></div>`);
    document.querySelectorAll('textarea[data-f]').forEach(t => t.addEventListener('input', () => { const it = setField(cid, t.dataset.f, t.value); $('#mk-' + t.dataset.f).textContent = marker(it); }));
    document.querySelectorAll('#seg [data-st]').forEach(b => b.onclick = () => { setField(cid, 'status', b.dataset.st); updateDetail(cid); });
    $('#savebtn').onclick = async () => { await syncNow(); toast((navigator.onLine ? '저장했어요 ' : '이 기기에 저장했어요(연결되면 보내요) ') + hhmmss(new Date())); };
    const i = DATA.companies.indexOf(c);
    $('#prev').onclick = () => { location.hash = i > 0 ? '#c/' + DATA.companies[i - 1].id : '#list'; };
    $('#next').onclick = () => { location.hash = i < DATA.companies.length - 1 ? '#c/' + DATA.companies[i + 1].id : '#report'; };
    PH_SIG = ''; REC_SIG = '';
    updateDetail(cid);
  }
  let PH_SIG = '', REC_SIG = '';
  function updateDetail(cid) {
    for (const f of FIELDS) {
      const t = $('#f-' + f); if (!t) continue; const it = item(cid, f);
      const focusedDirty = document.activeElement === t && it && it.dirty;
      if (!focusedDirty && t.value !== (it ? it.v : '')) t.value = it ? it.v : '';
      $('#mk-' + f).textContent = marker(it);
    }
    const st = status(cid);
    document.querySelectorAll('#seg [data-st]').forEach(b => b.className = b.dataset.st === st ? 'on s-' + st : '');
    const ms = $('#mk-status'); if (ms) ms.textContent = item(cid, 'status') ? '상태 ' + marker(item(cid, 'status')) : '';
    drawRecs(cid);                       // 사진 칸은 뺐음(drawPhotos는 쓰지 않음)
  }
  function drawPhotos(cid) {
    const sig = photosOf(cid).map(p => p.id + p.ts + (p.blob ? 1 : 0) + p.kind + (p.dirty ? 'd' : '')).join();
    if (sig === PH_SIG) return; PH_SIG = sig;
    for (const kind of ['photo', 'card']) {
      const box = $('#ph-' + kind); if (!box) continue; const list = photosOf(cid, kind);
      $('#cnt-' + kind).textContent = list.length ? list.length + '장' : '';
      box.innerHTML = list.map(p => `<div class="phw"><div class="ph">${p.blob ? `<img src="${urlOf(p)}" alt="">` : '<span class="small">받는 중…</span>'}<button data-del="${p.id}" aria-label="사진 지우기">×</button></div>
        <label class="rep-btn">바꾸기<input type="file" accept="image/*" data-rep="${p.id}" hidden></label><div class="mk">${esc(marker(p))}${p.dirty ? ' · 보낼 것' : ''}</div></div>`).join('');
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('이 사진을 지울까요? 다른 사람 화면에서도 지워져요.')) return; await deletePhoto(b.dataset.del); drawPhotos(cid); kick(100); });
      box.querySelectorAll('[data-rep]').forEach(inp => inp.onchange = async () => { const f = inp.files[0]; inp.value = ''; if (!f) return; await replacePhoto(inp.dataset.rep, f); drawPhotos(cid); toast('사진을 바꿨어요'); kick(100); });
    }
  }
  async function resizeImage(file, max = 1600) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      let w = img.naturalWidth, h = img.naturalHeight; const s = Math.min(1, max / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85)); cv.width = cv.height = 0;
      return { blob, w, h };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addPhoto(cid, kind, file) {
    const r = await resizeImage(file); const now = Date.now();
    const p = { id: cid + '-' + kind + '-' + rid(), cid, kind, blob: r.blob, w: r.w, h: r.h, created: now, ts: now, by: myBy(), path: null, deleted: false, dirty: true, oldPaths: [] };
    PHOTOS[p.id] = p; await savePhoto(p); return p;
  }
  async function deletePhoto(id) { const p = PHOTOS[id]; if (!p) return; if (p.path) p.oldPaths = [...(p.oldPaths || []), p.path]; Object.assign(p, { deleted: true, blob: null, path: null, ts: Date.now(), by: myBy(), dirty: true }); await savePhoto(p); }
  async function replacePhoto(id, file) { const p = PHOTOS[id]; if (!p) return; const r = await resizeImage(file); if (p.path) p.oldPaths = [...(p.oldPaths || []), p.path]; Object.assign(p, { blob: r.blob, w: r.w, h: r.h, path: null, ts: Date.now(), by: myBy(), dirty: true, deleted: false }); await savePhoto(p); }

  /* ---------- 녹음 ---------- */
  let RS = null, recTimer = null;
  const fmtDur = ms => { const s = Math.round((ms || 0) / 1000); return pad(Math.floor(s / 60)) + ':' + pad(s % 60); };
  function renderRecsSoon() { REC_SIG = ''; refreshView(); }
  function parseSummary(s) { if (!s) return null; try { const o = JSON.parse(s); if (o && typeof o === 'object' && !Array.isArray(o)) { if ((o.topics || []).length || (o.qa || []).length) return o; if (o.text) return { text: String(o.text) }; return { text: '요약 내용이 없어요.' }; } } catch (_) {} return { text: String(s) }; }
  function summaryHTML(o) {
    if (!o) return '';
    if (o.text) return `<div class="pre">${esc(o.text)}</div>`;
    return `${(o.topics || []).map(t => `<div class="sumt">${esc(t.title)}</div><ul>${(t.lines || []).map(l => `<li>${esc(l)}</li>`).join('')}</ul>`).join('')}
      ${(o.qa || []).length ? `<div class="sumt">문답</div>${o.qa.map(q => `<div class="qa"><b>Q.</b> ${esc(q.q)}<br><b>A.</b> ${esc(q.a)}</div>`).join('')}` : ''}`;
  }
  function speakersLine(o) { const sp = o && o.speakers; if (!sp || typeof sp !== 'object') return ''; const t = Object.entries(sp).map(([k, v]) => `${k} = ${v}`).join(' · '); return t ? `<div class="small">화자: ${esc(t)}</div>` : ''; }
  function summaryText(o, r) {
    if (!o) return ''; const L = [`[녹음 요약 ${r ? hhmm(new Date(r.created)) : ''}]`];
    if (o.text) L.push(o.text);
    else {
      (o.topics || []).forEach(t => { L.push('■ ' + t.title); (t.lines || []).forEach(l => L.push('- ' + l)); });
      (o.qa || []).forEach(q => L.push('Q. ' + q.q, 'A. ' + q.a));
    }
    return L.join('\n');
  }
  function drawRecs(cid) {
    const box = $('#recsec'); if (!box) return;
    const list = recsOf(cid);
    const sig = cid + ':' + (RS && RS.cid === cid ? 'R' : '') + list.map(r => [r.id, r.ts, r.status, r.dirty, r.conv ? 1 : 0, (r.summary || '').length, (r.transcript || '').length, r.enc ? 1 : 0].join('/')).join();
    if (sig === REC_SIG) return; REC_SIG = sig;
    const recording = RS && RS.cid === cid;
    box.innerHTML = `<h2>녹음 <span class="small">${list.length ? list.length + '개' : ''}</span></h2>
      <div class="notice">🎙 녹음 전 상대방에게 녹음 사실을 알려 주세요.</div>
      <button class="btn big ${recording ? 'warn' : ''}" id="recbtn">${recording ? '■ 녹음 멈추기 ' + fmtDur(Date.now() - RS.start) : '● 녹음 시작'}</button>
      <p class="small" style="margin:6px 2px 0">녹음을 마치고 [변환]을 누르면 30초~1분 뒤에 분석이 끝나요</p>
      <div id="reclist">${list.map(r => {
        const st = r.dirty && !r.path ? 'local' : r.status || 'uploaded'; const o = parseSummary(r.summary);
        return `<div class="rec"><div class="rhead"><b>${hhmm(new Date(r.created))} · ${fmtDur(r.duration)}</b><span class="rst rs-${st}">${REC_STATUS[st] || st}${st === 'local' && r.conv ? ' · 변환 예약' : ''}</span></div>
          <div class="mk">${esc(marker(r))}${r.error ? ' · 사유: ' + esc(r.error) : ''}</div>
          <div class="btns"><button class="btn sub" data-play="${r.id}">▶ 듣기</button><button class="btn warn" data-rdel="${r.id}">지우기</button></div>
          ${(st === 'uploaded' || (st === 'local' && !r.conv)) ? `<button class="btn big" data-conv="${r.id}">변환</button>` : ''}${st === 'failed' ? `<button class="btn sub big" data-conv="${r.id}">다시 시도</button>` : ''}${st === 'done' ? `<button class="btn sub" data-conv="${r.id}">다시 변환</button>` : ''}
          <div id="aud-${r.id}"></div>
          ${o ? `<div class="sumbox"><div class="sumh">녹음 요약</div>${speakersLine(o)}${summaryHTML(o)}</div>` : ''}
          ${r.transcript ? `<details class="sub"><summary>받아쓰기 원문</summary><div class="pre">${esc(r.transcript)}</div></details>` : ''}</div>`;
      }).join('')}</div>`;
    $('#recbtn').onclick = () => recording ? stopRec() : startRec(cid);
    box.querySelectorAll('[data-play]').forEach(b => b.onclick = () => playRec(b.dataset.play));
    box.querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => { if (!confirm('이 녹음을 지울까요? 받아쓰기·요약도 함께 지워지고, 다른 사람 화면에서도 사라져요.')) return; await deleteRec(b.dataset.rdel); REC_SIG = ''; drawRecs(cid); kick(100); });
    box.querySelectorAll('[data-conv]').forEach(b => b.onclick = () => { const r = RECS[b.dataset.conv]; if (r && r.status === 'done' && !confirm('이 녹음을 다시 변환할까요? 지금 요약은 새 결과로 바뀌어요.')) return; requestConv(b.dataset.conv, cid); });
  }

  // [변환]/[다시 시도]: 서버에서 uploaded·failed → pending (작업자가 그때부터 받아쓰기·요약)
  async function requestConv(id, cid) {
    const r = RECS[id]; if (!r) return;
    if (!r.path) { r.conv = true; await saveRec(r); REC_SIG = ''; drawRecs(cid); toast('올라가면 바로 변환해요.'); kick(100); return; }
    if (!sb || !isConn()) { toast('연결되면 다시 눌러 주세요.'); return; }
    try { const { data, error } = await sb.rpc('expo_request_rec', { p_id: id, p_by: (ME && ME.no) || null }); if (error) throw error; r.conv = false; await applyRec(data, false); REC_SIG = ''; drawRecs(cid); toast('변환을 시작했어요.'); }
    catch (e) { toast('지금은 변환을 요청할 수 없어요.'); }
  }
  async function startRec(cid) {
    if (RS) return;
    if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('이 브라우저는 녹음을 지원하지 않아요.'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('마이크를 쓸 수 없어요. 브라우저 설정에서 마이크를 허용해 주세요.'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'].find(m => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
    let mr; try { mr = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 24000 }, mime ? { mimeType: mime } : {})); } catch (_) { mr = new MediaRecorder(stream); }
    RS = { cid, mr, chunks: [], start: Date.now(), stream, mime: mr.mimeType || mime || 'audio/webm' };
    mr.ondataavailable = e => { if (e.data && e.data.size) RS && RS.chunks.push(e.data); };
    mr.start(1000);
    REC_SIG = ''; drawRecs(cid);
    clearInterval(recTimer); recTimer = setInterval(() => { const b = $('#recbtn'); if (RS && b) b.textContent = '■ 녹음 멈추기 ' + fmtDur(Date.now() - RS.start); if (RS && Date.now() - RS.start > 60 * 60 * 1000) stopRec(); }, 500);
  }
  async function stopRec() {
    if (!RS) return; const R = RS; clearInterval(recTimer);
    await new Promise(res => { R.mr.onstop = res; try { R.mr.stop(); } catch (_) { res(); } });
    R.stream.getTracks().forEach(t => t.stop()); RS = null;
    const blob = new Blob(R.chunks, { type: R.mime }); const now = Date.now();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const plain = !SKEY; const enc = plain ? bytes : await encBytes(bytes);
    const r = { id: R.cid + '-rec-' + rid(), cid: R.cid, mime: R.mime, duration: now - R.start, size: enc.length, created: R.start, ts: now, by: myBy(), path: null, deleted: false, dirty: true, enc: new Blob([enc]), plain, status: 'local', transcript: '', summary: '', oldPaths: [] };
    RECS[r.id] = r; await saveRec(r);
    toast(navigator.onLine ? '녹음을 저장했어요. 올리는 중…' : '녹음을 이 기기에 저장했어요. 연결되면 자동으로 올려요.');
    REC_SIG = ''; drawRecs(R.cid); kick(100);
  }
  async function playRec(id) {
    const r = RECS[id]; const box = $('#aud-' + id); if (!r || !box) return;
    try {
      let bytes;
      if (r.enc) bytes = new Uint8Array(await r.enc.arrayBuffer());
      else { if (!navigator.onLine) { toast('이 녹음은 인터넷이 될 때 들을 수 있어요.'); return; } await ensureSession(); bytes = await storageGet(r.path); r.enc = new Blob([bytes]); r.plain = false; await saveRec(r); }
      const audio = r.plain ? bytes : await decBytes(bytes);
      const u = URL.createObjectURL(new Blob([audio], { type: (r.mime || 'audio/webm').split(';')[0] }));
      box.innerHTML = `<audio controls src="${u}" style="width:100%;margin-top:6px"></audio>`; box.querySelector('audio').play().catch(() => {});
    } catch (e) { toast('녹음을 열지 못했어요.'); }
  }
  async function deleteRec(id) { const r = RECS[id]; if (!r) return; if (r.path) r.oldPaths = [...(r.oldPaths || []), r.path]; Object.assign(r, { deleted: true, enc: null, ts: Date.now(), by: myBy(), dirty: true }); await saveRec(r); }
  // pushRec에서 평문 녹음(함께 쓰기 켜기 전) 암호화
  const _pushRec = pushRec;
  pushRec = async function (r) { if (r.plain && r.enc && SKEY) { r.enc = new Blob([await encBytes(new Uint8Array(await r.enc.arrayBuffer()))]); r.plain = false; await saveRec(r); } return _pushRec(r); };

  /* ---------- 보고서 (사용자 번호 없음, 녹음 원문·파일 없음) ---------- */
  const masked = () => localStorage.getItem(LS + 'mask') === '1';
  const maskPhone = s => masked() ? String(s).replace(/01[016789][- .]?\d{3,4}[- .]?\d{4}/g, '010-****-****') : s;
  const reportModel = () => DATA.companies.map(c => ({ c, st: status(c.id), v: f => val(c.id, f), recs: recsOf(c.id).map(r => ({ r, o: parseSummary(r.summary) })).filter(x => x.o) }));
  const contactLine = c => c.contacts.length ? c.contacts.map(p => `${p.name} ${p.role}${p.phone ? ' ' + maskPhone(p.phone) : ''}`).join(' · ') : '명함 미수령';
  const reportTitle = () => `KINTEX 스마트건설 EXPO 방문 보고서 — ${CFG.title}`;
  const visitDate = () => val('_meta', 'visitDate') || '2026-11-27';
  const counts = m => { const c = { none: 0, doing: 0, done: 0 }; m.forEach(x => c[x.st]++); return c; };
  function reportHTML() {
    const m = reportModel(); const n = counts(m);
    const fig = (p, cap) => `<figure><img src="${urlOf(p)}" alt=""><figcaption>${cap}</figcaption></figure>`;
    const field = (lbl, v) => `<div><span class="lbl">${lbl}</span> <span class="pre">${esc(maskPhone(v || '').trim() || '—')}</span></div>`;
    return `<div class="rep" id="rep">
      <h1>${esc(reportTitle())}</h1>
      <div class="rmeta">${COMPANY} · 방문일 ${esc(visitDate())} · 완료 ${n.done} · 방문중 ${n.doing} · 미방문 ${n.none} (총 ${m.length}곳) · 작성 ${esc(fmtTime(Date.now()))}</div>
      <h2>1. 요약</h2>
      <table><thead><tr><th style="width:12%">순서</th><th>업체</th><th style="width:20%">상태</th></tr></thead><tbody>
      ${m.map(x => `<tr><td>${esc(x.c.mark)}</td><td>${esc(x.c.name)}</td><td>${STATUS[x.st]}</td></tr>`).join('')}</tbody></table>
      <h2>2. 종합 의견</h2><div class="opinion">${esc(val('_meta', 'opinion').trim() || '—')}</div>
      <h2>3. 업체별 정리</h2>
      ${m.map(x => `<div class="co"><h3>${esc(x.c.mark)}. ${esc(x.c.name)}${x.c.topic ? ' — ' + esc(x.c.topic) : ''} <span style="font-weight:400;color:#555">(${STATUS[x.st]}${x.c.booth ? ' · ' + esc(x.c.booth) : ''})</span></h3>
        <div class="lbl">핵심 기술</div><ul>${x.c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        ${field('물어볼 것:', x.c.ask)}${field('받은 답변:', x.v('answer'))}${field('만난 사람:', x.v('met'))}
        ${x.recs.map(({ r, o }) => `<div class="rsum"><span class="lbl">녹음 요약 (${hhmm(new Date(r.created))}, ${fmtDur(r.duration)})</span>${summaryHTML(o)}</div>`).join('')}
        <div><span class="lbl">담당자(사전 자료):</span> ${esc(contactLine(x.c))}</div>
      </div>`).join('')}
    </div>`;
  }
  function sumPlain(o) { return summaryText(o).split('\n').slice(1).join('\n'); }
  function reportText() {
    const m = reportModel(); const n = counts(m); const L = [];
    L.push('# ' + reportTitle(), '', `${COMPANY} · 방문일 ${visitDate()} · 완료 ${n.done} · 방문중 ${n.doing} · 미방문 ${n.none} (총 ${m.length}곳) · 작성 ${fmtTime(Date.now())}`, '');
    L.push('## 종합 의견', '', val('_meta', 'opinion').trim() || '-', '', '## 업체별 정리', '');
    for (const x of m) {
      L.push(`### ${x.c.mark}. ${x.c.name}${x.c.topic ? ' — ' + x.c.topic : ''}`, `- 상태: ${STATUS[x.st]}`, `- 부스: ${x.c.booth || '미표기'}`, '- 핵심 기술:');
      x.c.bullets.forEach(b => L.push('  - ' + b));
      L.push(`- 물어볼 것: ${x.c.ask}`, `- 받은 답변: ${maskPhone(x.v('answer').trim()) || '-'}`, `- 만난 사람: ${maskPhone(x.v('met').trim()) || '-'}`);
      x.recs.forEach(({ r, o }) => L.push(`- 녹음 요약 (${hhmm(new Date(r.created))}, ${fmtDur(r.duration)}):`, ...sumPlain(o).split('\n').map(s => '  ' + s)));
      L.push(`- 담당자(사전 자료): ${contactLine(x.c)}`, '');
    }
    return L.join('\n');
  }
  function csvText() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['순서', '업체', '주제', '부스', '상태', '물어볼 것', '받은 답변', '만난 사람', '녹음 요약', '담당자(사전 자료)']];
    for (const x of reportModel()) rows.push([x.c.mark, x.c.name, x.c.topic, x.c.booth, STATUS[x.st], x.c.ask, maskPhone(x.v('answer')), maskPhone(x.v('met')), x.recs.map(({ o }) => sumPlain(o)).join('\n---\n'), contactLine(x.c)]);
    return '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  let docxP;
  function loadDocx() { return docxP || (docxP = new Promise((res, rej) => { if (window.docx) return res(window.docx); const s = document.createElement('script'); s.src = '../shared/docx.iife.js'; s.onload = () => res(window.docx); s.onerror = () => { docxP = null; rej(new Error('docx')); }; document.head.appendChild(s); })); }
  async function reportDocx() {
    const D = await loadDocx();
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType } = D;
    const P = (text, o = {}) => new Paragraph({ children: [new TextRun({ text, bold: o.bold, color: o.color, size: o.size })], spacing: { after: o.after == null ? 60 : o.after } });
    const LP = (label, v) => { const lines = String(v || '-').split('\n'); return new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label + ' ', bold: true, color: '1F3A5F' }), ...lines.map((t, i) => new TextRun(i ? { text: t, break: 1 } : t))] }); };
    const cell = (t, o = {}) => new TableCell({ width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined, shading: o.head ? { fill: 'EEF2F7' } : undefined, children: String(t).split('\n').map(s => new Paragraph({ children: [new TextRun({ text: s, bold: o.head })] })) });
    const m = reportModel(); const n = counts(m); const kids = [];
    kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: reportTitle(), bold: true, size: 32 })] }));
    kids.push(P(`${COMPANY} · 방문일 ${visitDate()} · 완료 ${n.done} · 방문중 ${n.doing} · 미방문 ${n.none} (총 ${m.length}곳) · 작성 ${fmtTime(Date.now())}`, { color: '555555', after: 200 }));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. 요약')] }));
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: [cell('순서', { head: 1, w: 12 }), cell('업체', { head: 1, w: 68 }), cell('상태', { head: 1, w: 20 })] }),
      ...m.map(x => new TableRow({ children: [cell(x.c.mark), cell(x.c.name), cell(STATUS[x.st])] }))] }));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun('2. 종합 의견')] }));
    String(val('_meta', 'opinion').trim() || '—').split('\n').forEach(t => kids.push(P(t)));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun('3. 업체별 정리')] }));
    for (const x of m) {
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200 }, children: [new TextRun(`${x.c.mark}. ${x.c.name}${x.c.topic ? ' — ' + x.c.topic : ''}`), new TextRun({ text: `  (${STATUS[x.st]}${x.c.booth ? ' · ' + x.c.booth : ''})`, color: '666666', size: 20 })] }));
      kids.push(P('핵심 기술', { bold: true, color: '1F3A5F', after: 20 }));
      x.c.bullets.forEach(b => kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] })));
      kids.push(LP('물어볼 것:', x.c.ask), LP('받은 답변:', maskPhone(x.v('answer').trim()) || '—'), LP('만난 사람:', maskPhone(x.v('met').trim()) || '—'));
      x.recs.forEach(({ r, o }) => kids.push(LP(`녹음 요약 (${hhmm(new Date(r.created))}, ${fmtDur(r.duration)}):`, sumPlain(o))));
      kids.push(LP('담당자(사전 자료):', contactLine(x.c)));
    }
    const doc = new Document({ creator: COMPANY, title: reportTitle(), styles: { default: { document: { run: { font: { ascii: 'Malgun Gothic', eastAsia: '맑은 고딕', hAnsi: 'Malgun Gothic' }, size: 21 } } } },
      sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 1000, right: 1000 } } }, children: kids }] });
    return Packer.toBlob(doc);
  }
  function fileStamp() { const d = new Date(); return `${ymd(d).replace(/-/g, '')}_${pad(d.getHours())}${pad(d.getMinutes())}`; }
  const baseName = () => `EXPO방문_${CFG.id === 'p1' ? '1순위' : '2순위'}_${fileStamp()}`;
  async function deliver(blob, name, how) {
    if (how === 'share') {
      const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      else toast('이 폰에서는 바로 보내기가 안 돼서 파일로 저장할게요.');
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast('파일을 저장했어요: ' + name);
  }
  function renderReport() {
    shell('보고서 · ' + CFG.title, null, `
      <div class="sec"><h2>보고서 정보</h2>
        <label class="f" for="m-visitDate">방문일</label><input type="date" id="m-visitDate" data-m="visitDate" value="${esc(visitDate())}"><div class="mk" id="mk-m-visitDate"></div>
        <label class="f" for="m-opinion">종합 의견 <span class="small">(함께 쓰는 칸)</span></label><textarea id="m-opinion" data-m="opinion" style="min-height:140px" placeholder="전체적으로 본 것, 우선 협력 대상, 다음에 할 일">${esc(val('_meta', 'opinion'))}</textarea><div class="mk" id="mk-m-opinion"></div>
        <label class="chkline"><input type="checkbox" id="m-mask" ${masked() ? 'checked' : ''}> 보고서에서 전화번호 가리기</label>
      </div>
      <div class="sec"><h2>보고서 만들기</h2>
        <div class="btns one"><button class="btn big" id="r-print">🖨 인쇄 · PDF로 저장 (A4)</button></div>
        <div class="btns"><button class="btn sub" id="r-docx-s">워드 보내기</button><button class="btn sub" id="r-docx">워드(DOCX) 받기</button>
        <button class="btn sub" id="r-txt-s">텍스트 보내기</button><button class="btn sub" id="r-txt">텍스트 받기</button></div>
        <p class="small">PDF: 인쇄 화면에서 ‘PDF로 저장’을 고르세요. 아래는 미리보기예요. 녹음 원문과 녹음 파일은 보고서에 넣지 않아요.</p></div>
      <div class="rep-wrap" id="preview"></div>`, navBar('#report'));
    document.querySelectorAll('[data-m]').forEach(el => el.addEventListener('input', () => { const it = setField('_meta', el.dataset.m, el.value); $('#mk-m-' + el.dataset.m).textContent = marker(it); clearTimeout(el._t); el._t = setTimeout(() => { $('#preview').innerHTML = reportHTML(); }, 400); }));
    $('#m-mask').onchange = ev => { localStorage.setItem(LS + 'mask', ev.target.checked ? '1' : '0'); $('#preview').innerHTML = reportHTML(); };
    $('#r-print').onclick = async () => { const pr = $('#print-root'); pr.innerHTML = reportHTML(); document.body.classList.add('printing'); await waitImages(pr); window.print(); };
    window.onafterprint = () => { document.body.classList.remove('printing'); const pr = $('#print-root'); if (pr) pr.innerHTML = ''; };
    const doDocx = how => async ev => { const b = ev.currentTarget; b.classList.add('busy'); try { await deliver(await reportDocx(), baseName() + '_보고서.docx', how); } catch (e) { console.error(e); toast('워드 파일을 만들지 못했어요.'); } b.classList.remove('busy'); };
    $('#r-docx').onclick = doDocx('save'); $('#r-docx-s').onclick = doDocx('share');
    $('#r-txt').onclick = () => deliver(new Blob([reportText()], { type: 'text/markdown;charset=utf-8' }), baseName() + '_보고서.md', 'save');
    $('#r-txt-s').onclick = () => deliver(new Blob([reportText()], { type: 'text/plain;charset=utf-8' }), baseName() + '_보고서.txt', 'share');
    updateReport(true);
  }
  function updateReport(force) {
    for (const f of ['visitDate', 'opinion']) {
      const el = $('#m-' + f); if (!el) continue; const it = item('_meta', f);
      if (!(document.activeElement === el && it && it.dirty) && it && el.value !== it.v) el.value = it.v;
      $('#mk-m-' + f).textContent = marker(it);
    }
    const pv = $('#preview'); if (pv) pv.innerHTML = reportHTML();
  }
  function waitImages(root) { return Promise.all([...root.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); }

  /* ---------- 백업 ---------- */
  const blobToB64 = async b => b64e(new Uint8Array(await b.arrayBuffer()));
  async function backupBlob() {
    const photos = []; for (const p of Object.values(PHOTOS)) photos.push(Object.assign(photoRec(p), { blob: undefined, b64: p.blob ? await blobToB64(p.blob) : null }));
    const recs = []; for (const r of Object.values(RECS)) recs.push(Object.assign(recRec(r), { enc: undefined, b64: r.enc ? await blobToB64(r.enc) : null }));
    const obj = { kind: 'expo-visit-backup', version: 2, app: CFG.id, title: CFG.title, exportedAt: new Date().toISOString(), items: Object.values(ITEMS), photos, recs };
    return new Blob([JSON.stringify(obj)], { type: 'application/json' });
  }
  async function importBackup(file) {
    let obj; try { obj = JSON.parse(await file.text()); } catch (_) { throw new Error('파일을 읽지 못했어요.'); }
    if (!obj || obj.kind !== 'expo-visit-backup') throw new Error('방문 기록 백업 파일이 아니에요.');
    if (obj.app !== CFG.id) throw new Error(`다른 앱(${obj.title || obj.app})의 백업이에요. 맞는 링크에서 불러와 주세요.`);
    if (!confirm('백업 내용을 합칠까요? 같은 칸은 더 나중에 고친 쪽이 남아요.')) return false;
    let items = obj.items || [];
    if (obj.version === 1) { items = []; for (const [cid, e] of Object.entries(obj.entries || {})) { if (e.visited) items.push({ cid, field: 'status', v: 'done', ts: e.visitedAt || e.updatedAt, by: 0 }); V1_FIELDS.forEach(f => e[f] && items.push({ cid, field: f, v: e[f], ts: e.updatedAt, by: 0 })); } if (obj.meta && obj.meta.opinion) items.push({ cid: '_meta', field: 'opinion', v: obj.meta.opinion, ts: obj.meta.updatedAt || Date.now(), by: 0 }); }
    for (const it of items) { if (newer(it, item(it.cid, it.field))) { const x = Object.assign({}, it, { dirty: true, by: it.by || myBy() }); ITEMS[key(it.cid, it.field)] = x; await saveItem(x); } }
    for (const p of obj.photos || []) { const cur = PHOTOS[p.id]; const pts = { ts: p.ts || p.created, by: p.by || 0 }; if (!cur || newer(pts, cur)) { const x = Object.assign({}, p, { ts: pts.ts, by: pts.by || myBy(), blob: p.b64 ? new Blob([b64d(p.b64)], { type: p.type || 'image/jpeg' }) : null, path: null, oldPaths: [], dirty: true, deleted: !!p.deleted }); delete x.b64; PHOTOS[x.id] = x; await savePhoto(x); } }
    for (const r of obj.recs || []) { if (!RECS[r.id] || newer(r, RECS[r.id])) { const x = Object.assign({}, r, { enc: r.b64 ? new Blob([b64d(r.b64)]) : null, path: r.b64 ? null : r.path, dirty: true }); delete x.b64; RECS[x.id] = x; await saveRec(x); } }
    kick(100); return true;
  }
  function renderMore() {
    const nr = Object.values(RECS).filter(r => !r.deleted).length;
    shell('보내기 · 설정', null, `${upgradeBanner()}
      <div class="sec"><h2>내 번호와 함께 쓰기</h2>
        <p>${ME.no ? `이 기기는 <b>사용자 ${ME.no}</b>예요. 번호는 바뀌지 않아요.` : '아직 번호가 없어요. 인터넷에 연결되면 자동으로 정해져요(그 전에 적은 것은 임시 번호로 표시돼요).'}</p>
        <p class="small">같은 링크를 연 사람끼리 실시간으로 함께 써요. 같은 칸을 둘이 고치면 더 나중에 고친 내용이 남고, 다른 칸은 둘 다 남아요. 인터넷이 끊겨도 이 기기에 저장되고, 다시 연결되면 자동으로 보내요.</p>
        <button class="btn sub big" id="syncnow">지금 맞추기</button><p class="small" id="syncinfo"></p></div>
      <div class="sec"><h2>업체별 정리본</h2><p class="small">녹음은 빠지고 글만 들어가요.</p>
        <div class="btns"><button class="btn sub" id="x-txt-s">텍스트 보내기</button><button class="btn sub" id="x-txt">텍스트 받기</button>
        <button class="btn sub" id="x-csv-s">엑셀(CSV) 보내기</button><button class="btn sub" id="x-csv">엑셀(CSV) 받기</button></div></div>
      <div class="sec"><h2>전체 백업 (녹음 ${nr}개 포함)</h2>
        <p class="small">서버와 별개로 손에 들고 있는 사본이에요. 카톡 등으로 보내 두거나, 다른 기기에서 ‘백업 불러오기’로 합칠 수 있어요.</p>
        <div class="btns"><button class="btn" id="b-share">백업 보내기</button><button class="btn sub" id="b-save">백업 파일 받기</button></div>
        <div class="btns one"><label class="btn sub">📂 백업 불러오기<input type="file" id="b-imp" accept=".json,application/json" hidden></label></div></div>
      <div class="sec"><h2>이 기기 정리</h2><p class="small">행사가 끝난 뒤에만 쓰세요. 서버의 함께 쓴 기록은 지워지지 않아요.</p><button class="btn warn big" id="wipe">이 기기의 기록·잠금 해제 지우기</button></div>`, navBar('#more'));
    bindUpgrade();
    $('#syncinfo').textContent = NET.lastSync ? '마지막으로 맞춘 시각 ' + hhmmss(new Date(NET.lastSync)) + (NET.err ? ' · 문제: ' + NET.err : '') : (NET.err ? '문제: ' + NET.err : '');
    $('#syncnow').onclick = async () => { await syncNow(); if (sb && NET.connected) await pullAll(); $('#syncinfo').textContent = '마지막으로 맞춘 시각 ' + hhmmss(new Date()) + (NET.err ? ' · 문제: ' + NET.err : ''); };
    const txt = () => new Blob([reportText()], { type: 'text/plain;charset=utf-8' });
    const csv = () => new Blob([csvText()], { type: 'text/csv;charset=utf-8' });
    $('#x-txt').onclick = () => deliver(txt(), baseName() + '_정리본.txt', 'save');
    $('#x-txt-s').onclick = () => deliver(txt(), baseName() + '_정리본.txt', 'share');
    $('#x-csv').onclick = () => deliver(csv(), baseName() + '_정리본.csv', 'save');
    $('#x-csv-s').onclick = () => deliver(csv(), baseName() + '_정리본.csv', 'share');
    const bk = how => async ev => { const b = ev.currentTarget; b.classList.add('busy'); try { await deliver(await backupBlob(), baseName() + '_백업.json', how); } catch (e) { toast('백업을 만들지 못했어요.'); } b.classList.remove('busy'); };
    $('#b-share').onclick = bk('share'); $('#b-save').onclick = bk('save');
    $('#b-imp').onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { if (await importBackup(f)) { toast('백업을 합쳤어요'); setTimeout(() => { location.hash = '#list'; }, 600); } } catch (e) { toast(e.message || '불러오지 못했어요.'); } };
    $('#wipe').onclick = async () => { if (!confirm('이 기기의 기록을 지울까요? 아직 보내지 못한 것은 사라져요.')) return; for (const s of ['items', 'photos', 'recs', 'kv', 'entries']) await idbClear(s); Object.keys(localStorage).filter(k => k.startsWith(LS) || k.startsWith('expo2026-auth')).forEach(k => localStorage.removeItem(k)); location.hash = ''; location.reload(); };
  }

  /* ---------- 라우팅·시작 ---------- */
  function route() {
    const h = location.hash || '#list'; ROUTE = h; window.scrollTo(0, 0);
    if (RS && !(h === '#c/' + RS.cid)) toast('녹음은 계속되고 있어요. 업체 화면에서 멈출 수 있어요.');
    if (h.startsWith('#c/')) renderDetail(decodeURIComponent(h.slice(3)));
    else if (h === '#report') renderReport();
    else if (h === '#more') renderMore();
    else { ROUTE = '#list'; renderList(); }
  }
  let started = false;
  async function start() {
    if (started) return; started = true;
    await loadLocal(); window.addEventListener('hashchange', route); route(); kick(50);
  }
  async function boot() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => { reg.update().catch(() => {}); setInterval(() => reg.update().catch(() => {}), 15 * 60 * 1000); }).catch(() => {});
      let reloaded = false; const hadCtl = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!hadCtl || reloaded || RS) return; reloaded = true; location.reload(); });
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    try { DATA = await idbGet('kv', 'data'); } catch (_) { DATA = null; }
    if (DATA && DATA.app === CFG.id) start(); else renderLock();
  }
  window.__expo = { syncNow, pullAll, state: () => ({ me: ME, net: Object.assign({}, NET, { connected: isConn() }), dirty: dirtyCount(), items: Object.values(ITEMS).map(x => ({ cid: x.cid, field: x.field, v: x.v, ts: x.ts, by: x.by, dirty: x.dirty })), photos: Object.values(PHOTOS).map(p => ({ id: p.id, cid: p.cid, kind: p.kind, w: p.w, h: p.h, ts: p.ts, by: p.by, path: p.path, deleted: p.deleted, dirty: p.dirty, hasBlob: !!p.blob, size: p.blob ? p.blob.size : 0 })), recs: Object.values(RECS).map(r => ({ id: r.id, cid: r.cid, status: r.status, path: r.path, deleted: r.deleted, dirty: r.dirty, size: r.size, mime: r.mime, duration: r.duration, hasSummary: !!r.summary, hasTranscript: !!r.transcript })) }) };
  boot();
})();
