// 함께 쓰기(실시간 동기화) 서버 설정.
// anonKey는 브라우저 공개용(publishable) 키입니다. 이 키만으로는 읽기·쓰기·스토리지·가입이 모두 거부되고,
// 비밀번호에서 만든 공용 계정으로 로그인해야 접근됩니다.
window.SYNC_CONFIG = {
  kind: 'supabase',
  url: 'https://bimfyrigrmwhlglbkumj.supabase.co',
  anonKey: 'sb_publishable_JI5vMkjFvfNMvyMT1qCdCA_7KrqsBmq',
  authEmail: 'team@expo-visit-2026.elimsafety.com'
};
