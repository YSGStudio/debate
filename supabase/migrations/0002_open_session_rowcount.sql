-- 0001 을 이미 적용한 DB 를 위한 증분 마이그레이션.
-- open_session_atomic 이 UPDATE 갱신 행 수를 확인하도록 고친다.
--
-- 같은 세션에 동시 호출이 들어오면 두 번째 UPDATE 는 0행인데, 이전 버전은
-- 그래도 'opened' 를 돌려줬다. 아무것도 바꾸지 않고 성공을 보고하는 거짓 양성이다.
--
-- 0001_init.sql 에도 같은 내용이 반영되어 있으므로 새로 설치하는 경우에는
-- 이 파일을 따로 돌리지 않아도 된다 (돌려도 무해하다).

begin;

create or replace function open_session_atomic(p_session_id uuid)
returns table (result text, conflict_topic text)
language plpgsql
as $fn$
declare
  v_class_id uuid;
  v_status   session_status;
  v_single   boolean;
  v_open_id  uuid;
  v_topic    text;
  v_updated  int;
begin
  select ds.class_id, ds.status into v_class_id, v_status
  from debate_sessions ds where ds.id = p_session_id;

  if v_class_id is null then
    return query select 'not_found'::text, null::text; return;
  end if;
  if v_status <> 'draft' then
    return query select 'not_draft'::text, null::text; return;
  end if;

  -- 같은 학급의 동시 요청을 직렬화한다
  select c.single_active_session into v_single
  from classes c where c.id = v_class_id for update;

  if v_single then
    select ds.id, ds.topic into v_open_id, v_topic
    from debate_sessions ds
    where ds.class_id = v_class_id and ds.status = 'open'
    limit 1;

    if v_open_id is not null then
      return query select 'conflict'::text, v_topic; return;
    end if;
  end if;

  update debate_sessions
     set status = 'open', opened_at = now()
   where id = p_session_id and status = 'draft';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return query select 'not_draft'::text, null::text; return;
  end if;

  return query select 'opened'::text, null::text;
end;
$fn$;

commit;
