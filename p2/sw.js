// 오프라인용 서비스워커 (p2). 범위: /p2/
const VERSION = 'expo-p2-v1';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg', './data.enc.json',
  '../shared/app.js?v=1', '../shared/app.css?v=1', '../shared/docx.iife.js',
  '../shared/fonts/Pretendard-Regular.woff2', '../shared/fonts/Pretendard-Bold.woff2'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('expo-p2-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(req, { ignoreVary: true }) || (req.mode === 'navigate' ? await cache.match('./') : null);
    const net = fetch(req).then(res => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || new Response('오프라인이에요. 인터넷이 될 때 한 번 열어 주세요.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
