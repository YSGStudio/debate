-- 개인 토론에 찬성·반대 주장 문장을 둔다.
--
-- "찬성"/"반대" 라는 단어만 프롬프트에 넣으면 "숙제는 없어져야 한다" 같은 주제에서
-- 모델이 무엇에 찬성하는지를 거꾸로 읽는다. 교사가 확인한 한 문장씩을 저장해
-- 토론 챗봇·채점·학생 화면이 같은 기준을 쓰게 한다. 옛 세션은 null 로 남는다.
--
-- 0001_init.sql 에도 반영되어 있으므로 새로 설치하는 경우에는 이 파일을
-- 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

alter table debate_sessions add column if not exists pro_claim text;
alter table debate_sessions add column if not exists con_claim text;

do $$ begin
  alter table debate_sessions
    add constraint debate_sessions_pro_claim_len check (char_length(pro_claim) <= 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table debate_sessions
    add constraint debate_sessions_con_claim_len check (char_length(con_claim) <= 100);
exception when duplicate_object then null; end $$;

commit;
