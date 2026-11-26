# KINTEX 스마트건설 EXPO 2026 방문 기록 (엘림주식회사)

- `p1/` 1순위 · 사장님 방문 동선 (5곳), `p2/` 2순위 방문 동선 (6곳). 기능은 같고 저장소(IndexedDB 이름)·서비스워커 범위가 따로입니다.
- 업체 자료(`data.enc.json`)는 AES-GCM-256 + PBKDF2-SHA256(310,000회)로 암호화되어 있고, 처음 열 때 비밀번호로 풉니다. 평문 원본은 저장소에 없습니다.
- 기록은 각 기기 안(IndexedDB + localStorage 사본)에만 저장됩니다. 서버 동기화는 없고, 기기 간 이동은 ‘전체 백업’ 파일로 합니다.
- 빌드 도구 없음. `shared/docx.iife.js`(docx, MIT), Pretendard 글꼴(SIL OFL 1.1)을 로컬에 둡니다.
- `tools/encrypt.py`: 데이터 암호화, `tools/e2e_test.py`: 모바일 헤드리스 검증.
