"""검증용 서버 관리 도우미(service_role, 박스 전용). 비밀값은 출력하지 않는다."""
import json, os, urllib.request, base64, hashlib
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
U = 'https://bimfyrigrmwhlglbkumj.supabase.co'
_k = json.load(open(os.path.join(ROOT, 'secrets/api_keys.json'))); _k = _k if isinstance(_k, list) else _k.get('keys', _k)
SVC = [x['api_key'] for x in _k if x['name'] == 'service_role'][0]
def _pw(): return open(os.path.join(ROOT, 'PASSWORD.txt'), encoding='utf-8').read().strip()
KEY = hashlib.pbkdf2_hmac('sha256', _pw().encode(), b'expo2026-sync-v1', 310000, 32)
def enc_text(s): iv = os.urandom(12); return base64.b64encode(iv + AESGCM(KEY).encrypt(iv, s.encode(), None)).decode()
def dec_text(t): b = base64.b64decode(t); return AESGCM(KEY).decrypt(b[:12], b[12:], None).decode()
def dec_bytes(b): return AESGCM(KEY).decrypt(b[:12], b[12:], None)
def call(method, path, body=None, raw=False, headers=None):
    h = {'apikey': SVC, 'Authorization': 'Bearer ' + SVC, 'Content-Type': 'application/json'}; h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    try:
        r = urllib.request.urlopen(urllib.request.Request(U + path, data=data, method=method, headers=h)); b = r.read()
        return r.status, (b if raw else (json.loads(b) if b else None))
    except urllib.error.HTTPError as e: return e.code, e.read()[:300]
def rows(table, app): return call('GET', f'/rest/v1/{table}?app=eq.{app}&select=*')[1]
def storage_list(prefix):
    st, d = call('POST', '/storage/v1/object/list/expo', {'prefix': prefix, 'limit': 1000}); return d if st == 200 else []
def storage_exists(path):
    folder, name = path.rsplit('/', 1); return any(o.get('name') == name for o in storage_list(folder))
def storage_get(path): return call('GET', '/storage/v1/object/expo/' + path, raw=True)
def claim(worker='e2e-fake-worker'): return call('POST', '/rest/v1/rpc/expo_claim_rec', {'p_worker': worker})[1]
def finish(rec_id, transcript, summary_obj):
    return call('PATCH', f'/rest/v1/expo_recordings?id=eq.{rec_id}', {'status': 'done', 'transcript_enc': enc_text(transcript), 'summary_enc': enc_text(json.dumps(summary_obj, ensure_ascii=False)), 'result_at': 'now()'}, headers={'Prefer': 'return=minimal'})
def cleanup(apps=('t1', 't2')):
    n = 0
    for app in apps:
        for t in ('expo_items', 'expo_photos', 'expo_recordings'):
            call('DELETE', f'/rest/v1/{t}?app=eq.{app}', headers={'Prefer': 'return=minimal'})
        for sub in ('ph', 'rec'):
            for o in storage_list(f'{app}/{sub}'):
                folder = f'{app}/{sub}/{o["name"]}'
                files = [f'{folder}/{x["name"]}' for x in storage_list(folder)]
                if files: call('DELETE', '/storage/v1/object/expo', {'prefixes': files}); n += len(files)
    return n
