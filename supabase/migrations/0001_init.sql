-- debate-classroom 초기 스키마 (PRD R1~R57)
-- 적용:  npm run db:migrate   (또는 Supabase SQL Editor 에 그대로 붙여넣기)

begin;

-- ── 열거형 ────────────────────────────────────────────────────────────────
do $$ begin create type session_status as enum ('draft','open','closed'); exception when duplicate_object then null; end $$;
do $$ begin create type stance as enum ('pro','con'); exception when duplicate_object then null; end $$;
do $$ begin create type message_role as enum ('student','bot'); exception when duplicate_object then null; end $$;
do $$ begin create type triage_verdict as enum ('on_topic','off_topic','inappropriate'); exception when duplicate_object then null; end $$;
do $$ begin create type score_status as enum ('pending','done','failed','skipped'); exception when duplicate_object then null; end $$;

-- ── 교사 ──────────────────────────────────────────────────────────────────
create table if not exists teachers (
  id         uuid primary key,
  email      text not null unique,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Supabase 환경에서만 auth.users 로의 FK 를 건다 (로컬 Postgres 검증 시에는 건너뛴다).
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='auth' and table_name='users')
     and not exists (select 1 from pg_constraint where conname='teachers_id_fkey')
  then
    alter table teachers add constraint teachers_id_fkey
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ── 초대 코드 (R1, R2) ────────────────────────────────────────────────────
create table if not exists invite_codes (
  code       text primary key,
  note       text,
  max_uses   int  not null default 1 check (max_uses > 0),
  used_count int  not null default 0 check (used_count >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 학급 (R5, R8, R11, R40) ───────────────────────────────────────────────
create table if not exists classes (
  id                    uuid primary key default gen_random_uuid(),
  teacher_id            uuid not null references teachers(id) on delete cascade,
  name                  text not null,
  grade_level           int  not null default 4 check (grade_level between 3 and 6),
  join_code             char(6) not null unique,   -- 숫자 6자리 (R5)
  single_active_session boolean not null default true,
  created_at            timestamptz not null default now(),
  archived_at           timestamptz
);

-- ── 학생 명단 (R6, R7) ────────────────────────────────────────────────────
create table if not exists students (
  id           uuid primary key default gen_random_uuid(),
  class_id     uuid not null references classes(id) on delete cascade,
  display_name text not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (class_id, display_name)
);

-- ── 토론 세션 (R9, R10, R41) ──────────────────────────────────────────────
create table if not exists debate_sessions (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references classes(id) on delete cascade,
  topic         text not null check (char_length(topic) between 1 and 100),
  description   text check (char_length(description) <= 300),
  grade_level   int  not null check (grade_level between 3 and 6),
  status        session_status not null default 'draft',
  message_limit int  not null default 30 check (message_limit between 3 and 100),
  opened_at     timestamptz,
  closed_at     timestamptz,
  archived_at   timestamptz,                 -- 보관함 (완전 삭제 전 단계)
  created_at    timestamptz not null default now()
);

-- ── 참여 (R15, R16) ───────────────────────────────────────────────────────
create table if not exists participations (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references debate_sessions(id) on delete cascade,
  student_id            uuid not null references students(id) on delete cascade,
  stance                stance not null,
  student_message_count int not null default 0,
  joined_at             timestamptz not null default now(),
  last_activity_at      timestamptz,
  unique (session_id, student_id)
);

-- ── 메시지 ────────────────────────────────────────────────────────────────
create table if not exists messages (
  id               uuid primary key default gen_random_uuid(),
  participation_id uuid not null references participations(id) on delete cascade,
  seq              int  not null,
  role             message_role not null,
  content          text not null,
  created_at       timestamptz not null default now(),
  unique (participation_id, seq)
);

-- ── 이탈/부적절 판정 (R24~R27, R32) ───────────────────────────────────────
create table if not exists moderation_flags (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid not null unique references messages(id) on delete cascade,
  participation_id uuid not null references participations(id) on delete cascade,
  verdict          triage_verdict not null,
  reason           text,
  triage_failed    boolean not null default false,
  acknowledged_at  timestamptz,
  -- 학생에게 실시간으로 보여주는 길잡이 안내 (praise/need_reason/off_topic/none)
  coach_kind       text check (coach_kind is null or coach_kind in ('praise','need_reason','off_topic','none')),
  coach_message    text,
  created_at       timestamptz not null default now()
);

-- ── 채점 (R45~R57) ────────────────────────────────────────────────────────
-- 5영역 100점 + 주제 이탈 감점 (0 ~ -15). 최종 = 기본 + 감점.
create table if not exists debate_scores (
  id                  uuid primary key default gen_random_uuid(),
  participation_id    uuid not null unique references participations(id) on delete cascade,
  status              score_status not null default 'pending',
  score_claim         int check (score_claim between 0 and 15),          -- 주장 표현
  score_evidence      int check (score_evidence between 0 and 25),       -- 근거의 적절성과 구체성
  score_counter       int check (score_counter between 0 and 25),        -- 반론 이해와 대응
  score_development   int check (score_development between 0 and 25),    -- 생각의 발전과 조정
  score_participation int check (score_participation between 0 and 10),  -- 토론 참여와 답변 충실성
  off_topic_penalty   int check (off_topic_penalty between -15 and 0),
  base_total          int check (base_total between 0 and 100),
  total               int check (total between 0 and 100),
  reasons             jsonb,   -- 영역별 한 줄 평가
  strengths           jsonb,   -- 잘한 점
  next_step           text,    -- 더 발전시키면 좋은 점
  analysis            jsonb,   -- 토론 참여 분석 (근거 제시/반론 대응/단답식/주제 집중)
  change_summary      text,    -- 생각의 변화
  change_reason       text,
  model               text,
  attempts            int not null default 0,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── 전송 속도 제한 (R38) ──────────────────────────────────────────────────
create table if not exists rate_limits (
  key     text primary key,
  last_at timestamptz not null default now()
);

-- ── 인덱스 ────────────────────────────────────────────────────────────────
create index if not exists idx_classes_teacher        on classes(teacher_id);
create index if not exists idx_classes_join_code      on classes(join_code);
create index if not exists idx_students_class         on students(class_id);
create index if not exists idx_sessions_class         on debate_sessions(class_id);
create index if not exists idx_sessions_open          on debate_sessions(class_id) where status = 'open' and archived_at is null;
create index if not exists idx_participations_session on participations(session_id);
create index if not exists idx_messages_participation on messages(participation_id, seq);
create index if not exists idx_flags_participation    on moderation_flags(participation_id);
create index if not exists idx_flags_problem          on moderation_flags(participation_id) where verdict <> 'on_topic';
create index if not exists idx_scores_participation   on debate_scores(participation_id);

-- ── RLS: 전면 거부 (정책을 만들지 않는다) ─────────────────────────────────
-- 앱은 service role 키로만 접근한다. anon 키가 노출돼도 데이터가 읽히지 않는다.
alter table teachers         enable row level security;
alter table invite_codes     enable row level security;
alter table classes          enable row level security;
alter table students         enable row level security;
alter table debate_sessions  enable row level security;
alter table participations   enable row level security;
alter table messages         enable row level security;
alter table moderation_flags enable row level security;
alter table debate_scores    enable row level security;
alter table rate_limits      enable row level security;


-- ── 대시보드 스냅샷 (R29, R33, R54, R55) ──────────────────────────────────
-- 대시보드 폴링이 학생 수만큼 쿼리를 돌지 않도록 집계를 한 번에 끝낸다.
create or replace function dashboard_snapshot(p_session_id uuid)
returns jsonb
language sql
stable
as $fn$
with sess as (
  select ds.id, ds.class_id, ds.topic, ds.description, ds.grade_level,
         ds.status::text as status, ds.message_limit, ds.opened_at, ds.closed_at,
         c.name as class_name, c.teacher_id
  from debate_sessions ds
  join classes c on c.id = ds.class_id
  where ds.id = p_session_id
),
rows as (
  select
    st.id                                as student_id,
    st.display_name                      as display_name,
    p.id                                 as participation_id,
    p.stance::text                       as stance,
    coalesce(p.student_message_count, 0) as message_count,
    p.last_activity_at                   as last_activity_at,
    (select count(*) from moderation_flags f
      where f.participation_id = p.id and f.verdict = 'off_topic')            as off_topic_count,
    (select count(*) from moderation_flags f
      where f.participation_id = p.id and f.verdict = 'inappropriate')        as inappropriate_count,
    (select count(*) from moderation_flags f
      where f.participation_id = p.id and f.verdict = 'inappropriate'
        and f.acknowledged_at is null)                                        as unacked_count,
    sc.status::text                      as score_status,
    sc.total                             as score_total
  from sess
  join students st on st.class_id = sess.class_id and st.is_active
  left join participations p on p.session_id = sess.id and p.student_id = st.id
  left join debate_scores sc on sc.participation_id = p.id
)
select jsonb_build_object(
  'session',  (select to_jsonb(s) from sess s),
  'students', coalesce((select jsonb_agg(to_jsonb(r) order by r.display_name) from rows r), '[]'::jsonb),
  'alerts',   coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (
        select f.id as flag_id, st.display_name, f.reason, f.created_at,
               left(m.content, 60) as excerpt, p.id as participation_id
        from moderation_flags f
        join participations p on p.id = f.participation_id
        join students st      on st.id = p.student_id
        join messages m       on m.id = f.message_id
        where p.session_id = p_session_id
          and f.verdict = 'inappropriate'
          and f.acknowledged_at is null
      ) a
  ), '[]'::jsonb),
  'summary', (select jsonb_build_object(
      'totalStudents',   count(*),
      'joinedStudents',  count(participation_id),
      'proCount',        count(*) filter (where stance = 'pro'),
      'conCount',        count(*) filter (where stance = 'con'),
      'totalMessages',   coalesce(sum(message_count), 0),
      'offTopicTotal',   coalesce(sum(off_topic_count), 0),
      'inappropriateTotal', coalesce(sum(inappropriate_count), 0),
      'scoredCount',     count(*) filter (where score_status = 'done'),
      'averageTotal',    round(avg(score_total) filter (where score_status = 'done'), 1)
    ) from rows)
)
$fn$;

-- ── 토론 시작을 원자적으로 처리한다 (R11) ─────────────────────────────────
-- "한 번에 하나만 열기" 가 켜진 학급에서는, 학급 행을 잠근 뒤 열린 세션 수를 세고
-- 그 트랜잭션 안에서 상태를 바꾼다. 응용 코드의 조회-후-갱신 경합을 DB 에서 막는다.
-- 반환: ('opened' | 'conflict' | 'not_draft' | 'not_found', 충돌한 세션의 주제)
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

  -- 같은 세션에 동시 호출이 들어오면 두 번째 UPDATE 는 0행이다.
  -- 갱신 행 수를 확인하지 않으면 아무것도 안 바꾸고도 'opened' 를 돌려주게 된다.
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return query select 'not_draft'::text, null::text; return;
  end if;

  return query select 'opened'::text, null::text;
end;
$fn$;

commit;
