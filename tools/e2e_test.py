#!/usr/bin/env python3
"""모바일(390x844) 헤드리스 Chromium 검증. 사용: e2e_test.py BASE_URL TAG [--samples]
비밀번호는 PASSWORD.txt에서 읽어 입력칸에만 넣고, 출력하지 않는다."""
import sys, os, re, json, zipfile, time
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE, TAG = sys.argv[1].rstrip('/'), sys.argv[2]
SAMPLES = '--samples' in sys.argv
PW = open(os.path.join(ROOT, 'PASSWORD.txt'), encoding='utf-8').read().strip()
SHOTS = os.path.join(ROOT, 'shots'); os.makedirs(SHOTS, exist_ok=True)
DL = os.path.join(ROOT, 'work', 'dl_' + TAG); os.makedirs(DL, exist_ok=True)
SAMPLE = os.path.join(ROOT, 'sample'); os.makedirs(SAMPLE, exist_ok=True)
IMG = os.path.join(ROOT, 'work', 'testimg')
REAL_PHONES = set()
for a in ('p1', 'p2'):
    for c in json.load(open(os.path.join(ROOT, 'data_src', a + '.json')))['companies']:
        for p in c['contacts']:
            if p['phone']: REAL_PHONES.add(p['phone'])
EXPECT = {a: [c['name'] for c in json.load(open(os.path.join(ROOT, 'data_src', a + '.json')))['companies']] for a in ('p1', 'p2')}
TITLES = {'p1': '1순위 · 사장님 방문 동선', 'p2': '2순위 방문 동선'}
R = []
def check(name, ok, detail=''):
    R.append((name, bool(ok), detail)); print(('PASS' if ok else 'FAIL'), name, ('— ' + detail) if detail else '', flush=True)

def shot(page, name): page.screenshot(path=os.path.join(SHOTS, f'{TAG}_{name}.png'), full_page=False)

def download(page, selector):
    with page.expect_download(timeout=30000) as d: page.click(selector)
    dl = d.value; path = os.path.join(DL, dl.suggested_filename); dl.save_as(path); return path

def unlock(page, app, wrong_first=False):
    page.goto(f'{BASE}/{app}/?ns=test', wait_until='domcontentloaded')
    page.wait_for_selector('#pw', timeout=20000)
    if wrong_first:
        page.fill('#pw', 'wrong-password-123'); page.click('#lbtn')
        page.wait_for_function("document.querySelector('#lerr') && document.querySelector('#lerr').textContent.length>0", timeout=20000)
        check(f'[{app}] 틀린 비밀번호 거부', '맞지 않아요' in page.text_content('#lerr'), page.text_content('#lerr'))
    page.fill('#pw', PW); page.click('#lbtn')
    page.wait_for_selector('#cards', timeout=30000)

