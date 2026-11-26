#!/usr/bin/env python3
"""함께 쓰기 검증: 3개 기기(A·B·C) 동시, 사진 삭제·교체, 충돌, 오프라인, 번호, 상태, 녹음(가짜 마이크+가짜 작업자).
사용: e2e_sync.py BASE_URL TAG   (검증용 이름공간 ?ns=test → 서버 t1/t2, 실서비스 p1/p2 데이터·번호 영향 없음)"""
import sys, os, re, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import derive, sb_admin as A
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE, TAG = sys.argv[1].rstrip('/'), sys.argv[2]
APP = sys.argv[3] if len(sys.argv) > 3 else 'p1'
SAPP = 't' + APP[1:]
PW = derive.password()
SHOTS = os.path.join(ROOT, 'shots'); os.makedirs(SHOTS, exist_ok=True)
IMG = os.path.join(ROOT, 'work', 'testimg')
URL = f'{BASE}/{APP}/?ns=test'
C1, C2, C3 = (f'{APP}-1', f'{APP}-2', f'{APP}-3') if APP == 'p1' else (f'{APP}-A', f'{APP}-B', f'{APP}-C')
R = []
def check(name, ok, detail=''):
    R.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, ('— ' + str(detail)) if detail else '', flush=True)
def st(pg): return pg.evaluate('window.__expo.state()')
def item(pg, cid, f):
    for x in st(pg)['items']:
        if x['cid'] == cid and x['field'] == f: return x
def wait(pg, js, arg=None, timeout=15000):
    t = time.time(); pg.wait_for_function(js, arg=arg, timeout=timeout); return round(time.time() - t, 2)
def shot(pg, name): pg.screenshot(path=os.path.join(SHOTS, f'{TAG}_{name}.png'))
def hhmm(ts): return time.strftime('%H:%M', time.localtime(ts / 1000))

