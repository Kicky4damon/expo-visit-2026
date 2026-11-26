"""실제로 있는 암호화 파일을 anon/publishable 키만으로 내려받기·지우기 시도 → 거부돼야 함."""
import sys, os, json, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import sb_admin as A
P = 't1/anon-probe/x.bin'
req = urllib.request.Request(A.U + '/storage/v1/object/expo/' + P, data=b'probe', method='POST', headers={'apikey': A.SVC, 'Authorization': 'Bearer ' + A.SVC, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true'})
print('service_role upload', urllib.request.urlopen(req).status)
keys = json.load(open(os.path.join(A.ROOT, 'secrets/api_keys.json'))); keys = keys if isinstance(keys, list) else keys.get('keys', keys)
res = []
for k in [x['api_key'] for x in keys if x['name'] == 'anon' or x['type'] == 'publishable']:
    h = {'apikey': k}
    if k.startswith('ey'): h['Authorization'] = 'Bearer ' + k
    for path in ('/storage/v1/object/expo/', '/storage/v1/object/authenticated/expo/', '/storage/v1/object/public/expo/'):
        try: r = urllib.request.urlopen(urllib.request.Request(A.U + path + P, headers=h)); res.append(('download ' + path.split('object/')[1], False, r.status))
        except urllib.error.HTTPError as e: res.append(('download ' + path.split('object/')[1], True, e.code))
    try:
        r = urllib.request.urlopen(urllib.request.Request(A.U + '/storage/v1/object/expo', data=json.dumps({'prefixes': [P]}).encode(), method='DELETE', headers=dict(h, **{'Content-Type': 'application/json'})))
        res.append(('delete', r.read().strip() == b'[]', r.status))
    except urllib.error.HTTPError as e: res.append(('delete', True, e.code))
ex = A.storage_exists(P); res.append(('file still there after anon delete', ex, ''))
A.call('DELETE', '/storage/v1/object/expo', {'prefixes': [P]})
for r in res: print('PASS' if r[1] else 'FAIL', *r[::2])
print(f"{sum(r[1] for r in res)}/{len(res)}; cleaned={not A.storage_exists(P)}")
