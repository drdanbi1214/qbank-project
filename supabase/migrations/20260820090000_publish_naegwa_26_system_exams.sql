-- 내과 26학번 계통 시험 6개(소화기 1·2·3차, 호흡기 1·2차, 내분비 1차) 발행.
--
-- 야마 검색(search_questions)이 status='published' 만 보므로, 초안 상태로는
-- 레옵스 테마에 문제를 붙일 수 없다. 열람 범위는 required_permission
-- ('curriculum_system_y_view') 이 따로 막고 있어 발행해도 전체 공개가 아니다.

update public.questions q
   set status = 'published'
  from public.exams e, public.subjects s
 where q.exam_id = e.id and e.subject_id = s.id
   and s.name = '내과' and e.cohort = '26학번'
   and e.status = 'draft' and q.status = 'draft';

update public.exams e
   set status = 'published'
  from public.subjects s
 where e.subject_id = s.id
   and s.name = '내과' and e.cohort = '26학번' and e.status = 'draft';
