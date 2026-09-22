# Context Notes: 팀 대항 토론 모드 (ver2)

`implement` 가 같은 탐색을 반복하지 않도록 남기는 기반 노트. 2026-09-19 탐색 기준.
먼저 `CLAUDE.md` 를 읽을 것 — 1:1 모드의 "되돌리면 안 되는 것" 목록이 거기 있다.

## 출발점

- 원본 계획서 `.dev/debate-classroom/AI_토론_웹사이트_계획서.md` 는 **학생 대 학생 팀전 + AI 심판**이다.
  현재 구현(`.dev/debate-classroom/prd.md`, R1~R72)은 **학생 대 AI 1:1**이다. 두 모델이 다르므로
  ver2는 1:1을 바꾸지 않고 **새 모드를 옆에 붙인다.** 기존 1:1 PRD는 "학생 간 채팅, 그룹 토론, 팀전"과
  "교사가 AI 점수 수정"을 비목표로 두었다 — ver2가 이 둘을 새 모드 한정으로 범위에 넣는다.
- 저장소 상태: `main`, 깨끗함. 최근 커밋 `ec9c636`.

## 계획서 → 이 프로젝트로 바꾼 것 (결정 이력)

| 계획서 | ver2 | 이유 |
| --- | --- | --- |
| 토론마다 6자리 입장 코드 | 기존 학급 코드 재사용 | 코드가 둘이면 아이가 헷갈린다 |
| 이름 + 4자리 PIN | 이름 클릭 유지 + 중복 기기 알림 | 기존 결정(비밀번호 분실로 수업 정지 방지). PIN은 미확정으로 남김 |
| 웹소켓 서버 1대 | 1.5초 폴링 + `team_tick` 지연 판정 | Vercel 서버리스 구조, 기존 "폴링으로 충분" 결정, RLS 전면 거부와 Realtime 충돌 |
| Claude API | OpenAI 유지 | 기존 키·AI SDK·구조화 출력 패턴 재사용 |
| 채점 기준표 교사 편집 | 고정(코드 파일) + 발언별 점수 수정 | 배점 변경은 DB 제약·프롬프트·합산을 함께 흔든다 |
| 최근 20발언 + 이전 요약 | 이전 발언 전부 | 300자 × ~80개면 문맥에 들어감. 요약 호출 제거 |
| "참여 항목 감점"(연속 패스) | 서버가 -1 감점 기록 | 발언 기준표에 참여 항목이 없다. 결정적 규칙은 AI에 맡기지 않는다 |
| 팀 채팅 교사용 AI 요약 | 비목표 | 교사가 원문을 본다. 비용 절감 |
| CSV 업로드, 시간 템플릿 저장 | 비목표 | 기존 붙여넣기로 충분 / MVP 밖 |
| 금칙어 필터 | Moderation API | 기존에 쓰는 무료 판정 재사용 |
| 저학년 "종료 후 공개" 기본 | 3~4학년 `after_end`, 5~6학년 `live` | "저학년" 해석. 사용자 확인 여지 있음 |
| 단계 시간 끝나면? (모호) | 자동 진행 안 함, 교사가 "다음 단계로" | 교사 통제권 우선 |

## 재사용할 기존 코드

