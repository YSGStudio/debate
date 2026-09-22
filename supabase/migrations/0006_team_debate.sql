-- 팀 대항 토론 모드 (ver2 PRD V-R1~V-R50)
--
-- 학생끼리 찬성팀·반대팀으로 나뉘어 전체 토론방에서 차례를 번갈아 발언하고,
-- AI 는 심판으로 발언마다 채점한다. 기존 1:1 테이블은 건드리지 않는다.
--
-- 시간 이벤트(차례 60초 초과 → 패스)는 백그라운드 타이머가 아니라
-- 모든 폴링·쓰기 요청이 부르는 team_tick() 이 **team_debates 행 잠금 안에서** 처리한다.
-- 학생 30명이 동시에 폴링해도 패스는 한 번만 기록된다.
--
-- 이 파일은 멱등이다. 여러 번 돌려도 안전하다.

begin;

-- ── 열거형 ────────────────────────────────────────────────────────────────
do $$ begin create type team_side as enum ('pro','con'); exception when duplicate_object then null; end $$;
do $$ begin
  create type team_phase as enum ('waiting','opening','claim','rebuttal','counter','final','ended');
exception when duplicate_object then null; end $$;
do $$ begin
  create type team_message_kind as enum ('speech','pass','system','announcement','chat','draft','teacher_warning');
exception when duplicate_object then null; end $$;

-- ── 팀 토론 (V-R1, V-R2, V-R4) ────────────────────────────────────────────
create table if not exists team_debates (
  id                   uuid primary key default gen_random_uuid(),
  class_id             uuid not null references classes(id) on delete cascade,
  topic                text not null check (char_length(topic) between 1 and 100),
  description          text check (char_length(description) <= 300),
  grade_level          int  not null check (grade_level between 3 and 6),   -- 생성 시 학급 값 스냅샷
  status               session_status not null default 'draft',
  phase                team_phase not null default 'waiting',
  pro_name             text not null default '찬성팀' check (char_length(pro_name) between 1 and 20),
  con_name             text not null default '반대팀' check (char_length(con_name) between 1 and 20),
  -- 단계별 초. 키: opening/claim/rebuttal/counter/final
  stage_seconds        jsonb not null default '{"opening":180,"claim":480,"rebuttal":480,"counter":480,"final":360}',
  turn_seconds         int  not null default 60 check (turn_seconds between 30 and 120),
  score_visibility     text not null default 'after_end' check (score_visibility in ('live','after_end')),
  speaker_balance      boolean not null default false,
  phase_started_at     timestamptz,
  phase_deadline_at    timestamptz,
  paused_at            timestamptz,
  results_published_at timestamptz,
  next_seq             bigint not null default 0,   -- team_messages.seq 할당용 (행 잠금으로 직렬화)
  opened_at            timestamptz,
  closed_at            timestamptz,
  archived_at          timestamptz,
  created_at           timestamptz not null default now()
);

-- ── 팀 배정 (V-R3) ────────────────────────────────────────────────────────
create table if not exists team_members (
  id           uuid primary key default gen_random_uuid(),
  debate_id    uuid not null references team_debates(id) on delete cascade,
  student_id   uuid not null references students(id) on delete cascade,
  side         team_side not null,
  alias        text not null,              -- AI 에 보내는 가명 "찬성팀 학생1" (V-R32)
  speech_count int  not null default 0,
  device_id    uuid,                       -- 마지막으로 들어온 기기 (V-R9)
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  unique (debate_id, student_id),
  unique (debate_id, alias)
);

-- ── 차례 (V-R20~V-R24) ────────────────────────────────────────────────────
create table if not exists team_turns (
  id              uuid primary key default gen_random_uuid(),
  debate_id       uuid not null references team_debates(id) on delete cascade,
  phase           team_phase not null,
  idx             int  not null,
  side            team_side not null,
  started_at      timestamptz not null,
  deadline_at     timestamptz not null,
  ended_at        timestamptz,
  result          text check (result in ('speech','pass','phase_end')),
  lock_member_id  uuid references team_members(id) on delete set null,
  lock_expires_at timestamptz,
  unique (debate_id, phase, idx)
);

-- ── 메시지: 전체 토론방(floor) + 팀 채팅(pro/con) ─────────────────────────
create table if not exists team_messages (
  id         uuid primary key default gen_random_uuid(),
  debate_id  uuid not null references team_debates(id) on delete cascade,
  seq        bigint not null,
  channel    text not null check (channel in ('floor','pro','con')),
  kind       team_message_kind not null,
  phase      team_phase not null,
  side       team_side,                    -- 발언·패스·채팅의 팀. 교사 공지·시스템은 null
  turn_id    uuid references team_turns(id) on delete set null,
  member_id  uuid references team_members(id) on delete set null,
  content    text not null check (char_length(content) between 1 and 300),
  hidden_at  timestamptz,                  -- 교사가 가린 발언 (V-R17)
  created_at timestamptz not null default now(),
  unique (debate_id, seq)
);

