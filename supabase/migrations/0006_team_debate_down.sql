-- 0006_team_debate.sql 되돌리기. 팀 토론 데이터가 전부 사라진다.
-- 기존 1:1 테이블은 건드리지 않는다. open_session_atomic 은 0002 버전으로 되돌린다.
-- 모든 문장이 if exists 라서 0001_down 뒤에 돌아도 오류가 나지 않는다.
begin;

drop function if exists team_poll(uuid, jsonb, bigint);
drop function if exists team_chat(uuid, uuid, uuid, uuid, text, boolean);
drop function if exists team_speak(uuid, uuid, uuid, uuid, text);
drop function if exists team_claim(uuid, uuid, uuid, uuid);
drop function if exists team_enter(uuid, uuid, uuid, uuid);
drop function if exists team_resolve_member(uuid, uuid, uuid, uuid);
drop function if exists team_set_members(uuid, jsonb);
drop function if exists team_control(uuid, text);
drop function if exists open_team_debate_atomic(uuid);
drop function if exists team_enter_phase(uuid, team_phase);
drop function if exists team_tick_due(uuid);
drop function if exists team_tick(uuid);
drop function if exists team_check_pass_penalty(uuid);
drop function if exists team_after_turn(uuid, team_side, timestamptz);
drop function if exists team_open_turn(uuid, team_phase, team_side, timestamptz, int);
drop function if exists team_append(uuid, text, team_message_kind, team_phase, uuid, uuid, team_side, text);
drop function if exists team_next_side(uuid, team_phase, team_side);
drop function if exists team_final_cap();
drop function if exists team_phase_label(team_phase);
drop function if exists team_first_side(team_phase);
drop function if exists team_is_floor(team_phase);

drop table if exists team_reports;
drop table if exists team_alerts;
drop table if exists team_penalties;
drop table if exists team_score_edits;
drop table if exists team_speech_scores;
drop table if exists team_messages;
drop table if exists team_turns;
drop table if exists team_members;
drop table if exists team_debates;

drop type if exists team_message_kind;
drop type if exists team_phase;
drop type if exists team_side;

-- 1:1 세션 열기를 팀 토론 검사가 없는 0002 버전으로 되돌린다.
-- debate_sessions 가 이미 없으면(0001_down 뒤) 되돌릴 필요가 없다.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'debate_sessions') then
    execute $body$
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
    $body$;
  end if;
end $$;

commit;
