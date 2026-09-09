-- 채점 루브릭을 4항목 20점에서 5영역 100점 + 주제 이탈 감점으로 바꾼다.
--
--   주장 표현              15
--   근거의 적절성과 구체성   25
--   반론 이해와 대응        25
--   생각의 발전과 조정      25
--   토론 참여와 답변 충실성  10
--   ------------------------
--   기본 점수             100
--   주제 이탈 감점       0 ~ -15
--   최종 = 기본 + 감점 (0 미만으로 내려가지 않는다)
--
-- 옛 점수는 기준이 달라 그대로 두면 15점이 15/100 으로 잘못 보인다.
-- 값을 지우고 status='failed' 로 두어 교사가 "다시 채점" 을 누르면
-- 새 기준으로 다시 매겨지게 한다. 대화 기록 자체는 건드리지 않는다.
--
-- 0001_init.sql 에도 반영되어 있으므로 새로 설치하는 경우에는 이 파일을
-- 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

-- 옛 점수를 재채점 대상으로 돌린다 (컬럼을 지우기 전에 먼저 한다)
update debate_scores
   set status = 'failed',
       error  = '채점 기준이 100점 만점으로 바뀌었습니다. 다시 채점해 주세요.',
       total  = null,
       updated_at = now()
 where status = 'done';

-- 옛 컬럼 정리
alter table debate_scores drop column if exists score_listening;
alter table debate_scores drop column if exists score_expression;
alter table debate_scores drop constraint if exists debate_scores_score_evidence_check;
alter table debate_scores drop constraint if exists debate_scores_score_development_check;
alter table debate_scores drop constraint if exists debate_scores_total_check;

-- 새 영역 점수
alter table debate_scores add column if not exists score_claim         int;
alter table debate_scores add column if not exists score_counter       int;
alter table debate_scores add column if not exists score_participation int;
alter table debate_scores add column if not exists off_topic_penalty   int;
alter table debate_scores add column if not exists base_total          int;

-- 결과 해설
alter table debate_scores add column if not exists analysis       jsonb; -- 토론 참여 분석 4가지
alter table debate_scores add column if not exists change_summary text;  -- 생각의 변화 (선택지)
alter table debate_scores add column if not exists change_reason  text;  -- 그 판단의 이유 한 문장

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_claim_range') then
    alter table debate_scores add constraint debate_scores_claim_range
      check (score_claim between 0 and 15);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_evidence_range') then
    alter table debate_scores add constraint debate_scores_evidence_range
      check (score_evidence between 0 and 25);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_counter_range') then
    alter table debate_scores add constraint debate_scores_counter_range
      check (score_counter between 0 and 25);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_development_range') then
    alter table debate_scores add constraint debate_scores_development_range
      check (score_development between 0 and 25);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_participation_range') then
    alter table debate_scores add constraint debate_scores_participation_range
      check (score_participation between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_penalty_range') then
    alter table debate_scores add constraint debate_scores_penalty_range
      check (off_topic_penalty between -15 and 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_base_total_range') then
    alter table debate_scores add constraint debate_scores_base_total_range
      check (base_total between 0 and 100);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'debate_scores_total_range') then
    alter table debate_scores add constraint debate_scores_total_range
      check (total between 0 and 100);
  end if;
end $$;

commit;
