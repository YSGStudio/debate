-- 개인 토론에 미리 조사한 근거 자료를 둔다.
--
-- 토론 중에 실시간으로 웹 검색을 하면 응답이 길어지고(학년 분량 규칙 붕괴) 느려지며 비용이 몇 배가 된다.
-- 그래서 토론을 만들 때 찬성·반대 근거를 조사해 교사가 검토한 뒤 저장하고,
-- 토론 AI 는 이 목록 안에서만 연구·전문가 의견을 인용한다.
-- 항목 모양: {"side": "pro"|"con", "source": "...", "finding": "...", "url": "..."}
--
-- 0001_init.sql 에도 반영되어 있으므로 새로 설치하는 경우에는 이 파일을
-- 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

alter table debate_sessions add column if not exists evidence jsonb not null default '[]'::jsonb;

do $$ begin
  alter table debate_sessions
    add constraint debate_sessions_evidence_array check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 12);
exception when duplicate_object then null; end $$;

commit;
