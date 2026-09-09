-- 토론 세션에도 보관함을 만든다.
--
-- 학급은 classes.archived_at 이 처음부터 있었지만 세션에는 없었다.
-- 삭제를 두 단계(보관 → 완전 삭제)로 나누려면 세션도 보관 상태를 가져야 한다.
--
-- 0001_init.sql 에도 반영되어 있으므로 새로 설치하는 경우에는 이 파일을
-- 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

alter table debate_sessions add column if not exists archived_at timestamptz;

-- 학생에게 보이는 "열린 토론" 조회는 보관된 것을 빼야 한다
drop index if exists idx_sessions_open;
create index if not exists idx_sessions_open
  on debate_sessions(class_id)
  where status = 'open' and archived_at is null;

commit;
