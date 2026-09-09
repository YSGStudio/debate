-- 학생 화면 옆에서 실시간으로 안내하는 '길잡이' 캐릭터의 피드백.
--
-- 판정(moderation_flags)은 이미 학생 메시지마다 한 번씩 돈다.
-- 코칭 판정을 별도 호출로 만들면 비용이 두 배가 되므로 같은 호출에 얹고
-- 결과를 같은 행에 저장한다.
--
--   praise      근거를 들어 잘 답했다 → 칭찬하고 채점에 좋게 반영된다고 알림
--   need_reason 근거 없는 단답 → 이유를 더 써보라고 안내
--   off_topic   주제 이탈 → 감점될 수 있다고 알리고 주제로 유도
--   none        굳이 말할 것이 없음 (매번 말을 걸면 시끄럽다)
--
-- 0001_init.sql 에도 반영되어 있으므로 새로 설치하는 경우에는 이 파일을
-- 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

alter table moderation_flags add column if not exists coach_kind    text;
alter table moderation_flags add column if not exists coach_message text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'moderation_flags_coach_kind_check') then
    alter table moderation_flags add constraint moderation_flags_coach_kind_check
      check (coach_kind is null or coach_kind in ('praise', 'need_reason', 'off_topic', 'none'));
  end if;
end $$;

commit;
