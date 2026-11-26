"""PASSWORD.txt에서 앱과 같은 방식으로 파생값을 만든다(출력하지 않음, import용)."""
import os, hashlib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_EMAIL = 'team@expo-visit-2026.elimsafety.com'
def password():
    return open(os.path.join(ROOT, 'PASSWORD.txt'), encoding='utf-8').read().strip()
def auth_password(pw=None):
    pw = pw or password()
    return hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), b'expo2026-auth-v1', 310000, 32).hex()
