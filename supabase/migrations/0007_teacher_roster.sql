create table if not exists teacher_roster (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references teachers(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  created_at timestamptz not null default now(),
  unique (teacher_id, display_name)
);

-- 기존 학급 명단도 교사 공통 명단으로 옮긴다.
insert into teacher_roster (teacher_id, display_name)
select distinct c.teacher_id, s.display_name
from students s join classes c on c.id = s.class_id
where s.is_active = true
on conflict (teacher_id, display_name) do nothing;

insert into students (class_id, display_name)
select c.id, r.display_name
from classes c join teacher_roster r on r.teacher_id = c.teacher_id
where c.archived_at is null
on conflict (class_id, display_name) do nothing;
