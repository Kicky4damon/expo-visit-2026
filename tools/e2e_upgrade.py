#!/usr/bin/env python3
"""v1(c9395a3)으로 잠금 해제·기록 → 같은 주소에 v2 배포 → 기록 보존·서비스워커 자동 교체·함께 쓰기 켜기 확인. 로컬 전용."""
import os, sys, shutil, subprocess, time, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive, sb_admin as A
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = '/tmp/expo_upg'; SITE = W + '/site'; PORT = 8777
shutil.rmtree(W, ignore_errors=True); os.makedirs(W + '/v1'); os.makedirs(SITE)
subprocess.run(f'git -C {ROOT} archive c9395a3 | tar -x -C {W}/v1', shell=True, check=True)
# 검증 이름공간과 같은 저장소 이름을 쓰게(실서비스 p1 데이터와 분리)
f = f'{W}/v1/p1/index.html'; s = open(f).read().replace("db:'expo2026-p1'", "db:'expo2026-p1-test'"); open(f, 'w').write(s)
V2 = subprocess.run(f"grep -o \"APP_VERSION='[^']*'\" {ROOT}/p1/index.html", shell=True, capture_output=True, text=True).stdout.split("'")[1]
EXC = {'secrets', 'data_src', 'work', 'shots', 'sample', '.git', 'supabase', 'docs', 'PASSWORD.txt'}
def deploy(src):
    for n in os.listdir(SITE):
        q = os.path.join(SITE, n); shutil.rmtree(q) if os.path.isdir(q) else os.remove(q)
    for n in os.listdir(src):
        if n in EXC: continue
        q = os.path.join(src, n); shutil.copytree(q, os.path.join(SITE, n)) if os.path.isdir(q) else shutil.copy2(q, SITE)
deploy(W + '/v1')
srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=SITE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
R = []
def check(n, ok, d=''): R.append((n, bool(ok), d)); print('PASS' if ok else 'FAIL', n, ('— ' + str(d)) if d else '', flush=True)
try:
    time.sleep(1)
    with sync_playwright() as p:
        br = p.chromium.launch(args=['--disable-dev-shm-usage'])
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, locale='ko-KR', timezone_id='Asia/Seoul')
        pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept())
        base = f'http://127.0.0.1:{PORT}/p1/'
        pg.goto(base); pg.wait_for_selector('#pw'); pg.fill('#pw', derive.password()); pg.click('#lbtn'); pg.wait_for_selector('#cards')
        pg.wait_for_function('navigator.serviceWorker.controller', timeout=20000)
        pg.click('[data-open="p1-1"]'); pg.wait_for_selector('#vbtn'); pg.click('#vbtn')
        pg.fill('#f-answer', 'v1에서 적은 답변'); pg.fill('#f-memo', 'v1 메모')
        pg.set_input_files('input[data-kind=photo][multiple]', os.path.join(ROOT, 'work/testimg/site1.jpg'))
        pg.wait_for_function("document.querySelectorAll('#ph-photo img').length==1"); pg.click('#savebtn'); time.sleep(0.5)
        check('v1에서 잠금 해제·기록(답변·메모·방문·사진)', 'v1에서 적은 답변' in pg.input_value('#f-answer'))
        # ---- 같은 주소에 v2 배포
        deploy(ROOT)
        url2 = base + '?ns=test'
        ver = None
        for i in range(6):
            pg.goto(url2, wait_until='domcontentloaded'); time.sleep(2)
            ver = pg.evaluate('window.APP_VERSION || null')
            if ver == V2: break
        check('새 버전 자동 적용(서비스워커 교체)', ver == V2, f'{i+1}번째 열기에서 버전 {ver}')
        keys = pg.evaluate('caches.keys()')
        check('옛 캐시 삭제·새 캐시만 남음', keys == [f'expo-p1-{V2}'], keys)
        pg.wait_for_selector('#cards', timeout=20000)
        lst = pg.text_content('#cards')
        check('v1 방문 체크 → v2 상태 “완료”로 이관', pg.text_content('[data-cyc="p1-1"]').strip() == '완료')
        banner = pg.is_visible('#upf')
        check('함께 쓰기 켜기 안내(비밀번호 한 번 더) 표시', banner)
        pg.goto(url2 + '#c/p1-1'); pg.wait_for_selector('#f-answer')
        kept = pg.input_value('#f-answer') == 'v1에서 적은 답변' and pg.input_value('#f-memo') == 'v1 메모'
        pg.wait_for_function("document.querySelectorAll('#ph-photo img').length==1", timeout=10000)
        check('v1 기록(답변·메모·사진) 그대로 보존', kept)
        pg.goto(url2 + '#list'); pg.wait_for_selector('#upf'); pg.fill('#upw', derive.password()); pg.click('#upb')
        pg.wait_for_function("window.__expo.state().me.no && window.__expo.state().dirty===0", timeout=40000)
        rows = A.rows('expo_items', 't1'); vals = {(r['cid'], r['field']): A.dec_text(r['value_enc']) for r in rows}
        ph = [r for r in A.rows('expo_photos', 't1') if not r['deleted']]
        check('함께 쓰기 켠 뒤 v1 기록이 서버로 올라감', vals.get(('p1-1', 'answer')) == 'v1에서 적은 답변' and vals.get(('p1-1', 'status')) == 'done' and len(ph) == 1, f"사용자 {pg.evaluate('window.__expo.state().me.no')}")
        pg.screenshot(path=os.path.join(ROOT, 'shots', 'upgrade_after_v2.png'))
        br.close()
finally:
    srv.terminate(); shutil.rmtree(W, ignore_errors=True); A.cleanup(('t1',))
print(f"결과: {sum(r[1] for r in R)}/{len(R)}")
json.dump(R, open(os.path.join(ROOT, 'shots', 'result_upgrade.json'), 'w'), ensure_ascii=False, indent=1)
