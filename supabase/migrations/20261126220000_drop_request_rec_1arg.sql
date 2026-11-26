-- 같은 이름의 1인자판(p_id)과 2인자판(p_id, p_by default null)이 함께 있으면 {p_id}만으로 부를 때 모호해짐 → 1인자판 제거.
drop function if exists public.expo_request_rec(text);