with sync_playwright() as p:
    br = p.chromium.launch(args=['--disable-dev-shm-usage'])
    for app in ('p1', 'p2'):
        ctx = br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ko-KR', timezone_id='Asia/Seoul', accept_downloads=True, service_workers='allow')
        page = ctx.new_page(); errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        page.goto(f'{BASE}/{app}/?ns=test'); page.wait_for_selector('#pw', timeout=20000)
        if app == 'p1': shot(page, f'{app}_0_lock')
        unlock(page, app, wrong_first=True)
        check(f'[{app}] 비밀번호 해제', page.is_visible('#cards'))
        check(f'[{app}] 머리글 제목', page.text_content('.top h1').strip() == TITLES[app], page.text_content('.top h1'))
        names = page.eval_on_selector_all('.cname', 'els=>els.map(e=>e.textContent.trim())')
        check(f'[{app}] 카드 {len(EXPECT[app])}개·순서', names == EXPECT[app], ' > '.join(names))
        tels = page.goto(f'{BASE}/{app}/?ns=test#c/{app}-1' if app == 'p1' else f'{BASE}/{app}/?ns=test#c/{app}-C')
        page.wait_for_selector('#seg')
        hrefs = page.eval_on_selector_all('a.tel', 'els=>els.map(e=>e.getAttribute("href"))')
        check(f'[{app}] 전화 tel: 링크', hrefs and all(re.fullmatch(r'tel:010\d{8}', h) for h in hrefs), f'{len(hrefs)}개')
        page.goto(f'{BASE}/{app}/?ns=test#list'); page.wait_for_selector('#cards')
        shot(page, f'{app}_1_list')
        # 상세 입력
        first = f'{app}-1' if app == 'p1' else f'{app}-A'
        page.click(f'[data-open="{first}"]'); page.wait_for_selector('#seg')
        shot(page, f'{app}_2_detail_top')
        page.click('[data-st=done]'); page.wait_for_selector('#seg .on.s-done')
        vals = {'answer': '테스트 답변: 장비 임대 가능, 데이터는 별도 협의 (가짜)', 'met': '홍길동 과장 (가짜 인물, 010-0000-0000)', 'memo': '테스트 메모 줄1\n줄2 — 시연 영상 확인', 'followup': '다음 주 화요일까지 견적 요청 메일 (테스트)'}
        for k, v in vals.items(): page.fill(f'#f-{k}', v)
        page.set_input_files('input[data-kind=photo][multiple]', [os.path.join(IMG, 'site1.jpg'), os.path.join(IMG, 'site2.jpg')])
        page.wait_for_function("document.querySelectorAll('#ph-photo img').length==2", timeout=20000)
        page.set_input_files('input[data-kind=card][capture]', os.path.join(IMG, 'card1.jpg'))
        page.wait_for_function("document.querySelectorAll('#ph-card img').length==1", timeout=20000)
        page.click('#savebtn'); page.wait_for_timeout(500)
        saved = page.text_content('#saved')
        check(f'[{app}] 저장 버튼·저장 시각 표시', re.search(r'저장됨 \d\d:\d\d:\d\d', saved), saved)
        st = page.evaluate('window.__expo.state()')
        dims = [(x['w'], x['h']) for x in st['photos']]
        check(f'[{app}] 사진 3장(현장2·명함1) 저장·긴 변 1600px', len(dims) == 3 and all(max(d) == 1600 for d in dims), str(dims))
        page.evaluate("document.querySelector('#f-memo').scrollIntoView()"); page.wait_for_timeout(200)
        shot(page, f'{app}_3_detail_input')
        page.evaluate("document.querySelector('#ph-card').scrollIntoView({block:'end'})"); page.wait_for_timeout(300)
        shot(page, f'{app}_4_detail_photos')
        # 자동 저장만으로(저장 버튼 없이) 새로고침 유지
        page.fill('#f-memo', vals['memo'] + '\n자동저장 확인'); page.wait_for_timeout(100)
        page.reload(); page.wait_for_selector('#seg')
        got = {k: page.input_value(f'#f-{k}') for k in vals}
        ok = all(got[k] == vals[k] for k in ('answer', 'met', 'followup')) and got['memo'].endswith('자동저장 확인')
        check(f'[{app}] 새로고침 후 입력 유지(자동 저장)', ok and page.is_visible('#seg .on.s-done'))
        check(f'[{app}] 새로고침 후 사진 유지', page.eval_on_selector_all('.ph img', 'e=>e.length') == 3)
        # 브라우저 닫았다 열기(같은 저장소)
        state = ctx.storage_state()
        # 오프라인
        page.goto(f'{BASE}/{app}/?ns=test#list'); page.wait_for_selector('#cards')
        page.wait_for_function('navigator.serviceWorker && navigator.serviceWorker.controller', timeout=20000)
        page.wait_for_timeout(800)
        ctx.set_offline(True)
        try:
            page.reload(wait_until='domcontentloaded'); page.wait_for_selector('#cards', timeout=15000)
            n_off = page.eval_on_selector_all('.cname', 'e=>e.length')
            page.click(f'[data-open="{first}"]'); page.wait_for_selector('#seg')
            off_ok = n_off == len(EXPECT[app]) and page.input_value('#f-answer') == vals['answer'] and page.eval_on_selector_all('.ph img', 'e=>e.length') == 3
            check(f'[{app}] 오프라인 새로고침·기록 열람', off_ok, f'카드 {n_off}개')
            if app == 'p1': shot(page, f'{app}_5_offline_detail')
        finally:
            ctx.set_offline(False)
        # 보내기
        page.goto(f'{BASE}/{app}/?ns=test#more'); page.wait_for_selector('#x-csv')
        shot(page, f'{app}_6_export')
        csvp = download(page, '#x-csv'); raw = open(csvp, 'rb').read(); txt = raw.decode('utf-8-sig')
        import csv, io
        rows = list(csv.reader(io.StringIO(txt)))
        check(f'[{app}] CSV 받기(BOM·내용)', raw[:3] == b'\xef\xbb\xbf' and len(rows) == len(EXPECT[app]) + 1 and [r[1] for r in rows[1:]] == EXPECT[app] and rows[1][6] == vals['answer'] and rows[1][4] == '완료', f'{os.path.basename(csvp)}, {len(rows)}행')
        txtp = download(page, '#x-txt'); t = open(txtp, encoding='utf-8').read()
        check(f'[{app}] 텍스트 받기(내용)', all(n in t for n in EXPECT[app]) and vals['followup'] in t and '사진 2장 · 명함 1장' in t, os.path.basename(txtp))
        bkp = download(page, '#b-save'); bk = json.load(open(bkp, encoding='utf-8'))
        check(f'[{app}] 전체 백업(JSON·사진 base64)', bk['app'] == app and len([x for x in bk['photos'] if not x.get('deleted')]) == 3 and all(len(x['b64']) > 1000 for x in bk['photos'] if x.get('b64')), f"{os.path.getsize(bkp)//1024}KB")
        # 보고서
        page.goto(f'{BASE}/{app}/?ns=test#report'); page.wait_for_selector('#m-opinion')
        page.fill('#m-opinion', '종합 의견 테스트: 1순위 로봇 2개사와 실증 협력 우선 검토.\n(샘플 데이터)')
        page.check('#m-mask'); page.wait_for_timeout(600)
        prev = page.text_content('#preview')
        check(f'[{app}] 보고서 미리보기(종합 의견·업체·사진)', '종합 의견 테스트' in prev and all(n in prev for n in EXPECT[app]) and page.eval_on_selector_all('#preview img', 'e=>e.length') == 3)
        check(f'[{app}] 전화번호 가리기', not any(ph in prev for ph in REAL_PHONES) and ('010-****-****' in prev or app == 'p2'))
        shot(page, f'{app}_7_report_top')
        page.evaluate("document.querySelector('#preview').scrollIntoView()"); page.wait_for_timeout(300)
        shot(page, f'{app}_8_report_preview')
        docxp = download(page, '#r-docx')
        import docx as pydocx
        d = pydocx.Document(docxp); body = '\n'.join(p_.text for p_ in d.paragraphs) + '\n'.join(c.text for tb in d.tables for r in tb.rows for c in r.cells)
        nimg = sum(1 for n in zipfile.ZipFile(docxp).namelist() if n.startswith('word/media/'))
        check(f'[{app}] 워드(DOCX) 생성', '엘림주식회사' in body and '종합 의견 테스트' in body and all(n in body for n in EXPECT[app]) and nimg == 3 and not any(ph in body for ph in REAL_PHONES), f'이미지 {nimg}개, {os.path.getsize(docxp)//1024}KB')
        mdp = download(page, '#r-txt'); md = open(mdp, encoding='utf-8').read()
        check(f'[{app}] 보고서 텍스트', '종합 의견 테스트' in md and not any(ph in md for ph in REAL_PHONES))
        # 인쇄용 A4
        page.evaluate('window.print=()=>{}'); page.click('#r-print'); page.wait_for_timeout(500)
        pdfp = os.path.join(DL, f'{app}_report.pdf'); page.emulate_media(media='print'); page.pdf(path=pdfp, format='A4', print_background=True); page.emulate_media(media='screen')
        check(f'[{app}] 인쇄용 A4 → PDF', os.path.getsize(pdfp) > 20000, f'{os.path.getsize(pdfp)//1024}KB')
        if SAMPLES:
            import shutil
            label = '1순위' if app == 'p1' else '2순위'
            shutil.copy(pdfp, os.path.join(SAMPLE, f'샘플_방문보고서_{label}.pdf')); shutil.copy(docxp, os.path.join(SAMPLE, f'샘플_방문보고서_{label}.docx'))
        # 다른 기기에서 백업 불러오기
        ctx2 = br.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='ko-KR', timezone_id='Asia/Seoul', accept_downloads=True)
        pg2 = ctx2.new_page(); unlock(pg2, app)
        pg2.goto(f'{BASE}/{app}/?ns=test#more'); pg2.wait_for_selector('#b-imp', state='attached')
        pg2.on('dialog', lambda dg: dg.accept())
        pg2.set_input_files('#b-imp', bkp); pg2.wait_for_selector('#cards', timeout=20000); pg2.wait_for_timeout(1500)
        pg2.click(f'[data-open="{first}"]'); pg2.wait_for_selector('#seg')
        check(f'[{app}] 다른 기기에서 백업 불러오기', pg2.input_value('#f-answer') == vals['answer'] and pg2.eval_on_selector_all('.ph img', 'e=>e.length') == 3)
        if app == 'p1':
            # 다른 앱 백업 거부
            pg3 = ctx2.new_page(); unlock(pg3, 'p2'); pg3.goto(f'{BASE}/p2/?ns=test#more'); pg3.wait_for_selector('#b-imp', state='attached')
            pg3.set_input_files('#b-imp', bkp); pg3.wait_for_timeout(800)
            check('[p2] 1순위 백업은 2순위 앱에서 거부', '다른 앱' in (pg3.text_content('#toast') or '')); pg3.close()
        ctx2.close()
        # 같은 브라우저 닫고 다시 열기
        ctx.close()
        ctx3 = br.new_context(viewport={'width': 390, 'height': 844}, storage_state=state)
        # storage_state는 IndexedDB를 옮기지 않으므로 localStorage 사본 복구 확인용
        pg = ctx3.new_page(); pg.goto(f'{BASE}/{app}/?ns=test'); pg.wait_for_selector('#pw')
        ls_ok = pg.evaluate(f"Object.keys(localStorage).some(k=>k.startsWith('expo2026-{app}-test-i-{first}|'))")
        check(f'[{app}] 입력 즉시 localStorage 사본 기록', ls_ok); ctx3.close()
        check(f'[{app}] 화면 스크립트 오류 없음', not errs, '; '.join(errs)[:200])
    br.close()
npass = sum(1 for r in R if r[1]); print(f'\n결과: {npass}/{len(R)} 통과')
json.dump(R, open(os.path.join(ROOT, 'work', f'result_{TAG}.json'), 'w'), ensure_ascii=False, indent=1)
sys.exit(0 if npass == len(R) else 1)
