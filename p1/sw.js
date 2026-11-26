// 오프라인용 서비스워커 (p1). 범위: /p1/  — 배포마다 tools/stamp.py가 VERSION과 ?v=를 바꿔 옛 캐시를 자동 교체
const VERSION = 'expo-p1-20261126e';
const Q = '?v=' + VERSION.split('-').pop();
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './data.enc.json',
  '../shared/app.js' + Q, '../shared/app.css' + Q, '../shared/supabase.js' + Q, '../shared/sync-config.js' + Q,
  '../shared/docx.iife.js', '../shared/fonts/Pretendard-Regular.woff2', '../shared/fonts/Pretendard-Bold.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('expo-p1-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/data.enc.json') || url.pathname.endsWith('/index.html');
  e.respondWith(caches.open(VERSION).then(async cache => {
    if (fresh) {
      try { const res = await timeout(fetch(req, { cache: 'no-cache' }), 4000); if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone()); return res; }
      catch (_) { return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./')) || new Response('오프라인이에요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    try { const res = await fetch(req); if (res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }
    catch (_) { return new Response('', { status: 504 }); }
  }));
});
