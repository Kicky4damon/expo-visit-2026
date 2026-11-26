"""anon(공개) 키만으로 읽기·쓰기·스토리지·가입이 모두 거부되는지 확인."""
import json, sys, urllib.request, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
keys = json.load(open(os.path.join(ROOT, 'secrets/api_keys.json'))); keys = keys if isinstance(keys, list) else keys.get('keys', keys)
U = 'https://bimfyrigrmwhlglbkumj.supabase.co'
res = []
for kname in ('anon', 'default'):
    k = [x['api_key'] for x in keys if x['name'] == kname and x['type'] in ('legacy', 'publishable')][0]
    def call(method, path, body=None, ctype='application/json', bearer=True):
        h = {'apikey': k, 'Content-Type': ctype}
        if bearer and k.startswith('ey'): h['Authorization'] = 'Bearer ' + k
        data = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else None)
        try:
            r = urllib.request.urlopen(urllib.request.Request(U + path, data=data, method=method, headers=h)); return r.status, r.read()[:200]
        except urllib.error.HTTPError as e: return e.code, e.read()[:200]
    t = {
      'read items': call('GET', '/rest/v1/expo_items?select=*'),
      'read photos': call('GET', '/rest/v1/expo_photos?select=*'),
      'write insert': call('POST', '/rest/v1/expo_items', {'app': 'p1', 'cid': 'x', 'field': 'x', 'ts': 1, 'by_no': 1}),
      'write rpc put_item': call('POST', '/rest/v1/rpc/expo_put_item', {'p_app': 'p1', 'p_cid': 'x', 'p_field': 'x', 'p_value': 'x', 'p_ts': 1, 'p_by': 1}),
      'rpc next_user': call('POST', '/rest/v1/rpc/expo_next_user', {'p_app': 'p1'}),
      'storage list': call('POST', '/storage/v1/object/list/expo', {'prefix': '', 'limit': 10}),
      'storage upload': call('POST', '/storage/v1/object/expo/p1/anon-test.bin', b'hello', 'application/octet-stream'),
      'storage download': call('GET', '/storage/v1/object/expo/p1/anon-test.bin'),
      'auth signup': call('POST', '/auth/v1/signup', {'email': 'intruder@example.com', 'password': 'Intruder-123456'}),
    }
    for name, (code, body) in t.items():
        if name.startswith('read'):
            ok = code >= 400 or body.strip() == b'[]'
        elif name == 'storage list':
            ok = code >= 400 or body.strip() == b'[]'
        else:
            ok = code >= 400
        res.append((f'[{kname}] {name}', ok, code, body.decode('utf-8', 'replace')[:90]))
for r in res: print('PASS' if r[1] else 'FAIL', r[0], r[2], r[3])
print(f"{sum(r[1] for r in res)}/{len(res)}")