-- ── 발언별 AI 채점 (V-R30~V-R37) ──────────────────────────────────────────
create table if not exists team_speech_scores (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null unique references team_messages(id) on delete cascade,
  debate_id        uuid not null references team_debates(id) on delete cascade,
  status           score_status not null default 'pending',
  logic            int check (logic between 0 and 2),
  evidence         int check (evidence between 0 and 1),
  response         int check (response between 0 and 1),
  phase_fit        int check (phase_fit between 0 and 1),
  attitude         int check (attitude between -3 and 0),
  total            int check (total between 0 and 5),     -- 서버가 합산한다
  reason           text,
  responded_to_seq bigint,
  edited_by        uuid references teachers(id) on delete set null,
  edited_at        timestamptz,                            -- 교사가 고친 점수는 재채점이 덮지 않는다
  model            text,
  attempts         int not null default 0,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists team_score_edits (
  id         uuid primary key default gen_random_uuid(),
  score_id   uuid not null references team_speech_scores(id) on delete cascade,
  teacher_id uuid references teachers(id) on delete set null,
  before     jsonb not null,
  after      jsonb not null,
  created_at timestamptz not null default now()
);

-- ── 연속 패스 감점 (V-R23). 서버가 기록하며 AI 가 매기지 않는다 ─────────────
create table if not exists team_penalties (
  id         uuid primary key default gen_random_uuid(),
  debate_id  uuid not null references team_debates(id) on delete cascade,
  side       team_side not null,
  phase      team_phase not null,
  points     int not null check (points < 0),
  reason     text not null,
  turn_id    uuid not null unique references team_turns(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ── 교사 알림 (V-R9, V-R23, V-R46) ────────────────────────────────────────
create table if not exists team_alerts (
  id              uuid primary key default gen_random_uuid(),
  debate_id       uuid not null references team_debates(id) on delete cascade,
  kind            text not null check (kind in ('inappropriate','duplicate_login','consecutive_pass')),
  member_id       uuid references team_members(id) on delete set null,
  side            team_side,
  message_id      uuid references team_messages(id) on delete set null,
  detail          text,
  acknowledged_at timestamptz,
  created_at      timestamptz not null default now()
);

-- ── 결과 (V-R38~V-R42) ────────────────────────────────────────────────────
create table if not exists team_reports (
  id            uuid primary key default gen_random_uuid(),
  debate_id     uuid not null unique references team_debates(id) on delete cascade,
  status        score_status not null default 'pending',
  pro_total     int,
  con_total     int,
  stage_totals  jsonb,
  winner        text check (winner in ('pro','con','draw')),
  feedback      jsonb,     -- { best: {pro, con}, missed: [], suggestions: [] }
  member_notes  jsonb,     -- { member_id: 잘한 점 }  (교사 전용)
  pending_count int not null default 0,
  model         text,
  attempts      int not null default 0,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 인덱스 ────────────────────────────────────────────────────────────────
create index if not exists idx_team_debates_class   on team_debates(class_id);
create index if not exists idx_team_debates_open    on team_debates(class_id) where status = 'open' and archived_at is null;
create index if not exists idx_team_members_debate  on team_members(debate_id);
create index if not exists idx_team_members_student on team_members(student_id);
create index if not exists idx_team_messages_seq    on team_messages(debate_id, seq);
create index if not exists idx_team_turns_open      on team_turns(debate_id) where ended_at is null;
create index if not exists idx_team_alerts_open     on team_alerts(debate_id) where acknowledged_at is null;
create index if not exists idx_team_scores_debate   on team_speech_scores(debate_id);

-- ── RLS: 전면 거부 (정책을 만들지 않는다) ─────────────────────────────────
alter table team_debates       enable row level security;
alter table team_members       enable row level security;
alter table team_turns         enable row level security;
alter table team_messages      enable row level security;
alter table team_speech_scores enable row level security;
alter table team_score_edits   enable row level security;
alter table team_penalties     enable row level security;
alter table team_alerts        enable row level security;
alter table team_reports       enable row level security;


-- ══════════════════════════════════════════════════════════════════════════
-- 규칙 도우미. 같은 규칙이 src/lib/team/rules.ts 에 순수 함수로도 있다.
-- 한쪽을 바꾸면 다른 쪽도 바꾸고 verify:team 을 돌릴 것.
-- ══════════════════════════════════════════════════════════════════════════

create or replace function team_is_floor(p_phase team_phase) returns boolean
language sql immutable as $$
  select p_phase in ('claim','rebuttal','counter','final')
$$;

-- 단계별 첫 차례 (V-R12): 주장 찬성, 반론 반대, 반론꺾기 찬성, 최종 반대
create or replace function team_first_side(p_phase team_phase) returns team_side
language sql immutable as $$
  select case p_phase
    when 'claim'    then 'pro'::team_side
    when 'rebuttal' then 'con'::team_side
    when 'counter'  then 'pro'::team_side
    when 'final'    then 'con'::team_side
    else null end
$$;

create or replace function team_phase_label(p_phase team_phase) returns text
language sql immutable as $$
  select case p_phase
    when 'waiting'  then '대기'
    when 'opening'  then '토론 시작'
    when 'claim'    then '주장'
    when 'rebuttal' then '반론'
    when 'counter'  then '반론꺾기'
    when 'final'    then '최종토론'
    when 'ended'    then '종료'
  end
$$;

-- 최종토론에서 팀당 발언 상한 (V-R12)
create or replace function team_final_cap() returns int language sql immutable as $$ select 2 $$;

-- 다음 차례 편. 보통은 상대 팀. 최종토론에서 상대가 상한을 채웠으면 같은 팀,
-- 둘 다 채웠으면 null (토론방 잠김).
create or replace function team_next_side(p_debate_id uuid, p_phase team_phase, p_prev team_side)
returns team_side
language plpgsql stable as $fn$
declare
  v_first  team_side;
  v_second team_side;
  v_n      int;
begin
  if p_prev is null then
    v_first := team_first_side(p_phase);
  else
    v_first := case when p_prev = 'pro' then 'con'::team_side else 'pro'::team_side end;
  end if;
  v_second := case when v_first = 'pro' then 'con'::team_side else 'pro'::team_side end;

  if p_phase <> 'final' then return v_first; end if;

  select count(*) into v_n from team_messages
   where debate_id = p_debate_id and phase = 'final' and kind = 'speech' and side = v_first;
  if v_n < team_final_cap() then return v_first; end if;

  select count(*) into v_n from team_messages
   where debate_id = p_debate_id and phase = 'final' and kind = 'speech' and side = v_second;
  if v_n < team_final_cap() then return v_second; end if;

  return null;
end;
$fn$;

-- 메시지 번호를 할당하고 넣는다. team_debates 행을 갱신하므로 번호가 겹치지 않는다.
create or replace function team_append(
  p_debate_id uuid, p_channel text, p_kind team_message_kind, p_phase team_phase,
  p_turn_id uuid, p_member_id uuid, p_side team_side, p_content text
) returns team_messages
language plpgsql as $fn$
declare
  v_seq bigint;
  v_row team_messages;
begin
  update team_debates set next_seq = next_seq + 1 where id = p_debate_id returning next_seq into v_seq;
  if v_seq is null then raise exception 'team debate % not found', p_debate_id; end if;
  insert into team_messages (debate_id, seq, channel, kind, phase, side, turn_id, member_id, content)
  values (p_debate_id, v_seq, p_channel, p_kind, p_phase, p_side, p_turn_id, p_member_id, p_content)
  returning * into v_row;
  return v_row;
end;
$fn$;

create or replace function team_open_turn(
  p_debate_id uuid, p_phase team_phase, p_side team_side, p_start timestamptz, p_turn_seconds int
) returns uuid
language plpgsql as $fn$
declare
  v_idx int;
  v_id  uuid;
begin
  select coalesce(max(idx), -1) + 1 into v_idx
    from team_turns where debate_id = p_debate_id and phase = p_phase;
  insert into team_turns (debate_id, phase, idx, side, started_at, deadline_at)
  values (p_debate_id, p_phase, v_idx, p_side, p_start, p_start + make_interval(secs => p_turn_seconds))
  returning id into v_id;
  return v_id;
end;
$fn$;

-- 차례가 p_at 에 끝난 뒤 다음 차례를 연다. 단계 시간이 이미 끝났으면 열지 않는다.
create or replace function team_after_turn(p_debate_id uuid, p_prev_side team_side, p_at timestamptz)
returns void
language plpgsql as $fn$
declare
  d      team_debates;
  v_side team_side;
begin
  select * into d from team_debates where id = p_debate_id;
  if d.phase_deadline_at is null or p_at >= d.phase_deadline_at then return; end if;
  v_side := team_next_side(p_debate_id, d.phase, p_prev_side);
  if v_side is null then return; end if;
  perform team_open_turn(p_debate_id, d.phase, v_side, p_at, d.turn_seconds);
end;
$fn$;

-- 같은 팀이 자기 차례 두 번을 연속 패스하면 -1 (V-R23).
-- 연속 횟수가 정확히 2가 되는 순간에만 감점한다. 3번째는 새 감점이 없다.
-- 단계 시간 종료로 끊긴 차례(phase_end)는 세지 않는다.
create or replace function team_check_pass_penalty(p_turn_id uuid)
returns void
language plpgsql as $fn$
declare
  t         team_turns;
  v_results text[];
  v_name    text;
begin
  select * into t from team_turns where id = p_turn_id;
  select array_agg(result order by started_at desc, idx desc) into v_results
    from (
      select result, started_at, idx from team_turns
       where debate_id = t.debate_id and side = t.side and result in ('speech','pass')
       order by started_at desc, idx desc
       limit 3
    ) x;

  if v_results[1] = 'pass' and v_results[2] = 'pass'
     and (coalesce(array_length(v_results, 1), 0) < 3 or v_results[3] <> 'pass') then
    insert into team_penalties (debate_id, side, phase, points, reason, turn_id)
    values (t.debate_id, t.side, t.phase, -1, '연속 2회 패스', t.id)
    on conflict (turn_id) do nothing;

    if found then
      select case when t.side = 'pro' then pro_name else con_name end into v_name
        from team_debates where id = t.debate_id;
      insert into team_alerts (debate_id, kind, side, detail)
      values (t.debate_id, 'consecutive_pass', t.side, v_name || '이 두 번 연속 패스했어요 (-1점)');
    end if;
  end if;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 시간 판정 (V-R19, V-R21). 반드시 team_debates 행 잠금 안에서 처리한다.
-- 오래 아무도 폴링하지 않았으면 밀린 차례를 마감 시각 기준으로 이어 붙이며 정리한다.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_tick(p_debate_id uuid)
returns void
language plpgsql as $fn$
declare
  d       team_debates;
  t       team_turns;
  v_guard int := 0;
  v_name  text;
begin
  select * into d from team_debates where id = p_debate_id for update;
  if not found or d.status <> 'open' or d.paused_at is not null or not team_is_floor(d.phase) then
    return;
  end if;

  loop
    v_guard := v_guard + 1;
    exit when v_guard > 500;

    select * into t from team_turns
     where debate_id = p_debate_id and ended_at is null
     order by started_at desc limit 1;
    exit when not found;

    if d.phase_deadline_at <= now() and d.phase_deadline_at <= t.deadline_at then
      -- 단계 시간이 먼저 끝났다. 패스가 아니다.
      update team_turns
         set ended_at = d.phase_deadline_at, result = 'phase_end', lock_member_id = null
       where id = t.id;
      exit;
    elsif t.deadline_at <= now() then
      update team_turns
         set ended_at = t.deadline_at, result = 'pass', lock_member_id = null
       where id = t.id;
      v_name := case when t.side = 'pro' then d.pro_name else d.con_name end;
      perform team_append(p_debate_id, 'floor', 'pass', d.phase, t.id, null, t.side, v_name || ' 패스');
      perform team_check_pass_penalty(t.id);
      -- 다음 차례는 now() 가 아니라 마감 시각에서 시작한다. 그래야 시간이 새지 않는다.
      perform team_after_turn(p_debate_id, t.side, t.deadline_at);
    else
      exit;
    end if;
  end loop;
end;
$fn$;

-- 잠금 없이 "판정이 필요한가" 만 본다. 폴링이 매번 행 잠금을 잡지 않게 한다.
create or replace function team_tick_due(p_debate_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1
      from team_debates d
      join team_turns t on t.debate_id = d.id and t.ended_at is null
     where d.id = p_debate_id
       and d.status = 'open'
       and d.paused_at is null
       and (t.deadline_at <= now() or d.phase_deadline_at <= now())
  )
$$;

-- 단계에 들어간다. 열린 차례는 phase_end 로 닫는다.
create or replace function team_enter_phase(p_debate_id uuid, p_phase team_phase)
returns void
language plpgsql as $fn$
declare
  d      team_debates;
  v_secs int;
begin
  update team_turns
     set ended_at = now(), result = 'phase_end', lock_member_id = null
   where debate_id = p_debate_id and ended_at is null;

  select * into d from team_debates where id = p_debate_id;
  v_secs := coalesce((d.stage_seconds ->> p_phase::text)::int, 300);

  update team_debates
     set phase = p_phase,
         paused_at = null,
         phase_started_at = now(),
         phase_deadline_at = now() + make_interval(secs => v_secs)
   where id = p_debate_id
  returning * into d;

  if team_is_floor(p_phase) then
    perform team_open_turn(p_debate_id, p_phase, team_first_side(p_phase), now(), d.turn_seconds);
  end if;

  perform team_append(p_debate_id, 'floor', 'system', p_phase, null, null, null,
                      team_phase_label(p_phase) || ' 단계가 시작됐어요');
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 입장 열기 (V-R4). 1:1 세션과 팀 토론을 합쳐 "한 번에 하나만" 검사한다.
-- ══════════════════════════════════════════════════════════════════════════
create or replace function open_team_debate_atomic(p_debate_id uuid)
returns table (result text, conflict_topic text)
language plpgsql as $fn$
declare
  v_class_id uuid;
  v_status   session_status;
  v_single   boolean;
  v_topic    text;
  v_updated  int;
begin
  select td.class_id, td.status into v_class_id, v_status
    from team_debates td where td.id = p_debate_id;

  if v_class_id is null then
    return query select 'not_found'::text, null::text; return;
  end if;
  if v_status <> 'draft' then
    return query select 'not_draft'::text, null::text; return;
  end if;

  -- 같은 학급의 동시 요청을 직렬화한다 (1:1 과 같은 잠금)
  select c.single_active_session into v_single from classes c where c.id = v_class_id for update;

  if v_single then
    select ds.topic into v_topic from debate_sessions ds
     where ds.class_id = v_class_id and ds.status = 'open' limit 1;
    if v_topic is null then
      select td.topic into v_topic from team_debates td
       where td.class_id = v_class_id and td.status = 'open' and td.id <> p_debate_id limit 1;
    end if;
    if v_topic is not null then
      return query select 'conflict'::text, v_topic; return;
    end if;
  end if;

  update team_debates
     set status = 'open', phase = 'waiting', opened_at = now()
   where id = p_debate_id and status = 'draft';

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return query select 'not_draft'::text, null::text; return;
  end if;

  return query select 'opened'::text, null::text;
end;
$fn$;

-- 1:1 세션 열기도 열린 팀 토론을 본다 (V-R4 반대 방향).
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

    if v_open_id is null then
      select td.id, td.topic into v_open_id, v_topic
      from team_debates td
      where td.class_id = v_class_id and td.status = 'open'
      limit 1;
    end if;

    if v_open_id is not null then
      return query select 'conflict'::text, v_topic; return;
    end if;
  end if;

  update debate_sessions
     set status = 'open', opened_at = now()
   where id = p_session_id and status = 'draft';

  -- 같은 세션에 동시 호출이 들어오면 두 번째 UPDATE 는 0행이다.
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return query select 'not_draft'::text, null::text; return;
  end if;

  return query select 'opened'::text, null::text;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 교사 제어 (V-R10~V-R14)
-- 반환: 'ok' | 'invalid' | 'not_found'
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_control(p_debate_id uuid, p_action text)
returns text
language plpgsql as $fn$
declare
  d       team_debates;
  v_next  team_phase;
  v_delta interval;
  v_last  team_turns;
  v_side  team_side;
  v_start timestamptz;
begin
  select * into d from team_debates where id = p_debate_id for update;
  if not found then return 'not_found'; end if;
  if d.status <> 'open' then return 'invalid'; end if;

  -- 전이 직전까지 밀린 패스를 먼저 기록한다
  perform team_tick(p_debate_id);
  select * into d from team_debates where id = p_debate_id;

  if p_action = 'start' then
    if d.phase <> 'waiting' then return 'invalid'; end if;
    perform team_enter_phase(p_debate_id, 'opening');
    return 'ok';

  elsif p_action = 'next' then
    v_next := case d.phase
      when 'opening'  then 'claim'::team_phase
      when 'claim'    then 'rebuttal'::team_phase
      when 'rebuttal' then 'counter'::team_phase
      when 'counter'  then 'final'::team_phase
      else null end;
    if v_next is null then return 'invalid'; end if;
    perform team_enter_phase(p_debate_id, v_next);
    return 'ok';

  elsif p_action = 'pause' then
    if d.phase in ('waiting','ended') or d.paused_at is not null then return 'invalid'; end if;
    update team_debates set paused_at = now() where id = p_debate_id;
    return 'ok';

  elsif p_action = 'resume' then
    if d.paused_at is null then return 'invalid'; end if;
    -- 멈춘 시간만큼 모든 마감을 민다. 남은 시간이 그대로 이어진다 (V-R13).
    v_delta := now() - d.paused_at;
    update team_debates
       set paused_at = null, phase_deadline_at = phase_deadline_at + v_delta
     where id = p_debate_id;
    update team_turns
       set deadline_at = deadline_at + v_delta,
           started_at = started_at + v_delta,
           lock_expires_at = lock_expires_at + v_delta
     where debate_id = p_debate_id and ended_at is null;
    return 'ok';

  elsif p_action = 'extend' then
    if d.phase in ('waiting','ended') then return 'invalid'; end if;
    v_start := coalesce(d.paused_at, now());
    update team_debates
       set phase_deadline_at = greatest(phase_deadline_at, v_start) + interval '60 seconds'
     where id = p_debate_id
    returning * into d;

    -- 시간이 끝나 잠긴 토론방을 다시 연다 (V-R14).
    -- 시간 종료로 끊긴 팀이 있으면 그 팀에게 차례를 돌려준다.
    if team_is_floor(d.phase)
       and not exists (select 1 from team_turns where debate_id = p_debate_id and ended_at is null) then
      select * into v_last from team_turns
       where debate_id = p_debate_id and phase = d.phase
       order by idx desc limit 1;
      if found and v_last.result = 'phase_end' then
        v_side := team_next_side(p_debate_id, d.phase,
                    case when v_last.side = 'pro' then 'con'::team_side else 'pro'::team_side end);
      elsif found then
        v_side := team_next_side(p_debate_id, d.phase, v_last.side);
      else
        v_side := team_next_side(p_debate_id, d.phase, null);
      end if;
      if v_side is not null then
        perform team_open_turn(p_debate_id, d.phase, v_side, v_start, d.turn_seconds);
      end if;
    end if;
    return 'ok';

  elsif p_action = 'end' then
    update team_turns
       set ended_at = now(), result = 'phase_end', lock_member_id = null
     where debate_id = p_debate_id and ended_at is null;
    update team_debates
       set phase = 'ended', status = 'closed', closed_at = now(), paused_at = null,
           phase_started_at = now(), phase_deadline_at = null
     where id = p_debate_id;
    perform team_append(p_debate_id, 'floor', 'system', 'ended', null, null, null, '토론이 끝났어요');
    return 'ok';
  end if;

  return 'invalid';
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 팀 배정 저장 (V-R3). draft 또는 open+waiting 에서만.
-- 가명은 편별로 배정 순서대로 다시 매긴다.
-- p_members: [{"studentId": uuid, "side": "pro"|"con"}]
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_set_members(p_debate_id uuid, p_members jsonb)
returns text
language plpgsql as $fn$
declare
  d team_debates;
begin
  select * into d from team_debates where id = p_debate_id for update;
  if not found then return 'not_found'; end if;
  if not (d.status = 'draft' or (d.status = 'open' and d.phase = 'waiting')) then
    return 'invalid';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_members) as x("studentId" uuid, side team_side)
      left join students s on s.id = x."studentId" and s.class_id = d.class_id and s.is_active
     where s.id is null or x.side is null
  ) then
    return 'invalid_student';
  end if;

  delete from team_members
   where debate_id = p_debate_id
     and student_id not in (
       select x."studentId" from jsonb_to_recordset(p_members) as x("studentId" uuid, side team_side)
     );

  insert into team_members (debate_id, student_id, side, alias)
  select p_debate_id, x."studentId", x.side, gen_random_uuid()::text
    from jsonb_to_recordset(p_members) as x("studentId" uuid, side team_side)
  on conflict (debate_id, student_id) do update set side = excluded.side;

  -- 가명 다시 매기기. unique 충돌을 피하려고 두 단계로 한다.
  update team_members set alias = id::text where debate_id = p_debate_id;
  update team_members m
     set alias = (case when x.side = 'pro' then '찬성팀 학생' else '반대팀 학생' end) || x.rn
    from (
      select id, side, row_number() over (partition by side order by created_at, id) as rn
        from team_members where debate_id = p_debate_id
    ) x
   where m.id = x.id;

  return 'ok';
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 학생 식별. 학급·활성 학생·기기를 한 번에 확인한다 (V-R6, V-R9).
-- 반환 code: 'ok' | 'not_found' | 'replaced' | 'not_entered'
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_resolve_member(
  p_debate_id uuid, p_class_id uuid, p_student_id uuid, p_device uuid
) returns table (member_id uuid, code text)
language plpgsql stable as $fn$
declare
  d team_debates;
  m team_members;
begin
  select * into d from team_debates where id = p_debate_id;
  if not found or d.class_id <> p_class_id or d.archived_at is not null or d.status = 'draft' then
    return query select null::uuid, 'not_found'::text; return;
  end if;

  select tm.* into m
    from team_members tm
    join students s on s.id = tm.student_id and s.is_active
   where tm.debate_id = p_debate_id and tm.student_id = p_student_id;
  if not found then
    return query select null::uuid, 'not_found'::text; return;
  end if;

  if m.device_id is null then
    return query select m.id, 'not_entered'::text; return;
  end if;
  if p_device is null or m.device_id <> p_device then
    return query select m.id, 'replaced'::text; return;
  end if;
  return query select m.id, 'ok'::text;
end;
$fn$;

-- 학생이 팀 토론에 들어온다. 새 기기가 이긴다 (V-R9).
-- 앞 기기가 최근 30초 안에 활동 중이었으면 교사에게 "중복 접속" 알림을 남긴다.
create or replace function team_enter(
  p_debate_id uuid, p_class_id uuid, p_student_id uuid, p_device uuid
) returns text
language plpgsql as $fn$
declare
  d      team_debates;
  m      team_members;
  v_name text;
begin
  select * into d from team_debates where id = p_debate_id;
  if not found or d.class_id <> p_class_id or d.archived_at is not null or d.status = 'draft' then
    return 'not_found';
  end if;

  select tm.* into m
    from team_members tm
    join students s on s.id = tm.student_id and s.is_active
   where tm.debate_id = p_debate_id and tm.student_id = p_student_id
   for update of tm;
  if not found then return 'not_found'; end if;

  if m.device_id is not null and m.device_id <> p_device
     and m.last_seen_at is not null and m.last_seen_at > now() - interval '30 seconds' then
    select display_name into v_name from students where id = m.student_id;
    insert into team_alerts (debate_id, kind, member_id, side, detail)
    values (p_debate_id, 'duplicate_login', m.id, m.side, v_name || ' 학생이 다른 기기에서 다시 들어왔어요');
  end if;

  update team_members set device_id = p_device, last_seen_at = now() where id = m.id;
  return 'ok';
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 발언 잠금 (V-R24, V-R27)
-- 반환 result: ok | not_your_turn | locked | balance_wait | paused | closed | not_found | replaced | not_entered
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_claim(
  p_debate_id uuid, p_class_id uuid, p_student_id uuid, p_device uuid
) returns table (result text, holder text)
language plpgsql as $fn$
declare
  r      record;
  d      team_debates;
  m      team_members;
  t      team_turns;
  v_name text;
begin
  select * into r from team_resolve_member(p_debate_id, p_class_id, p_student_id, p_device);
  if r.code <> 'ok' then return query select r.code, null::text; return; end if;

  select * into d from team_debates where id = p_debate_id for update;
  if d.status <> 'open' or not team_is_floor(d.phase) then
    return query select 'closed'::text, null::text; return;
  end if;
  perform team_tick(p_debate_id);
  select * into d from team_debates where id = p_debate_id;
  if d.paused_at is not null then return query select 'paused'::text, null::text; return; end if;

  select * into t from team_turns where debate_id = p_debate_id and ended_at is null
   order by started_at desc limit 1;
  if not found then return query select 'closed'::text, null::text; return; end if;

  select * into m from team_members where id = r.member_id;
  if t.side <> m.side then return query select 'not_your_turn'::text, null::text; return; end if;

  if t.lock_member_id is not null and t.lock_member_id <> m.id and t.lock_expires_at > now() then
    select s.display_name into v_name
      from team_members tm join students s on s.id = tm.student_id where tm.id = t.lock_member_id;
    return query select 'locked'::text, v_name; return;
  end if;

  -- 새로 잠금을 얻을 때만 "발언자 고르게" 를 본다 (연장은 막지 않는다)
  if t.lock_member_id is distinct from m.id
     and d.speaker_balance
     and m.speech_count >= 2
     and now() < t.started_at + interval '15 seconds'
     and exists (
       select 1 from team_members o
        where o.debate_id = p_debate_id and o.side = m.side and o.id <> m.id
          and o.speech_count < 2
          and o.last_seen_at > now() - interval '10 seconds'
     ) then
    return query select 'balance_wait'::text, null::text; return;
  end if;

  update team_turns
     set lock_member_id = m.id, lock_expires_at = now() + interval '20 seconds'
   where id = t.id;
  return query select 'ok'::text, null::text;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 전체 토론방 발언 (V-R20, V-R25). 검사와 저장, 차례 넘김이 한 트랜잭션이다.
-- 반환 result: ok | not_your_turn | locked | no_lock | paused | closed | invalid | not_found | replaced | not_entered
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_speak(
  p_debate_id uuid, p_class_id uuid, p_student_id uuid, p_device uuid, p_content text
) returns table (result text, message_id uuid, seq bigint)
language plpgsql as $fn$
declare
  r     record;
  d     team_debates;
  m     team_members;
  t     team_turns;
  v_msg team_messages;
begin
  select * into r from team_resolve_member(p_debate_id, p_class_id, p_student_id, p_device);
  if r.code <> 'ok' then return query select r.code, null::uuid, null::bigint; return; end if;

  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 300 then
    return query select 'invalid'::text, null::uuid, null::bigint; return;
  end if;

  select * into d from team_debates where id = p_debate_id for update;
  if d.status <> 'open' or not team_is_floor(d.phase) then
    return query select 'closed'::text, null::uuid, null::bigint; return;
  end if;
  perform team_tick(p_debate_id);
  select * into d from team_debates where id = p_debate_id;
  if d.paused_at is not null then
    return query select 'paused'::text, null::uuid, null::bigint; return;
  end if;

  select * into t from team_turns where debate_id = p_debate_id and ended_at is null
   order by started_at desc limit 1;
  if not found then return query select 'closed'::text, null::uuid, null::bigint; return; end if;

  select * into m from team_members where id = r.member_id;
  if t.side <> m.side then
    return query select 'not_your_turn'::text, null::uuid, null::bigint; return;
  end if;
  if t.lock_member_id is distinct from m.id then
    if t.lock_member_id is not null and t.lock_expires_at > now() then
      return query select 'locked'::text, null::uuid, null::bigint; return;
    end if;
    return query select 'no_lock'::text, null::uuid, null::bigint; return;
  end if;

  v_msg := team_append(p_debate_id, 'floor', 'speech', d.phase, t.id, m.id, m.side, btrim(p_content));
  update team_members set speech_count = speech_count + 1 where id = m.id;
  update team_turns set ended_at = now(), result = 'speech', lock_member_id = null where id = t.id;
  perform team_after_turn(p_debate_id, t.side, now());

  return query select 'ok'::text, v_msg.id, v_msg.seq;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 팀 채팅 (V-R28). 자기 팀 채널에만 쓴다 (V-R8).
-- p_draft = true 면 "못 보낸 발언" (V-R26). 종료 직후에도 저장할 수 있다.
-- 반환 result: ok | read_only | invalid | not_found | replaced | not_entered
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_chat(
  p_debate_id uuid, p_class_id uuid, p_student_id uuid, p_device uuid, p_content text, p_draft boolean
) returns table (result text, message_id uuid)
language plpgsql as $fn$
declare
  r     record;
  d     team_debates;
  m     team_members;
  v_msg team_messages;
begin
  select * into r from team_resolve_member(p_debate_id, p_class_id, p_student_id, p_device);
  if r.code <> 'ok' then return query select r.code, null::uuid; return; end if;

  if p_content is null or char_length(btrim(p_content)) = 0 or char_length(p_content) > 300 then
    return query select 'invalid'::text, null::uuid; return;
  end if;

  select * into d from team_debates where id = p_debate_id;
  if d.phase = 'waiting' then return query select 'read_only'::text, null::uuid; return; end if;
  if not p_draft and (d.status <> 'open' or d.phase not in ('opening','claim','rebuttal','counter','final')) then
    return query select 'read_only'::text, null::uuid; return;
  end if;

  select * into m from team_members where id = r.member_id;
  v_msg := team_append(p_debate_id, m.side::text,
                       case when p_draft then 'draft'::team_message_kind else 'chat'::team_message_kind end,
                       d.phase, null, m.id, m.side, btrim(p_content));
  return query select 'ok'::text, v_msg.id;
end;
$fn$;

-- ══════════════════════════════════════════════════════════════════════════
-- 폴링 (V-R49). tick + 접속 갱신 + 스냅샷을 **RPC 한 번**에 끝낸다.
--
-- p_viewer:
--   {"role":"teacher","teacherId":uuid}
--   {"role":"student","classId":uuid,"studentId":uuid,"deviceId":uuid}
--
-- 학생에게는 자기 팀 채널만 준다 (V-R8). 상대 팀 채팅은 SQL 에서 거른다.
-- 공개 방식이 after_end 이고 결과를 공개하지 않았으면 점수를 빼고 준다 (V-R34).
-- ══════════════════════════════════════════════════════════════════════════
create or replace function team_poll(p_debate_id uuid, p_viewer jsonb, p_since bigint)
returns jsonb
language plpgsql as $fn$
declare
  d           team_debates;
  v_teacher   boolean := false;
  v_member    team_members;
  v_side      text := null;
  v_show      boolean;
  v_turn      team_turns;
  v_has_turn  boolean;
  v_ref       timestamptz;
  v_floor     text;
  v_phase_ms  bigint;
  v_owner     uuid;
  v_since     bigint := coalesce(p_since, 0);
begin
  select * into d from team_debates where id = p_debate_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  if p_viewer ->> 'role' = 'teacher' then
    select teacher_id into v_owner from classes where id = d.class_id;
    if v_owner is distinct from (p_viewer ->> 'teacherId')::uuid then
      return jsonb_build_object('error', 'not_found');
    end if;
    v_teacher := true;
  else
    if d.class_id <> (p_viewer ->> 'classId')::uuid or d.archived_at is not null or d.status = 'draft' then
      return jsonb_build_object('error', 'not_found');
    end if;
    select tm.* into v_member
      from team_members tm
      join students s on s.id = tm.student_id and s.is_active
     where tm.debate_id = p_debate_id and tm.student_id = (p_viewer ->> 'studentId')::uuid;
    if not found then return jsonb_build_object('error', 'not_found'); end if;
    if v_member.device_id is null then return jsonb_build_object('error', 'not_entered'); end if;
    if v_member.device_id is distinct from nullif(p_viewer ->> 'deviceId', '')::uuid then
      return jsonb_build_object('error', 'replaced');
    end if;
    v_side := v_member.side::text;
    update team_members set last_seen_at = now() where id = v_member.id;
  end if;

  if team_tick_due(p_debate_id) then
    perform team_tick(p_debate_id);
    select * into d from team_debates where id = p_debate_id;
  end if;

  v_show := v_teacher or d.score_visibility = 'live' or d.results_published_at is not null;
  v_ref := coalesce(d.paused_at, now());

  select * into v_turn from team_turns
   where debate_id = p_debate_id and ended_at is null
   order by started_at desc limit 1;
  v_has_turn := found;

  v_phase_ms := case when d.phase_deadline_at is null then null
                     else greatest(0, (extract(epoch from (d.phase_deadline_at - v_ref)) * 1000)::bigint) end;

  v_floor := case
    when d.status <> 'open' or d.phase in ('waiting','ended') then 'closed'
    when d.phase = 'opening' then 'team_only'
    when d.paused_at is not null then 'paused'
    when v_has_turn then 'open'
    when v_phase_ms = 0 then 'time_up'
    else 'final_done'
  end;

  return jsonb_build_object(
    'serverNow', now(),
    'debate', jsonb_build_object(
      'id', d.id, 'topic', d.topic, 'description', d.description, 'gradeLevel', d.grade_level,
      'status', d.status, 'phase', d.phase, 'proName', d.pro_name, 'conName', d.con_name,
      'turnSeconds', d.turn_seconds, 'stageSeconds', d.stage_seconds,
      'scoreVisibility', d.score_visibility, 'speakerBalance', d.speaker_balance,
      'paused', d.paused_at is not null, 'phaseRemainingMs', v_phase_ms,
      'resultsPublished', d.results_published_at is not null, 'classId', d.class_id
    ),
    'floorState', v_floor,
    'turn', case when not v_has_turn then null else jsonb_build_object(
      'id', v_turn.id, 'side', v_turn.side, 'idx', v_turn.idx,
      'remainingMs', greatest(0, (extract(epoch from (v_turn.deadline_at - v_ref)) * 1000)::bigint),
      'elapsedMs', greatest(0, (extract(epoch from (v_ref - v_turn.started_at)) * 1000)::bigint),
      'lockMemberId', case when v_turn.lock_expires_at > v_ref then v_turn.lock_member_id end,
      'lockName', case when v_turn.lock_expires_at > v_ref and (v_teacher or v_side = v_turn.side::text) then (
          select s.display_name from team_members tm join students s on s.id = tm.student_id
           where tm.id = v_turn.lock_member_id) end
    ) end,
    'finalSpeeches', jsonb_build_object(
      'pro', (select count(*) from team_messages where debate_id = p_debate_id and phase = 'final' and kind = 'speech' and side = 'pro'),
      'con', (select count(*) from team_messages where debate_id = p_debate_id and phase = 'final' and kind = 'speech' and side = 'con')
    ),
    'announcement', (
      select jsonb_build_object('seq', m.seq, 'content', m.content, 'createdAt', m.created_at)
        from team_messages m
       where m.debate_id = p_debate_id and m.kind = 'announcement'
       order by m.seq desc limit 1
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'seq', m.seq, 'channel', m.channel, 'kind', m.kind, 'phase', m.phase,
          'side', m.side, 'memberId', m.member_id, 'author', s.display_name,
          'content', case when m.hidden_at is not null and not v_teacher then null else m.content end,
          'hidden', m.hidden_at is not null, 'createdAt', m.created_at
        ) order by m.seq)
        from team_messages m
        left join team_members tm on tm.id = m.member_id
        left join students s on s.id = tm.student_id
       where m.debate_id = p_debate_id and m.seq > v_since
         and (v_teacher or m.channel = 'floor' or m.channel = v_side)
    ), '[]'::jsonb),
    -- 가린 발언 번호 전체. 이미 받은 메시지를 클라이언트가 가리게 한다.
    'hiddenSeqs', coalesce((
      select jsonb_agg(m.seq order by m.seq) from team_messages m
       where m.debate_id = p_debate_id and m.hidden_at is not null
    ), '[]'::jsonb),
    'scores', case when not v_show then null else coalesce((
      select jsonb_agg(
          jsonb_build_object('seq', m.seq, 'status', sc.status, 'total', sc.total)
          || case when v_teacher then jsonb_build_object(
               'scoreId', sc.id, 'logic', sc.logic, 'evidence', sc.evidence, 'response', sc.response,
               'phaseFit', sc.phase_fit, 'attitude', sc.attitude, 'reason', sc.reason,
               'respondedToSeq', sc.responded_to_seq, 'edited', sc.edited_at is not null)
             else '{}'::jsonb end
          order by m.seq)
        from team_messages m join team_speech_scores sc on sc.message_id = m.id
       where m.debate_id = p_debate_id
    ), '[]'::jsonb) end,
    'totals', case when not v_show then null else (
      with sp as (
        select m.side, m.phase,
               case when sc.status = 'done' then coalesce(sc.total, 0) else 0 end as pts,
               (sc.id is null or sc.status = 'pending') as is_pending,
               (sc.status = 'failed') as is_failed
          from team_messages m
          left join team_speech_scores sc on sc.message_id = m.id
         where m.debate_id = p_debate_id and m.kind = 'speech' and m.hidden_at is null
      ),
      allp as (
        select side, phase, pts from sp
        union all
        select side, phase, points from team_penalties where debate_id = p_debate_id
      )
      select jsonb_build_object(
        'pro', (select coalesce(sum(pts), 0) from allp where side = 'pro'),
        'con', (select coalesce(sum(pts), 0) from allp where side = 'con'),
        'byStage', coalesce((
          select jsonb_object_agg(ph, jsonb_build_object('pro', p, 'con', c)) from (
            select phase::text as ph,
                   coalesce(sum(pts) filter (where side = 'pro'), 0) as p,
                   coalesce(sum(pts) filter (where side = 'con'), 0) as c
              from allp group by phase
          ) z
        ), '{}'::jsonb),
        'pendingCount', (select count(*) from sp where is_pending),
        'failedCount', (select count(*) from sp where is_failed)
      )
    ) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', tm.id, 'name', s.display_name, 'side', tm.side, 'speechCount', tm.speech_count,
          'online', tm.last_seen_at is not null and tm.last_seen_at > now() - interval '10 seconds'
        ) order by tm.side, s.display_name)
        from team_members tm join students s on s.id = tm.student_id
       where tm.debate_id = p_debate_id and (v_teacher or tm.side::text = v_side)
    ), '[]'::jsonb),
    'me', case when v_teacher then null else jsonb_build_object(
      'memberId', v_member.id, 'side', v_member.side, 'speechCount', v_member.speech_count,
      'name', (select display_name from students where id = v_member.student_id)
    ) end,
    'alerts', case when not v_teacher then null else coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'kind', a.kind, 'side', a.side, 'detail', a.detail, 'createdAt', a.created_at,
          'name', s.display_name, 'excerpt', left(m.content, 60), 'channel', m.channel, 'seq', m.seq
        ) order by a.created_at desc)
        from team_alerts a
        left join team_members tm on tm.id = a.member_id
        left join students s on s.id = tm.student_id
        left join team_messages m on m.id = a.message_id
       where a.debate_id = p_debate_id and a.acknowledged_at is null
    ), '[]'::jsonb) end,
    'penalties', case when not v_teacher then null else coalesce((
      select jsonb_agg(jsonb_build_object('side', side, 'phase', phase, 'points', points, 'reason', reason)
                       order by created_at)
        from team_penalties where debate_id = p_debate_id
    ), '[]'::jsonb) end,
    'report', case when not v_teacher then null else (
      select jsonb_build_object('status', r.status, 'winner', r.winner, 'error', r.error)
        from team_reports r where r.debate_id = p_debate_id
    ) end,
    'maxSeq', d.next_seq
  );
end;
$fn$;

commit;
