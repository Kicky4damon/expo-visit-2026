/* KINTEX 스마트건설 EXPO 방문 기록 — 엘림주식회사. 빌드 도구 없음, 단일 스크립트. */
(function () {
  'use strict';
  const CFG = window.APP; // {id, title, db}
  const LS = 'expo2026-' + CFG.id + '-';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hhmm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
  const hhmmss = d => hhmm(d) + ':' + pad(d.getSeconds());
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const fmtTime = t => { if (!t) return ''; const d = new Date(t); return ymd(d) + ' ' + hhmm(d); };
  const COMPANY = '엘림주식회사';

  /* ---------- IndexedDB ---------- */
  let dbp;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => {
      const r = indexedDB.open(CFG.db, 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('kv'); d.createObjectStore('entries'); const p = d.createObjectStore('photos', { keyPath: 'id' }); p.createIndex('cid', 'cid'); };
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

  /* ---------- state ---------- */
  let DATA = null;            // decrypted company data
  const ENT = {};             // cid -> entry
  let META = { opinion: '', writer: '', visitDate: '2026-11-27', maskPhones: false, updatedAt: 0 };
  let PHOTOS = [];            // {id,cid,kind,blob,w,h,created}
  const urls = new Map();
  let lastSaved = 0, dirty = false, saveTimer = null;
  const pendingEnt = new Set(); let pendingMeta = false;

  const blankEntry = () => ({ visited: false, visitedAt: 0, answer: '', memo: '', met: '', followup: '', updatedAt: 0 });
  const entry = cid => ENT[cid] || (ENT[cid] = blankEntry());
  const photosOf = (cid, kind) => PHOTOS.filter(p => p.cid === cid && (!kind || p.kind === kind)).sort((a, b) => a.created - b.created);
  const urlOf = p => { if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob)); return urls.get(p.id); };

  /* ---------- saving: localStorage (즉시, 동기) + IndexedDB (곧바로) ---------- */
  function touchEntry(cid) {
    const e = entry(cid); e.updatedAt = Date.now();
    try { localStorage.setItem(LS + 'e-' + cid, JSON.stringify(e)); } catch (_) {}
    pendingEnt.add(cid); markDirty();
  }
  function touchMeta() {
    META.updatedAt = Date.now();
    try { localStorage.setItem(LS + 'meta', JSON.stringify(META)); } catch (_) {}
    pendingMeta = true; markDirty();
  }
  function markDirty() { dirty = true; showSaved(); clearTimeout(saveTimer); saveTimer = setTimeout(flush, 250); }
  async function flush() {
    clearTimeout(saveTimer);
    const ids = [...pendingEnt]; pendingEnt.clear();
    const m = pendingMeta; pendingMeta = false;
    try {
      for (const cid of ids) await idbPut('entries', ENT[cid], cid);
      if (m) await idbPut('kv', META, 'meta');
      lastSaved = Date.now(); dirty = pendingEnt.size > 0 || pendingMeta;
    } catch (err) { toast('저장 중 문제가 생겼어요. 다시 눌러 주세요.'); dirty = true; }
    showSaved();
  }
  function showSaved() {
    const el = $('#saved'); if (!el) return;
    if (dirty) { el.textContent = '저장 중…'; el.classList.add('dirty'); }
    else { el.textContent = lastSaved ? '저장됨 ' + hhmmss(new Date(lastSaved)) : '자동 저장'; el.classList.remove('dirty'); }
  }
  window.addEventListener('pagehide', () => { flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  async function loadAll() {
    const keys = await idbAllKeys('entries'); const vals = await idbAll('entries');
    keys.forEach((k, i) => { ENT[k] = Object.assign(blankEntry(), vals[i]); });
    const m = await idbGet('kv', 'meta'); if (m) META = Object.assign(META, m);
    // localStorage 사본이 더 새로우면(닫기 직전 입력) 그것을 씀
    for (const c of DATA.companies) {
      try { const ls = JSON.parse(localStorage.getItem(LS + 'e-' + c.id) || 'null'); if (ls && (!ENT[c.id] || (ls.updatedAt || 0) > (ENT[c.id].updatedAt || 0))) { ENT[c.id] = Object.assign(blankEntry(), ls); pendingEnt.add(c.id); } } catch (_) {}
    }
    try { const lm = JSON.parse(localStorage.getItem(LS + 'meta') || 'null'); if (lm && (lm.updatedAt || 0) > (META.updatedAt || 0)) { META = Object.assign(META, lm); pendingMeta = true; } } catch (_) {}
    PHOTOS = await idbAll('photos');
    const t = Math.max(0, META.updatedAt || 0, ...Object.values(ENT).map(e => e.updatedAt || 0));
    lastSaved = t; if (pendingEnt.size || pendingMeta) await flush();
  }

  /* ---------- 암호 풀기 ---------- */
  const b64d = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(pw) {
    const enc = await (await fetch('data.enc.json', { cache: 'no-cache' })).json();
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64d(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(enc.iv) }, key, b64d(enc.ct));
    return JSON.parse(new TextDecoder().decode(plain));
  }
  function renderLock() {
    document.body.innerHTML = `<div class="top"><h1>${esc(CFG.title)}</h1></div>
    <div class="lock"><div class="sec"><h2>처음 한 번만 비밀번호를 넣어 주세요</h2>
    <p class="small">업체 담당자 연락처가 들어 있어서 잠가 두었어요. 한 번 열면 이 폰에서는 다시 묻지 않아요.</p>
    <form id="lf"><input id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호">
    <div class="err" id="lerr"></div><button class="btn big" id="lbtn">열기</button></form></div></div>`;
    $('#lf').onsubmit = async ev => {
      ev.preventDefault(); const b = $('#lbtn'); b.classList.add('busy'); b.textContent = '여는 중…'; $('#lerr').textContent = '';
      try { DATA = await decrypt($('#pw').value.trim()); await idbPut('kv', DATA, 'data'); await start(); }
      catch (e) { $('#lerr').textContent = (e && e.name === 'OperationError') ? '비밀번호가 맞지 않아요.' : '열지 못했어요. 인터넷 연결을 확인해 주세요.'; b.classList.remove('busy'); b.textContent = '열기'; }
    };
  }

  /* ---------- 화면 ---------- */
  function shell(title, back, body, nav) {
    document.body.className = CFG.id;
    document.body.innerHTML = `<div class="top">${back ? '<button class="back" id="back" aria-label="뒤로">‹</button>' : ''}<h1>${esc(title)}</h1><span class="saved" id="saved"></span></div><main>${body}</main>${nav || ''}<div class="toast" id="toast"></div><div id="print-root"></div>`;
    if (back) $('#back').onclick = () => { flush(); location.hash = back; };
    showSaved();
    document.querySelectorAll('.nav button').forEach(b => b.onclick = () => { flush(); location.hash = b.dataset.go; });
  }
  const navBar = on => `<nav class="nav">${[['#list', '업체 목록'], ['#report', '보고서'], ['#more', '보내기·백업']].map(([h, t]) => `<button data-go="${h}" class="${on === h ? 'on' : ''}">${t}</button>`).join('')}</nav>`;
  let toastT; function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }

  function renderList() {
    const cs = DATA.companies; const done = cs.filter(c => entry(c.id).visited).length;
    const items = cs.map(c => {
      const e = entry(c.id); const np = photosOf(c.id, 'photo').length, nc = photosOf(c.id, 'card').length;
      const filled = ['answer', 'memo', 'met', 'followup'].filter(k => (e[k] || '').trim()).length;
      return `<div class="card ${e.visited ? 'done' : ''}" data-id="${c.id}"><div class="crow"><div class="mark">${esc(c.mark)}</div>
      <div class="cmain" data-open="${c.id}"><div class="cname">${esc(c.name)}</div>${c.topic ? `<div class="ctopic">${esc(c.topic)}</div>` : ''}
      <span class="badge ${c.booth ? '' : 'none'}">${esc(c.booth || '부스 위치 미표기')}</span>
      <div class="cask">물어볼 것: ${esc(c.ask)}</div>
      <div class="cstat">${e.visited ? '방문함 ' + (e.visitedAt ? hhmm(new Date(e.visitedAt)) : '') + ' · ' : ''}적은 칸 ${filled}/4 · 사진 ${np} · 명함 ${nc}</div></div>
      <button class="chk ${e.visited ? 'on' : ''}" data-chk="${c.id}" aria-label="방문 체크">${e.visited ? '✓ 방문' : '방문<br>체크'}</button></div></div>`;
    }).join('');
    shell(CFG.title, null, `<div class="hint">${esc(DATA.headline)}</div>
      <div class="prog"><span>방문 ${done} / ${cs.length}</span><span class="small">${esc(DATA.docNo)}</span></div><div class="bar"><i style="width:${cs.length ? done / cs.length * 100 : 0}%"></i></div>
      <div id="cards">${items}</div>
      <details class="sec"><summary><b>자료 참고 사항</b></summary><ul class="small">${DATA.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></details>`, navBar('#list'));
    document.querySelectorAll('[data-open]').forEach(el => el.onclick = () => { location.hash = '#c/' + el.dataset.open; });
    document.querySelectorAll('[data-chk]').forEach(el => el.onclick = () => { toggleVisit(el.dataset.chk); renderList(); });
  }
  function toggleVisit(cid) { const e = entry(cid); e.visited = !e.visited; e.visitedAt = e.visited ? Date.now() : 0; touchEntry(cid); }

  function renderDetail(cid) {
    const c = DATA.companies.find(x => x.id === cid); if (!c) { location.hash = '#list'; return; }
    const e = entry(cid);
    const contacts = c.contacts.length ? c.contacts.map(p => `<div class="contact"><div><b>${esc(p.name)}</b> <span class="small">${esc(p.role)}</span></div>${p.phone ? `<a class="tel" href="tel:${esc(p.phone.replace(/[^0-9+]/g, ''))}">📞 ${esc(p.phone)}</a>` : '<span class="small">번호 없음</span>'}</div>`).join('') : '<p class="small">명함 미수령 — 부스에서 담당자를 확인하세요.</p>';
    const ta = (k, label, ph) => `<label class="f" for="f-${k}">${label}</label><textarea id="f-${k}" data-k="${k}" placeholder="${esc(ph)}">${esc(e[k])}</textarea>`;
    const photoBlock = (kind, label) => `<div class="sec"><h2>${label} <span class="small" id="cnt-${kind}"></span></h2>
      <div class="btns"><label class="btn sub">📷 찍기<input type="file" accept="image/*" capture="environment" data-kind="${kind}" hidden></label>
      <label class="btn sub">🖼 앨범에서<input type="file" accept="image/*" multiple data-kind="${kind}" hidden></label></div><div class="photos" id="ph-${kind}"></div></div>`;
    shell(c.mark + '. ' + c.name, '#list', `
      <button class="visit ${e.visited ? 'on' : ''}" id="vbtn">${e.visited ? '✓ 방문했어요' + (e.visitedAt ? ' (' + hhmm(new Date(e.visitedAt)) + ')' : '') : '방문했으면 누르세요'}</button>
      <div class="sec" style="margin-top:12px"><h2>${esc(c.topic || c.name)}</h2><span class="badge ${c.booth ? '' : 'none'}">${esc(c.booth || '부스 위치 미표기')}</span>
      <ul style="margin-top:8px">${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>${c.extra ? `<p class="small">※ ${esc(c.extra)}</p>` : ''}</div>
      <div class="sec"><h2>물어볼 것</h2><div class="ask">${esc(c.ask)}</div>${ta('answer', '받은 답변', '물어본 내용에 대한 답을 적어 주세요')}</div>
      <div class="sec"><h2>담당자</h2>${contacts}</div>
      <div class="sec">${ta('met', '만난 사람', '이름 · 직책 · 연락처')}${ta('memo', '자유 메모', '본 것, 들은 것, 느낀 점')}${ta('followup', '후속 조치', '누가 · 무엇을 · 언제까지')}</div>
      ${photoBlock('photo', '현장 사진')}${photoBlock('card', '명함 사진')}`,
      `<div class="savebar"><button class="btn sub" id="prev">‹ 이전</button><button class="btn" id="savebtn">저장</button><button class="btn sub" id="next">다음 ›</button></div>`);
    document.querySelectorAll('textarea[data-k]').forEach(t => t.addEventListener('input', () => { entry(cid)[t.dataset.k] = t.value; touchEntry(cid); }));
    $('#vbtn').onclick = () => { toggleVisit(cid); renderDetail(cid); };
    $('#savebtn').onclick = async () => { document.querySelectorAll('textarea[data-k]').forEach(t => { entry(cid)[t.dataset.k] = t.value; }); touchEntry(cid); await flush(); toast('저장했어요 ' + hhmmss(new Date())); };
    const i = DATA.companies.indexOf(c);
    $('#prev').onclick = () => { flush(); location.hash = i > 0 ? '#c/' + DATA.companies[i - 1].id : '#list'; };
    $('#next').onclick = () => { flush(); location.hash = i < DATA.companies.length - 1 ? '#c/' + DATA.companies[i + 1].id : '#report'; };
    document.querySelectorAll('input[type=file][data-kind]').forEach(inp => inp.onchange = async () => {
      const files = [...inp.files]; inp.value = ''; if (!files.length) return;
      toast('사진 넣는 중…');
      let ok = 0;
      for (const f of files) { try { await addPhoto(cid, inp.dataset.kind, f); ok++; } catch (err) { toast('사진 하나를 넣지 못했어요.'); } }
      drawPhotos(cid); lastSaved = Date.now(); dirty = false; showSaved(); if (ok) toast(`사진 ${ok}장 저장했어요`);
    });
    drawPhotos(cid);
  }
  function drawPhotos(cid) {
    for (const kind of ['photo', 'card']) {
      const box = $('#ph-' + kind); if (!box) continue; const list = photosOf(cid, kind);
      $('#cnt-' + kind).textContent = list.length ? list.length + '장' : '';
      box.innerHTML = list.map(p => `<div class="ph"><img src="${urlOf(p)}" alt=""><button data-del="${p.id}" aria-label="사진 지우기">×</button></div>`).join('');
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('이 사진을 지울까요?')) return; await idbDel('photos', b.dataset.del); PHOTOS = PHOTOS.filter(p => p.id !== b.dataset.del); drawPhotos(cid); });
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
    const r = await resizeImage(file);
    const p = { id: cid + '-' + kind + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cid, kind, blob: r.blob, w: r.w, h: r.h, created: Date.now() };
    await idbPut('photos', p); PHOTOS.push(p); return p;
  }

  /* ---------- 보고서 ---------- */
  const maskPhone = s => META.maskPhones ? String(s).replace(/01[016789][- .]?\d{3,4}[- .]?\d{4}/g, '010-****-****') : s;
  function reportModel() {
    return DATA.companies.map(c => ({ c, e: entry(c.id), photos: photosOf(c.id, 'photo'), cards: photosOf(c.id, 'card') }));
  }
  const contactLine = c => c.contacts.length ? c.contacts.map(p => `${p.name} ${p.role}${p.phone ? ' ' + maskPhone(p.phone) : ''}`).join(' · ') : '명함 미수령';
  function reportTitle() { return `KINTEX 스마트건설 EXPO 방문 보고서 — ${CFG.title}`; }
  function reportHTML() {
    const m = reportModel(); const done = m.filter(x => x.e.visited).length;
    const fig = (p, cap) => `<figure><img src="${urlOf(p)}" alt=""><figcaption>${cap}</figcaption></figure>`;
    const field = (lbl, v) => `<div><span class="lbl">${lbl}</span> <span class="pre">${esc(maskPhone(v || '').trim() || '—')}</span></div>`;
    return `<div class="rep" id="rep">
      <h1>${esc(reportTitle())}</h1>
      <div class="rmeta">${COMPANY} · 방문일 ${esc(META.visitDate || '')} · 작성자 ${esc(META.writer || '—')} · 방문 ${done}/${m.length}곳 · 작성 ${esc(fmtTime(Date.now()))}</div>
      <h2>1. 요약</h2>
      <table><thead><tr><th style="width:8%">순서</th><th style="width:24%">업체</th><th style="width:10%">방문</th><th>후속 조치</th></tr></thead><tbody>
      ${m.map(x => `<tr><td>${esc(x.c.mark)}</td><td>${esc(x.c.name)}</td><td>${x.e.visited ? '○' : '—'}</td><td class="pre">${esc(maskPhone(x.e.followup || '').trim() || '—')}</td></tr>`).join('')}</tbody></table>
      <h2>2. 종합 의견</h2><div class="opinion">${esc(META.opinion.trim() || '—')}</div>
      <h2>3. 업체별 정리</h2>
      ${m.map(x => `<div class="co"><h3>${esc(x.c.mark)}. ${esc(x.c.name)}${x.c.topic ? ' — ' + esc(x.c.topic) : ''} <span style="font-weight:400;color:#555">(${x.e.visited ? '방문' + (x.e.visitedAt ? ' ' + hhmm(new Date(x.e.visitedAt)) : '') : '미방문'}${x.c.booth ? ' · ' + esc(x.c.booth) : ''})</span></h3>
        <div class="lbl">핵심 기술</div><ul>${x.c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
        ${field('물어볼 것:', x.c.ask)}${field('받은 답변:', x.e.answer)}${field('만난 사람:', x.e.met)}${field('메모:', x.e.memo)}${field('후속 조치:', x.e.followup)}
        <div><span class="lbl">담당자(사전 자료):</span> ${esc(contactLine(x.c))}</div>
        ${x.photos.length || x.cards.length ? `<div class="rph">${x.photos.map((p, i) => fig(p, '현장 사진 ' + (i + 1))).join('')}${x.cards.map((p, i) => fig(p, '명함 ' + (i + 1))).join('')}</div>` : ''}
      </div>`).join('')}
    </div>`;
  }
  function reportText() {
    const m = reportModel(); const L = [];
    L.push('# ' + reportTitle(), '', `${COMPANY} · 방문일 ${META.visitDate || ''} · 작성자 ${META.writer || '-'} · 방문 ${m.filter(x => x.e.visited).length}/${m.length}곳 · 작성 ${fmtTime(Date.now())}`, '');
    L.push('## 종합 의견', '', META.opinion.trim() || '-', '', '## 업체별 정리', '');
    for (const x of m) {
      L.push(`### ${x.c.mark}. ${x.c.name}${x.c.topic ? ' — ' + x.c.topic : ''}`, `- 방문: ${x.e.visited ? '방문함 ' + fmtTime(x.e.visitedAt) : '미방문'}`, `- 부스: ${x.c.booth || '미표기'}`, '- 핵심 기술:');
      x.c.bullets.forEach(b => L.push('  - ' + b));
      L.push(`- 물어볼 것: ${x.c.ask}`, `- 받은 답변: ${maskPhone(x.e.answer.trim()) || '-'}`, `- 만난 사람: ${maskPhone(x.e.met.trim()) || '-'}`, `- 메모: ${maskPhone(x.e.memo.trim()) || '-'}`, `- 후속 조치: ${maskPhone(x.e.followup.trim()) || '-'}`, `- 담당자(사전 자료): ${contactLine(x.c)}`, `- 사진 ${x.photos.length}장 · 명함 ${x.cards.length}장`, '');
    }
    return L.join('\n');
  }
  function csvText() {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['순서', '업체', '주제', '부스', '방문', '방문 시각', '물어볼 것', '받은 답변', '만난 사람', '메모', '후속 조치', '사진 수', '명함 수', '담당자(사전 자료)']];
    for (const x of reportModel()) rows.push([x.c.mark, x.c.name, x.c.topic, x.c.booth, x.e.visited ? '방문' : '미방문', fmtTime(x.e.visitedAt), x.c.ask, maskPhone(x.e.answer), maskPhone(x.e.met), maskPhone(x.e.memo), maskPhone(x.e.followup), x.photos.length, x.cards.length, contactLine(x.c)]);
    return '\uFEFF' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  let docxP;
  function loadDocx() { return docxP || (docxP = new Promise((res, rej) => { if (window.docx) return res(window.docx); const s = document.createElement('script'); s.src = '../shared/docx.iife.js'; s.onload = () => res(window.docx); s.onerror = () => { docxP = null; rej(new Error('docx')); }; document.head.appendChild(s); })); }
  async function reportDocx() {
    const D = await loadDocx();
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, AlignmentType, BorderStyle } = D;
    const P = (text, o = {}) => new Paragraph({ children: [new TextRun({ text, bold: o.bold, color: o.color, size: o.size })], spacing: { after: o.after == null ? 60 : o.after } });
    const LP = (label, val) => { const lines = String(val || '-').split('\n'); return new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: label + ' ', bold: true, color: '1F3A5F' }), ...lines.flatMap((t, i) => i ? [new TextRun({ text: t, break: 1 })] : [new TextRun(t)])] }); };
    const cell = (t, o = {}) => new TableCell({ width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined, shading: o.head ? { fill: 'EEF2F7' } : undefined, children: String(t).split('\n').map(s => new Paragraph({ children: [new TextRun({ text: s, bold: o.head })] })) });
    const m = reportModel(); const kids = [];
    kids.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: reportTitle(), bold: true, size: 32 })] }));
    kids.push(P(`${COMPANY} · 방문일 ${META.visitDate || ''} · 작성자 ${META.writer || '—'} · 방문 ${m.filter(x => x.e.visited).length}/${m.length}곳 · 작성 ${fmtTime(Date.now())}`, { color: '555555', after: 200 }));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. 요약')] }));
    kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: [cell('순서', { head: 1, w: 8 }), cell('업체', { head: 1, w: 26 }), cell('방문', { head: 1, w: 10 }), cell('후속 조치', { head: 1, w: 56 })] }),
      ...m.map(x => new TableRow({ children: [cell(x.c.mark), cell(x.c.name), cell(x.e.visited ? '○' : '—'), cell(maskPhone(x.e.followup || '').trim() || '—')] }))] }));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun('2. 종합 의견')] }));
    String(META.opinion.trim() || '—').split('\n').forEach(t => kids.push(P(t)));
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240 }, children: [new TextRun('3. 업체별 정리')] }));
    for (const x of m) {
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200 }, children: [new TextRun(`${x.c.mark}. ${x.c.name}${x.c.topic ? ' — ' + x.c.topic : ''}`), new TextRun({ text: `  (${x.e.visited ? '방문' + (x.e.visitedAt ? ' ' + hhmm(new Date(x.e.visitedAt)) : '') : '미방문'}${x.c.booth ? ' · ' + x.c.booth : ''})`, color: '666666', size: 20 })] }));
      kids.push(P('핵심 기술', { bold: true, color: '1F3A5F', after: 20 }));
      x.c.bullets.forEach(b => kids.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun(b)] })));
      kids.push(LP('물어볼 것:', x.c.ask), LP('받은 답변:', maskPhone(x.e.answer.trim()) || '—'), LP('만난 사람:', maskPhone(x.e.met.trim()) || '—'), LP('메모:', maskPhone(x.e.memo.trim()) || '—'), LP('후속 조치:', maskPhone(x.e.followup.trim()) || '—'), LP('담당자(사전 자료):', contactLine(x.c)));
      const imgs = [...x.photos.map((p, i) => [p, '현장 사진 ' + (i + 1)]), ...x.cards.map((p, i) => [p, '명함 ' + (i + 1)])];
      for (const [p, cap] of imgs) {
        const buf = await p.blob.arrayBuffer(); const W = 300; const s = Math.min(W / p.w, 220 / p.h);
        kids.push(new Paragraph({ alignment: AlignmentType.LEFT, children: [new ImageRun({ type: 'jpg', data: new Uint8Array(buf), transformation: { width: Math.round(p.w * s), height: Math.round(p.h * s) } })] }));
        kids.push(P(cap, { color: '666666', size: 18 }));
      }
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
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      } else toast('이 폰에서는 바로 보내기가 안 돼서 파일로 저장할게요.');
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); toast('파일을 저장했어요: ' + name);
  }

  function renderReport() {
    shell('보고서 · ' + CFG.title, null, `
      <div class="sec"><h2>보고서 정보</h2>
        <label class="f" for="m-writer">작성자</label><input type="text" id="m-writer" data-m="writer" value="${esc(META.writer)}" placeholder="이름">
        <label class="f" for="m-date">방문일</label><input type="date" id="m-date" data-m="visitDate" value="${esc(META.visitDate)}">
        <label class="f" for="m-op">종합 의견</label><textarea id="m-op" data-m="opinion" style="min-height:140px" placeholder="전체적으로 본 것, 우선 협력 대상, 다음에 할 일">${esc(META.opinion)}</textarea>
        <label class="chkline"><input type="checkbox" id="m-mask" ${META.maskPhones ? 'checked' : ''}> 보고서에서 전화번호 가리기</label>
      </div>
      <div class="sec"><h2>보고서 만들기</h2>
        <div class="btns one"><button class="btn big" id="r-print">🖨 인쇄 · PDF로 저장 (A4)</button></div>
        <div class="btns"><button class="btn sub" id="r-docx-s">워드 보내기</button><button class="btn sub" id="r-docx">워드(DOCX) 받기</button>
        <button class="btn sub" id="r-txt-s">텍스트 보내기</button><button class="btn sub" id="r-txt">텍스트 받기</button></div>
        <p class="small">PDF: 인쇄 화면에서 ‘PDF로 저장’을 고르세요. 아래는 미리보기예요.</p></div>
      <div class="rep-wrap" id="preview"></div>`, navBar('#report'));
    const redraw = () => { $('#preview').innerHTML = reportHTML(); };
    document.querySelectorAll('[data-m]').forEach(el => el.addEventListener('input', () => { META[el.dataset.m] = el.value; touchMeta(); clearTimeout(el._t); el._t = setTimeout(redraw, 400); }));
    $('#m-mask').onchange = ev => { META.maskPhones = ev.target.checked; touchMeta(); redraw(); };
    $('#r-print').onclick = async () => { await flush(); const pr = $('#print-root'); pr.innerHTML = reportHTML(); document.body.classList.add('printing'); await waitImages(pr); window.print(); };
    window.onafterprint = () => { document.body.classList.remove('printing'); $('#print-root').innerHTML = ''; };
    const doDocx = how => async ev => { const b = ev.currentTarget; b.classList.add('busy'); try { await flush(); await deliver(await reportDocx(), baseName() + '_보고서.docx', how); } catch (e) { console.error(e); toast('워드 파일을 만들지 못했어요.'); } b.classList.remove('busy'); };
    $('#r-docx').onclick = doDocx('save'); $('#r-docx-s').onclick = doDocx('share');
    $('#r-txt').onclick = () => deliver(new Blob([reportText()], { type: 'text/markdown;charset=utf-8' }), baseName() + '_보고서.md', 'save');
    $('#r-txt-s').onclick = () => deliver(new Blob([reportText()], { type: 'text/plain;charset=utf-8' }), baseName() + '_보고서.txt', 'share');
    redraw();
  }
  function waitImages(root) { return Promise.all([...root.querySelectorAll('img')].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); }

  /* ---------- 백업 ---------- */
  const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
  async function backupBlob() {
    await flush();
    const photos = []; for (const p of PHOTOS) photos.push({ id: p.id, cid: p.cid, kind: p.kind, w: p.w, h: p.h, created: p.created, type: p.blob.type || 'image/jpeg', b64: await blobToB64(p.blob) });
    const obj = { kind: 'expo-visit-backup', version: 1, app: CFG.id, title: CFG.title, exportedAt: new Date().toISOString(), meta: META, entries: ENT, photos };
    return new Blob([JSON.stringify(obj)], { type: 'application/json' });
  }
  async function importBackup(file) {
    let obj; try { obj = JSON.parse(await file.text()); } catch (_) { throw new Error('파일을 읽지 못했어요.'); }
    if (!obj || obj.kind !== 'expo-visit-backup') throw new Error('방문 기록 백업 파일이 아니에요.');
    if (obj.app !== CFG.id) throw new Error(`다른 앱(${obj.title || obj.app})의 백업이에요. 맞는 링크에서 불러와 주세요.`);
    if (!confirm(`백업(${obj.exportedAt ? fmtTime(obj.exportedAt) : ''})을 불러오면 이 기기의 기록이 백업 내용으로 바뀌어요. 계속할까요?`)) return false;
    await idbClear('entries'); await idbClear('photos');
    for (const k of Object.keys(ENT)) delete ENT[k];
    for (const [cid, e] of Object.entries(obj.entries || {})) { ENT[cid] = Object.assign(blankEntry(), e); await idbPut('entries', ENT[cid], cid); try { localStorage.setItem(LS + 'e-' + cid, JSON.stringify(ENT[cid])); } catch (_) {} }
    META = Object.assign({ opinion: '', writer: '', visitDate: '2026-11-27', maskPhones: false }, obj.meta || {}); await idbPut('kv', META, 'meta'); try { localStorage.setItem(LS + 'meta', JSON.stringify(META)); } catch (_) {}
    urls.forEach(u => URL.revokeObjectURL(u)); urls.clear(); PHOTOS = [];
    for (const p of obj.photos || []) { const blob = new Blob([b64d(p.b64)], { type: p.type || 'image/jpeg' }); const rec = { id: p.id, cid: p.cid, kind: p.kind, w: p.w, h: p.h, created: p.created, blob }; await idbPut('photos', rec); PHOTOS.push(rec); }
    lastSaved = Date.now(); dirty = false; return true;
  }
  function renderMore() {
    const np = PHOTOS.length;
    shell('보내기 · 백업', null, `
      <div class="sec"><h2>업체별 정리본</h2><p class="small">사진은 빠지고 글만 들어가요.</p>
        <div class="btns"><button class="btn sub" id="x-txt-s">텍스트 보내기</button><button class="btn sub" id="x-txt">텍스트 받기</button>
        <button class="btn sub" id="x-csv-s">엑셀(CSV) 보내기</button><button class="btn sub" id="x-csv">엑셀(CSV) 받기</button></div></div>
      <div class="sec"><h2>전체 백업 (사진 ${np}장 포함)</h2>
        <p class="small">다른 폰이나 PC에서 이어서 쓰거나 사장님께 넘길 때 써요. 카톡 등으로 보내고, 받은 쪽에서 같은 링크를 연 뒤 ‘백업 불러오기’를 누르면 돼요. 실시간으로 함께 고쳐지지는 않아요.</p>
        <div class="btns"><button class="btn" id="b-share">백업 보내기</button><button class="btn sub" id="b-save">백업 파일 받기</button></div>
        <div class="btns one"><label class="btn sub">📂 백업 불러오기<input type="file" id="b-imp" accept=".json,application/json" hidden></label></div></div>
      <div class="sec"><h2>이 기기 정리</h2><p class="small">행사가 끝나고 백업을 받은 뒤에만 쓰세요.</p><button class="btn warn big" id="wipe">이 기기의 기록·잠금 해제 모두 지우기</button></div>
      <p class="small" style="text-align:center">${COMPANY} · ${esc(DATA.docNo)} · 모든 기록은 이 기기 안에만 저장돼요</p>`, navBar('#more'));
    const txt = () => new Blob([reportText()], { type: 'text/plain;charset=utf-8' });
    const csv = () => new Blob([csvText()], { type: 'text/csv;charset=utf-8' });
    $('#x-txt').onclick = async () => { await flush(); deliver(txt(), baseName() + '_정리본.txt', 'save'); };
    $('#x-txt-s').onclick = async () => { await flush(); deliver(txt(), baseName() + '_정리본.txt', 'share'); };
    $('#x-csv').onclick = async () => { await flush(); deliver(csv(), baseName() + '_정리본.csv', 'save'); };
    $('#x-csv-s').onclick = async () => { await flush(); deliver(csv(), baseName() + '_정리본.csv', 'share'); };
    const bk = how => async ev => { const b = ev.currentTarget; b.classList.add('busy'); try { await deliver(await backupBlob(), baseName() + '_백업.json', how); } catch (e) { toast('백업을 만들지 못했어요.'); } b.classList.remove('busy'); };
    $('#b-share').onclick = bk('share'); $('#b-save').onclick = bk('save');
    $('#b-imp').onchange = async ev => { const f = ev.target.files[0]; ev.target.value = ''; if (!f) return; try { if (await importBackup(f)) { toast('백업을 불러왔어요'); setTimeout(() => { location.hash = '#list'; route(); }, 600); } } catch (e) { toast(e.message || '불러오지 못했어요.'); } };
    $('#wipe').onclick = async () => { if (!confirm('정말 모두 지울까요? 되돌릴 수 없어요.')) return; await idbClear('entries'); await idbClear('photos'); await idbClear('kv'); Object.keys(localStorage).filter(k => k.startsWith(LS)).forEach(k => localStorage.removeItem(k)); location.hash = ''; location.reload(); };
  }

  /* ---------- 라우팅 ---------- */
  function route() {
    const h = location.hash || '#list';
    window.scrollTo(0, 0);
    if (h.startsWith('#c/')) renderDetail(decodeURIComponent(h.slice(3)));
    else if (h === '#report') renderReport();
    else if (h === '#more') renderMore();
    else renderList();
  }
  async function start() { await loadAll(); window.addEventListener('hashchange', route); route(); }
  async function boot() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    try { DATA = await idbGet('kv', 'data'); } catch (_) { DATA = null; }
    if (DATA && DATA.app === CFG.id) start(); else renderLock();
  }
  window.__expo = { flush, state: () => ({ ENT, META, nPhotos: PHOTOS.length, photos: PHOTOS.map(p => ({ id: p.id, cid: p.cid, kind: p.kind, w: p.w, h: p.h, size: p.blob.size })) }) };
  boot();
})();