| 필요 | 기존 위치 | 메모 |
| --- | --- | --- |
| 서버 DB 클라이언트 | `src/lib/supabase/admin.ts` → `admin()` | 모든 `src/lib/db/*` 는 `import "server-only"` |
| 교사 인증 | `src/lib/session/teacher.ts` (`ts_token`) | 소유권 검사는 `src/lib/db/session-helpers.ts` 의 `getOwnedClass`/`getOwnedSession` 패턴. 남의 것은 **404** |
| 학생 인증 | `src/lib/session/student.ts` (`ss_token` = `{classId, studentId}`, 12h) | 바꾸지 말 것. 기기 식별은 별도 쿠키 `td_device` 로 |
| 학생 존재 확인 | `getStudentInClass` (`src/lib/db/students.ts`) | 비활성 학생 거르기 포함 |
| 열린 목록 | `listOpenSessions` (`src/lib/db/sessions.ts:107`), 호출처 `src/app/api/join/lookup/route.ts`, `src/lib/db/session-helpers.ts:50` | `archived_at is null` 필터 필수 |
| 뒤에서 끝나야 할 작업 | `runInBackground` (`src/lib/background.ts`, 내부 `after()`) | `void promise` 금지 |
| 채점 중복 방지 | `claimScoring` 의 23505 감지 (`src/lib/scoring-service.ts`) | 팀 채점·결과 생성도 같은 방식 |
| 판정 실패 계약 | `triageMessage` (`src/lib/ai/triage.ts`) — 예외를 삼키고 `failed:true` 반환, 8초 타임아웃 | `judgeSpeech` 도 같은 계약. Moderation 호출 코드(`checkModeration`)를 참고/추출 |
| 구조화 출력 | `generateObject` + zod (`src/lib/ai/scoring.ts`, `triage.ts`) | |
| 학년 프리셋 | `src/lib/grade-presets.ts` (`GRADE_PRESETS`, `sentenceRange`, `maxSentenceLength`, `vocabularyGuide`, `scoringExpectation`) | **복사 금지**. 필요한 필드는 같은 파일에 추가 |
| 프롬프트 구성 관례 | `src/lib/prompts/debate.ts` + `debate-guide.ts`, `scoring.ts` + `scoring-guide.ts` | 지침은 `*-guide.ts`, 빌더는 주입만. **분량 규칙 블록은 프롬프트 맨 끝** |
| 서버 합산 | `computeTotals` (`src/lib/prompts/scoring.ts`) | 모델에게 산술 맡기지 않기 |
| 속도 제한 | `takeMessageSlot` (`src/lib/db/rate-limit.ts`, `rate_limits` 테이블) | 팀 채팅은 키 접두어를 달리해서 재사용 가능 |
| 보관·삭제 | `src/app/api/archive/route.ts`, `archive-button.tsx`, `delete-button.tsx`, `teacher/(app)/archive/page.tsx` | `DELETE ?preview=1` 관례, `.not("archived_at","is",null)` |
| PDF | `src/lib/pdf/report.tsx` (`registerFonts`, `renderToBuffer`), `src/app/api/sessions/[sessionId]/export/route.ts` | 폰트 등록 함수를 공유할 것 |
| 교사 대시보드 폴링 | `src/app/teacher/(app)/sessions/[sessionId]/page.tsx:77` (3초 `setInterval`) | 관제실 UI 참고. 팀은 1.5초 |
| 학생 화면 폴링·디자인 | `src/app/debate/page.tsx:73` (5초), `kid-card`/`kid-badge`/`mascot-bubble` (`globals.css`) | 학생 팀 화면도 같은 디자인 언어 |
| 원자적 열기 | `open_session_atomic` (`0001_init.sql` 끝부분) — 학급 행 `for update` 후 검사·전이, `row_count` 확인 | 팀용 함수도 같은 모양. 기존 함수는 `create or replace` 로 팀 토론 검사 추가 |
| 대시보드 1회 왕복 | `dashboard_snapshot(uuid)` SQL 함수 | `team_poll` 도 RPC 1회로 |
| 환경 변수 | `src/lib/env.ts` (지연 평가 getter), `.env.example` | `judgeModel` 추가 |

## DB 사실

- 기존 타입: `session_status(draft/open/closed)`, `stance(pro/con)`, `score_status(pending/done/failed/skipped)`,
  `triage_verdict`, `message_role`. `session_status`·`score_status` 는 재사용 가능.
  `stance` 를 팀 편에 재사용할지 `team_side` 를 새로 만들지는 구현자가 정해도 된다 (PRD는 `team_side`).
- 마이그레이션 0001~0005 존재. 다음 번호는 **0006**. up 파일은 멱등이어야 한다
  (`create ... if not exists`, `do $$ ... exception when duplicate_object`, `create or replace function`).
