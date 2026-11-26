#!/usr/bin/env python3
"""Encrypt data_src/<app>.json -> <app>/data.enc.json (AES-GCM, PBKDF2-SHA256).
Password is read from PASSWORD.txt (never printed)."""
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITER = 310000
pw = open(os.path.join(ROOT, 'PASSWORD.txt'), encoding='utf-8').read().strip().encode('utf-8')
b64 = lambda b: base64.b64encode(b).decode()
for app in sys.argv[1:] or ['p1', 'p2']:
    plain = json.dumps(json.load(open(os.path.join(ROOT, 'data_src', app + '.json'), encoding='utf-8')), ensure_ascii=False).encode('utf-8')
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw)
    ct = AESGCM(key).encrypt(iv, plain, None)
    out = {"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER, "alg": "AES-GCM-256", "salt": b64(salt), "iv": b64(iv), "ct": b64(ct)}
    json.dump(out, open(os.path.join(ROOT, app, 'data.enc.json'), 'w'), separators=(',', ':'))
    print(app, 'encrypted', len(plain), 'bytes')