A.cleanup((SAPP,))
with sync_playwright() as p:
    br = p.chromium.launch(args=['--disable-dev-shm-usage', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    def device():
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ko-KR', timezone_id='Asia/Seoul', accept_downloads=True, permissions=['microphone'])
        pg = ctx.new_page(); pg._errs = []; pg.on('pageerror', lambda e: pg._errs.append(str(e)))
        pg.on('dialog', lambda d: d.accept())
        return ctx, pg
    devs = {n: device() for n in 'ABC'}
    for n, (ctx, pg) in devs.items():
        pg.goto(URL); pg.wait_for_selector('#pw', timeout=30000); pg.fill('#pw', PW); pg.click('#lbtn'); pg.wait_for_selector('#cards', timeout=40000)
    for n, (ctx, pg) in devs.items():
        wait(pg, 'window.__expo.state().me.no && window.__expo.state().net.connected', timeout=40000)
    A_, B_, C_ = (devs[n][1] for n in 'ABC')
    nos = {n: st(devs[n][1])['me']['no'] for n in 'ABC'}
    check('사용자 번호 자동 부여(서로 다름·연속)', len(set(nos.values())) == 3 and sorted(nos.values()) == list(range(min(nos.values()), min(nos.values()) + 3)), nos)
    check('머리글 “나: 사용자 N” 표시', all(f'나: 사용자 {nos[n]}' in devs[n][1].text_content('#me') for n in 'ABC'))
    for n in 'ABC': wait(devs[n][1], 'window.__expo.state().net.peers.length>=3', timeout=20000)
    check('접속자 표시(presence) 3명', all(len(st(devs[n][1])['net']['peers']) >= 3 for n in 'ABC'), A_.text_content('#peers'))
    shot(A_, 's1_list_presence')
    # 번호 유지: 새로고침 후 같은 번호
    B_.reload(); B_.wait_for_selector('#cards'); wait(B_, 'window.__expo.state().net.connected', timeout=30000)
    check('새로고침 후 번호 그대로', st(B_)['me']['no'] == nos['B'], st(B_)['me'])

    # ---- 글 편집 실시간
    for pg in (A_, B_, C_): pg.goto(URL + '#c/' + C1); pg.wait_for_selector('#f-answer')
    A_.fill('#f-answer', 'A가 적은 답변: 장비 임대 가능 (테스트)'); t0 = time.time()
    dt = wait(B_, "document.querySelector('#f-answer').value.includes('A가 적은 답변')", timeout=15000)
    check('A 편집 → B 실시간 반영', True, f'{round(time.time()-t0,1)}초')
    wait(C_, "document.querySelector('#f-answer').value.includes('A가 적은 답변')", timeout=15000)
    it = item(B_, C1, 'answer')
    mkB = B_.text_content('#mk-answer'); mkA = A_.text_content('#mk-answer')
    check('최종 수정 표시(A·B 화면 모두 “사용자 A번 · 시각”)', mkB == mkA == f"사용자 {nos['A']} · {hhmm(it['ts'])}", f'A:{mkA} / B:{mkB}')
    B_.fill('#f-memo', 'B가 적은 메모 (테스트)'); t0 = time.time()
    wait(A_, "document.querySelector('#f-memo').value.includes('B가 적은 메모')", timeout=15000)
    check('B 편집 → A 실시간 반영', A_.text_content('#mk-memo').startswith(f"사용자 {nos['B']} ·"), f"{round(time.time()-t0,1)}초, {A_.text_content('#mk-memo')}")
    shot(B_, 's2_detail_markers')
    # 같은 칸 충돌: A 먼저, B 나중 → B 값
    A_.fill('#f-followup', '후속-A (먼저)'); time.sleep(0.3); B_.fill('#f-followup', '후속-B (나중)')
    time.sleep(1)
    for pg in (A_, B_, C_):
        wait(pg, "window.__expo.state().dirty===0 && document.querySelector('#f-followup').value==='후속-B (나중)'", timeout=20000)
    check('같은 칸 동시 편집 → 나중 값(B) 남음, 3대 모두', all(pg.input_value('#f-followup') == '후속-B (나중)' for pg in (A_, B_, C_)))
    srv = [r for r in A.rows('expo_items', SAPP) if r['cid'] == C1 and r['field'] == 'followup'][0]
    check('서버 값도 나중 값', A.dec_text(srv['value_enc']) == '후속-B (나중)' and srv['by_no'] == nos['B'], f"by 사용자 {srv['by_no']}")
    # 다른 칸 동시: A met, C answer
    A_.fill('#f-met', '부장님 1명 (A)'); C_.fill('#f-answer', 'C가 고친 답변')
    for pg in (A_, B_, C_):
        wait(pg, "document.querySelector('#f-met').value==='부장님 1명 (A)' && document.querySelector('#f-answer').value==='C가 고친 답변'", timeout=20000)
    check('다른 칸 동시 편집 → 둘 다 남음, 3대 모두', True)
    # ---- 방문 상태
    C_.goto(URL + '#list'); C_.wait_for_selector('#cards'); C_.click(f'[data-cyc="{C2}"]')
    for pg in (A_, B_):
        pg.goto(URL + '#list'); pg.wait_for_selector('#cards')
        wait(pg, f"document.querySelector('[data-cyc=\"{C2}\"]').textContent.trim()==='방문중'", timeout=15000)
    C_.click(f'[data-cyc="{C1}"]'); C_.click(f'[data-cyc="{C1}"]')
    wait(A_, f"document.querySelector('[data-cyc=\"{C1}\"]').textContent.trim()==='완료'", timeout=15000)
    dash = A_.text_content('.dash')
    check('방문 상태(미방문/방문중/완료) 실시간·대시보드', '1완료' in dash.replace(' ', '') and '1방문중' in dash.replace(' ', ''), dash)
    shot(A_, 's3_list_status')

    # ---- 사진: 추가 → 삭제 → 교체
    for pg in (A_, B_, C_): pg.goto(URL + '#c/' + C1); pg.wait_for_selector('#ph-photo', state='attached')
    A_.set_input_files('input[data-kind=photo][multiple]', [os.path.join(IMG, 'site1.jpg'), os.path.join(IMG, 'site2.jpg')])
    t0 = time.time()
    wait(B_, "document.querySelectorAll('#ph-photo img').length===2", timeout=30000)
    check('A 사진 2장 추가 → B 표시', True, f'{round(time.time()-t0,1)}초')
    wait(A_, "window.__expo.state().dirty===0", timeout=20000)
    phs = [x for x in st(A_)['photos'] if not x['deleted']]; phs.sort(key=lambda x: x['ts'])
    p_del, p_rep = phs[0], phs[1]
    check('사진 Storage 업로드(암호화)', all(A.storage_exists(x['path']) for x in phs) and A.storage_get(p_rep['path'])[1][:3] != b'\xff\xd8\xff', '암호문(JPEG 헤더 아님)')
    A_.click(f'[data-del="{p_del["id"]}"]'); t0 = time.time()
    wait(B_, "document.querySelectorAll('#ph-photo img').length===1", timeout=20000)
    wait(A_, "window.__expo.state().dirty===0", timeout=20000); time.sleep(1)
    srvp = [r for r in A.rows('expo_photos', SAPP) if r['id'] == p_del['id']][0]
    check('A 사진 삭제 → B에서 사라짐 + 삭제 표시(tombstone) + Storage 파일 삭제', srvp['deleted'] and not A.storage_exists(p_del['path']), f'{round(time.time()-t0,1)}초')
    A_.set_input_files(f'input[data-rep="{p_rep["id"]}"]', os.path.join(IMG, 'card1.jpg')); t0 = time.time()
    wait(B_, f"(()=>{{const p=window.__expo.state().photos.find(x=>x.id==='{p_rep['id']}');return p&&p.ts>{p_rep['ts']}&&p.hasBlob&&p.h===933}})()", timeout=30000)
    wait(A_, "window.__expo.state().dirty===0", timeout=20000); time.sleep(1)
    newp = [x for x in st(A_)['photos'] if x['id'] == p_rep['id']][0]
    check('A 사진 교체 → B에 새 사진 + 옛 Storage 파일 삭제', A.storage_exists(newp['path']) and not A.storage_exists(p_rep['path']), f'{round(time.time()-t0,1)}초')
    mk = B_.eval_on_selector_all('#ph-photo .mk', 'e=>e.map(x=>x.textContent)')
    check('사진 아래 최종 수정 표시', mk and mk[0].startswith(f"사용자 {nos['A']} ·"), mk)
    B_.evaluate("document.querySelector('#ph-photo').scrollIntoView({block:'center'})"); shot(B_, 's4_photo_replaced')

    # ---- 오프라인 → 재연결
    devs['B'][0].set_offline(True); time.sleep(0.5)
    B_.goto(URL + '#c/' + C3); B_.wait_for_selector('#f-memo')
    B_.fill('#f-memo', 'B 오프라인 메모'); B_.set_input_files('input[data-kind=card][capture]', os.path.join(IMG, 'card1.jpg'))
    B_.wait_for_selector('#ph-card img')
    net = B_.text_content('#net')
    A_.goto(URL + '#c/' + C3); A_.wait_for_selector('#f-answer'); A_.fill('#f-answer', 'A 온라인 답변')
    time.sleep(2)
    check('오프라인 중 표시(보낼 것 n건)', '오프라인' in net, net)
    devs['B'][0].set_offline(False); B_.evaluate("window.dispatchEvent(new Event('online'))"); t0 = time.time()
    wait(A_, "document.querySelector('#f-memo').value==='B 오프라인 메모' && document.querySelectorAll('#ph-card img').length===1", timeout=40000)
    wait(B_, "document.querySelector('#f-answer').value==='A 온라인 답변'", timeout=40000)
    check('오프라인 편집·사진 → 재연결 후 동기화(양방향)', True, f'{round(time.time()-t0,1)}초')
    shot(B_, 's5_after_reconnect')

    # ---- 임시 번호 (서버에 못 닿는 첫 실행)
    ctxD, D = device()
    D.route(re.compile(r'.*supabase\.co.*'), lambda r: r.abort())
    D.goto(URL); D.wait_for_selector('#pw'); D.fill('#pw', PW); D.click('#lbtn'); D.wait_for_selector('#cards')
    D.goto(URL + '#c/' + C2); D.wait_for_selector('#f-memo'); D.fill('#f-memo', 'D 임시번호 메모'); time.sleep(1)
    tmp_ok = '임시' in D.text_content('#me') and D.text_content('#mk-memo').startswith('사용자 ?(임시)')
    D.unroute(re.compile(r'.*supabase\.co.*')); D.evaluate("window.__expo.syncNow()")
    wait(D, "window.__expo.state().me.no && window.__expo.state().dirty===0", timeout=40000)
    dno = st(D)['me']['no']
    wait(A_, "true"); A_.goto(URL + '#c/' + C2); A_.wait_for_selector('#f-memo')
    wait(A_, "document.querySelector('#f-memo').value==='D 임시번호 메모'", timeout=20000)
    check('연결 안 될 때 임시 번호 → 연결 후 진짜 번호로 바뀌어 전송', tmp_ok and A_.text_content('#mk-memo').startswith(f'사용자 {dno} ·'), f'임시표시={tmp_ok}, 부여={dno}, A화면={A_.text_content("#mk-memo")}')
    ctxD.close()

    # ---- 녹음 (가짜 마이크)
    for pg in (A_, B_): pg.goto(URL + '#c/' + C1); pg.wait_for_selector('#recbtn')
    check('녹음 안내 문구', '녹음 전 상대방에게 녹음 사실을 알려 주세요.' in A_.text_content('#recsec'))
    sr_supported = A_.evaluate("!!(window.SpeechRecognition||window.webkitSpeechRecognition)")
    pre = {r['id'] for r in st(A_)['recs']}
    A_.click('#recbtn'); time.sleep(3.2); A_.click('#recbtn')
    wait(A_, "window.__expo.state().recs.some(r=>r.path && !r.dirty && r.cid===%r && !%r.includes(r.id))" % (C1, sorted(pre)), timeout=30000)
    rec = [r for r in st(A_)['recs'] if r['cid'] == C1 and r['id'] not in pre][0]
    raw = A.storage_get(rec['path'])[1]
    plain = A.dec_bytes(raw)
    check('녹음 → 암호화 → Storage 업로드 → 작업 생성', rec['status'] in ('pending', 'processing', 'done') and (plain[:4] == b'\x1aE\xdf\xa3' or plain[4:8] == b'ftyp'), f"{rec['mime']}, {rec['duration']}ms, 암호문 {len(raw)}B, 상태 {rec['status']}")
    wait(B_, "[...document.querySelectorAll('#reclist .rst')].some(e=>/대기|처리 중|완료/.test(e.textContent))", timeout=20000)
    check('B 화면에 녹음·작업 상태 표시', True, B_.text_content('#reclist .rst'))
    # 박스의 실제 받아쓰기·요약 작업자가 돌고 있으면 그쪽 결과를, 15초 안에 아무도 안 가져가면 가짜 작업자로 대신
    t0 = time.time(); who_done = None; seen_proc = False
    while time.time() - t0 < 240:
        row = [r for r in A.rows('expo_recordings', SAPP) if r['id'] == rec['id']][0]
        if row['status'] == 'processing': seen_proc = True
        if row['status'] in ('done', 'failed'): who_done = row['worker']; break
        if row['status'] == 'pending' and time.time() - t0 > 15:
            job = A.claim()
            if job and job.get('id') == rec['id']:
                summary = {'v': 1, 'topics': [{'title': '장비 임대 조건', 'lines': ['월 단위 임대 가능', '데이터는 원본 제공', '교육 1회 포함']}], 'qa': [{'q': '공동입찰 시 장비 임대·데이터 제공 조건', 'a': '월 임대, 데이터 원본 제공 (테스트)'}], 'actions': ['다음 주 견적 요청 (테스트)'], 'model': 'fake', 'stt': 'fake'}
                A.finish(job['id'], '테스트 받아쓰기 원문입니다. 이름은 넣지 않습니다.', summary)
            elif job and job.get('id'):
                A.call('PATCH', f"/rest/v1/expo_recordings?id=eq.{job['id']}", {'status': 'pending', 'worker': None}, headers={'Prefer': 'return=minimal'})
        time.sleep(2)
    row = [r for r in A.rows('expo_recordings', SAPP) if r['id'] == rec['id']][0]
    ok_done = row['status'] == 'done'
    if ok_done:
        for pg in (A_, B_): wait(pg, "!!document.querySelector('.sumbox')", timeout=20000)
    check('작업 대기→처리→완료, 요약이 Realtime으로 A·B에 표시', ok_done and B_.query_selector('.sumbox') is not None, f"처리: {who_done}, {round(time.time()-t0)}초, 처리중 관찰={seen_proc}, 상태={row['status']} {row.get('error') or ''}")
    if ok_done:
        A_.click('[data-apply]'); wait(B_, "document.querySelector('#f-memo').value.includes('[녹음 요약')", timeout=15000)
        check('‘메모에 넣기’ → 메모 칸에 들어가고 B에도 반영(편집 가능)', '[녹음 요약' in B_.input_value('#f-memo'))
        # 받아쓰기 원문 표시: 서버 행에 원문을 넣어 Realtime으로 화면 갱신 확인(가짜 마이크는 삐 소리라 실제 원문이 비어 있을 수 있음)
        A.call('PATCH', f"/rest/v1/expo_recordings?id=eq.{rec['id']}", {'transcript_enc': A.enc_text('받아쓰기 원문 표시 확인용 문장입니다.')}, headers={'Prefer': 'return=minimal'})
        wait(B_, "[...document.querySelectorAll('#reclist details.sub')].some(d=>d.textContent.includes('받아쓰기 원문 표시 확인용') && !d.open)", timeout=20000)
        check('받아쓰기 원문은 접힌 상자(<details>)에, Realtime 갱신', True)
    B_.evaluate("document.querySelector('#recsec').scrollIntoView()"); time.sleep(0.3); shot(B_, 's6_recording_summary')
    # 오프라인 녹음
    devs['B'][0].set_offline(True); time.sleep(0.3)
    B_.click('#recbtn'); time.sleep(2.2); B_.click('#recbtn'); time.sleep(0.8)
    off_local = any(r['dirty'] and not r['path'] for r in st(B_)['recs'])
    devs['B'][0].set_offline(False); B_.evaluate("window.dispatchEvent(new Event('online'))")
    wait(B_, "window.__expo.state().recs.filter(r=>!r.deleted).every(r=>r.path && !r.dirty)", timeout=40000)
    check('오프라인 녹음은 기기에 저장 → 재연결 후 자동 업로드·작업 생성', off_local and len([r for r in A.rows('expo_recordings', SAPP) if not r['deleted'] and r['cid'] == C1]) >= 2)
    # ---- 보고서 (녹음 요약·문답 포함, 원문·번호 없음)
    A_.goto(URL + '#report'); A_.wait_for_selector('#preview .rep'); time.sleep(0.8)
    rep = A_.text_content('#preview')
    trs = [A.dec_text(r['transcript_enc']) for r in A.rows('expo_recordings', SAPP) if r['id'] == rec['id'] and r['transcript_enc']]
    ok = ('완료' in rep and '방문중' in rep and '녹음 요약 (' in rep and not any(t and t[:20] in rep for t in trs) and '사용자 ' not in rep)
    check('보고서: 상태·녹음 요약·문답 포함, 받아쓰기 원문·사용자 번호 없음', ok)
    A_.evaluate("document.querySelector('.rsum') && document.querySelector('.rsum').scrollIntoView({block:'center'})"); time.sleep(0.3); shot(A_, 's7_report')
    A_.goto(URL + '#c/' + C1); A_.wait_for_selector('#recbtn')
    # 녹음 삭제
    rid_ = rec['id']; A_.click(f'[data-rdel="{rid_}"]')
    wait(B_, f"!window.__expo.state().recs.some(r=>r.id==='{rid_}' && !r.deleted)", timeout=20000); time.sleep(1.5)
    srvr = [r for r in A.rows('expo_recordings', SAPP) if r['id'] == rid_][0]
    check('녹음 삭제 → B에서 사라짐 + tombstone + Storage 삭제', srvr['deleted'] and not A.storage_exists(rec['path']))
    errs = sum((devs[n][1]._errs for n in 'ABC'), [])
    check('화면 스크립트 오류 없음(3대)', not errs, '; '.join(errs)[:200])
    check('Web Speech API(실시간 초안) 지원 여부 — 헤드리스 Chromium', True, '지원됨' if sr_supported else '미지원(토글 대신 안내 문구 표시)')
    br.close()
A.cleanup((SAPP,))
npass = sum(1 for r in R if r[1]); print(f'\n결과: {npass}/{len(R)} 통과')
json.dump(R, open(os.path.join(SHOTS, f'result_{TAG}.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if npass == len(R) else 1)