- `scripts/migrate.ts`: up 은 `_down.` 없는 파일을 오름차순, down 은 `_down.` 파일을 **오름차순**으로
  돌린다 → `0001_down` 이 먼저 돌아 버린다. T2에서 내림차순으로 고친다. 그 전이라도 `0006_down` 은
  전부 `if exists` 로 쓴다.
- 학생 삭제(`removeOrDeactivateStudent`)는 참여 기록을 전부 본다. 팀 토론 참여(`team_members`,
  발언)가 있는 학생도 **삭제가 아니라 비활성** 대상이어야 한다 — 이 함수에 팀 참여 검사를 더할 것
  (V-R5, T8). FK 가 cascade 라 빠뜨리면 학생 삭제 한 번에 팀 토론 발언이 함께 사라진다.

## 구현 시 주의점

- **`team_tick` 은 반드시 `team_debates` 행 잠금 안에서.** 30명이 동시에 폴링해도 패스가 한 번만 기록되어야
  한다(V-AC16). 백스톱으로 `team_turns unique(debate_id, phase, idx)`. 오래 비어 있었으면 밀린 차례를
  반복해서 정리한다(마감 시각 기준으로 다음 차례 시작 시각을 이어 붙인다 — `now()` 로 붙이면 시간이 샌다).
- **일시정지 재개 시** `phase_deadline_at`, 열린 차례의 `deadline_at`, `lock_expires_at` 을 멈춘 시간만큼 민다.
- **학생 폴링 응답에 상대 팀 채널을 절대 섞지 않는다.** SQL에서 거른다(클라이언트에서 숨기지 않기).
  `after_end` 공개 방식이면 점수 필드도 SQL에서 뺀다.
- **AI 입력은 전부 가명.** `team_members.alias` 를 배정 시 고정하고, 결과의 `member_notes` 는 가명→member_id
  로 서버가 되돌린다. 모델 출력에 실명이 있을 수 없게 입력에서부터 뺀다.
- **Moderation 판정을 채점에 넘기지 않는다** (R50과 같은 이유).
- **발언 점수 합산은 서버.** 태도 감점이 양수로 와도 음수로 취급, 발언 점수 0 하한 (`computeTotals` 와 같은 방어).
- **교사가 고친 점수(`edited_at` not null)는 재채점이 덮지 않는다.**
- **종료 API는 결과 생성을 기다리지 않는다.** `runInBackground` 안에서 pending 발언을 최대 60초 기다린다.
  Vercel 함수 기본 제한 시간(300s) 안이다. 라우트에 `maxDuration` 을 넉넉히.
- 목킹 원칙(`CLAUDE.md`): 예외를 삼키는 함수(`judgeSpeech`)를 throw 로 목킹하지 말 것.
- 채점 품질은 목 테스트로 증명되지 않는다. 사람 검증 H4 + 필요하면 `verify:quality` 에 팀 발언 샘플 추가.
- 검증 스크립트가 코드 변경을 못 따라간 전례가 있다. 규칙을 바꾸면 `scripts/verify-team.mjs` 도 함께 본다.
  스크립트가 만드는 데이터는 `team-` 접두어로, 끝나면 지운다. 운영 DB 금지.
- 학생 UI는 태블릿 세로가 1차 대상이다. 터치 타겟 크게. 768px 미만에서 탭 전환.
- Next.js 16.3 — 학습 데이터와 API가 다를 수 있다. 라우트 파라미터가 Promise인지 등은 docs로 확인
  (기존 라우트 `src/app/api/sessions/[sessionId]/route.ts` 가 좋은 예시).

## 세션 환경

- darwin / zsh. 패키지 매니저 **npm** (기존 PRD의 `pnpm` 표기는 실제와 다르다; `package.json` 스크립트 기준).
- Vercel 플러그인 로드됨. Node 런타임, `runtime='edge'` 금지. Vercel CLI 구버전(50.32.5).
