#!/usr/bin/env python3
"""배포 버전 도장: sw.js 캐시 이름과 index.html의 ?v= 를 새 버전으로 바꾼다(새 배포 시 옛 캐시 자동 교체)."""
import re, sys, time, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d%H%M%S')
for app in ('p1', 'p2'):
    for f in ('index.html', 'sw.js'):
        p = os.path.join(ROOT, app, f); s = open(p, encoding='utf-8').read()
        s = re.sub(r'\?v=[0-9A-Za-z._-]+', '?v=' + V, s)
        s = re.sub(r"const VERSION = '[^']+'", f"const VERSION = 'expo-{app}-{V}'", s)
        s = re.sub(r"window.APP_VERSION='[^']*'", f"window.APP_VERSION='{V}'", s)
        open(p, 'w', encoding='utf-8').write(s)
p = os.path.join(ROOT, 'index.html'); s = open(p, encoding='utf-8').read(); open(p, 'w', encoding='utf-8').write(re.sub(r'\?v=[0-9A-Za-z._-]+', '?v=' + V, s))
print('version', V)
