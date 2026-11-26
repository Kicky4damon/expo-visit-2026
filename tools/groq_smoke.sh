#!/usr/bin/env bash
# Groq 무료 키가 들어온 뒤 한 번 실행: tools/groq_smoke.sh
# 키 위치: 환경변수 GROQ_API_KEY 또는 secrets/groq_api_key (chmod 600). 키는 출력하지 않음.
cd "$(dirname "$(readlink -f "$0")")/../stt_worker" && exec python3 groq_smoke.py 2>&1 | grep -vE "Processing audio|VAD filter"
