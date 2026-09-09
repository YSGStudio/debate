# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## 이 프로젝트

초등학생(3~6학년)이 교사가 정한 주제로 AI와 1:1 토론하고, 교사가 반 전체를 한 화면에서
지켜보는 웹 서비스. 요구사항 원본은 `.dev/debate-classroom/prd.md`(R1~R57, AC1~AC26),
작업 상태는 같은 폴더의 `checklist.md`, 결정 이력은 `context-notes.md` 에 있다.
동작을 바꾸기 전에 해당 요구사항 번호를 확인할 것.

## 명령

```bash
npm run dev            # 개발 서버
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm test               # vitest run
npm run build

npm run db:migrate           # supabase/migrations 의 up 파일을 번호순으로 적용
npm run db:migrate -- down   # 되돌리기 (데이터가 전부 사라진다)
npm run db:seed              # 초대 코드 + 데모 교사/학급/학생

npm run verify:e2e     # 실제 Supabase 에 붙는 E2E 36항목 (dev 서버 필요)
npm run verify:quality # 실제 OpenAI 를 불러 챗봇·판정·채점 품질 18항목
```

단일 테스트: `npx vitest run tests/scoring-service.test.ts`
단일 케이스: `npx vitest run -t "상한 직전 메시지는 통과"`

`verify:*` 두 스크립트는 연결된 Supabase 에 실제로 데이터를 쓰고 지운다
(`e2e-`/`q-` 로 시작하는 계정과 검증용 학급만 만들었다 지움). 운영 DB 에서 돌리지 말 것.

## 아키텍처에서 먼저 알아야 할 것

**DB 접근은 서버에서 service role 키로만 한다.** 모든 테이블에 RLS 를 켜고 정책을
만들지 않았다(전면 거부). 브라우저는 DB 에 직접 접근하지 않는다. `src/lib/db/*` 는
전부 `server-only` 를 임포트한다. 클라이언트에서 데이터가 필요하면 API 라우트를 거친다.

**학년 프리셋은 `src/lib/grade-presets.ts` 한 곳에만 있다.** 토론 프롬프트
(`prompts/debate.ts`)와 채점 프롬프트(`prompts/scoring.ts`)가 같은 상수를 읽는다.
학년별 문장 수·문장 길이·어휘 지침·채점 기대 수준을 여기서 바꾸면 두 곳에 함께 반영된다.
프리셋을 다른 파일에 복사하지 말 것.

**채점 기준은 `src/lib/prompts/scoring-guide.ts` 에 있다.** 5영역 100점
(주장 표현 15 / 근거 25 / 반론 대응 25 / 생각의 발전 25 / 참여 10) 과
주제 이탈 감점(0 ~ -15)이다. 배점을 바꾸면 `prompts/scoring.ts` 의 `AREAS` 와
DB 제약(0004 마이그레이션)도 함께 고쳐야 한다.

**길잡이 캐릭터는 `src/lib/prompts/coach.ts` 와 `src/app/debate/coach.tsx` 다.**
학생 화면 옆에서 실시간으로 "근거를 더 써보자 / 주제로 돌아오자 / 잘했다" 를 알려준다.
토론 챗봇은 지침상 주제 이탈을 혼내지 않으므로, 점수에 영향을 주는 것을 알려주는
역할은 길잡이가 맡는다. 판정과 **같은 모델 호출**에서 종류를 받는다 — 별도 호출을
만들면 학생 메시지마다 비용이 두 배가 된다.

**챗봇의 교수법은 `src/lib/prompts/debate-guide.ts` 에 있다.** 어떻게 반박하고
어떤 질문을 던질지(근거 검토 기준, 반론 관점 목록, 근거 수준별 대응, 금지 표현)는
전부 이 파일이다. `prompts/debate.ts` 는 여기에 주제·입장·학년만 붙인다.
토론 방식을 바꾸려면 코드 로직이 아니라 이 파일을 고친다.

**세션은 학급 학년을 스냅샷한다.** `debate_sessions.grade_level` 은 생성 시 학급 값을
복사하고, `draft` 상태에서만 바뀐다. 학급 학년을 나중에 바꿔도 진행 중인 세션은 흔들리지
않는다 (R41).

**두 종류의 인증이 있다.**
- 교사: Supabase Auth 가 비밀번호를 보관·검증하고, 성공하면 우리가 `jose` 로 서명한
  쿠키(`ts_token`)를 발급한다. 요청마다 Supabase 를 왕복하지 않는다.
- 학생: 로그인 없음. 학급 코드 + 명단에서 이름 클릭 → 서명 쿠키(`ss_token`, 12시간).

소유권 검사는 `getOwnedClass` / `getOwnedSession` 이 겸한다. 남의 리소스는 403 이 아니라
**404** 를 돌려준다 (R4).

**메시지 흐름** (`src/app/api/debate/message/route.ts`)
인증 → 세션 open 확인 → 메시지 상한 → 5초 rate limit → 학생 메시지 저장 →
판정을 `runInBackground` 로 띄우고 → 토론 응답 스트리밍 → `onEnd` 에서 봇 메시지 저장.
**판정 실패가 응답을 막아서는 안 된다** (R26): `triageMessage` 는 예외를 삼키고
`on_topic + failed:true` 를 돌려준다. 절대 throw 하지 않는다.

**첫 인사는 별도 라우트다** (`api/debate/opening`). 학생 메시지를 만들지 않으므로
상한을 깎지 않고, 판정 대상이 되지 않고, 채점 대화 전문에 학생 발언으로 섞이지 않는다.
찬반 선택 직후 챗봇 발언을 학생 메시지로 보내는 방식으로 되돌리지 말 것.

## 고치기 쉬운데 되돌리면 안 되는 것들

이미 한 번씩 버그였다가 고친 지점들이다.

- **채점 총점은 서버가 합산한다** (`prompts/scoring.ts` 의 `computeTotal`).
  모델에게 산술을 맡기면 항목 합과 총점이 어긋난다.
- **채점 중복 실행은 DB unique 제약으로 막는다** (`debate_scores.participation_id` +
  `claimScoring` 의 23505 감지). 세션 종료와 메시지 상한 도달이 동시에 일어날 수 있으므로
  애플리케이션 플래그로 막으려 하지 말 것.
- **토론 시작은 `open_session_atomic` SQL 함수로 한다.** "한 번에 하나만 열기" 검사와
  상태 전이를 한 트랜잭션에서 처리한다. 조회-후-갱신으로 되돌리면 교사가 두 번 빠르게
  누를 때 토론 두 개가 동시에 열린다.
- **응답 후에도 끝나야 하는 작업은 `runInBackground`** (`src/lib/background.ts`) 로 넘긴다.
  `void promise` 로 두면 서버리스에서 판정·채점이 조용히 유실된다.
- **학생 삭제는 그 학생의 모든 참여를 본다** (`removeOrDeactivateStudent`).
  참여 하나만 보고 판단하면 다른 세션 기록이 cascade 로 함께 지워진다.
- **삭제는 보관 → 완전 삭제 두 단계다.** `PATCH {action:"archive"}` 로 `archived_at` 을
  채우고, 완전 삭제(`DELETE`)는 `archived_at` 이 채워진 것만 지운다. DB 쿼리에도
  `.not("archived_at","is",null)` 가 걸려 있어 라우트를 우회해도 목록에서 바로
  사라지지 않는다. `PATCH {action:"restore"}` 로 되돌린다.
- **완전 삭제 전에 미리보기를 준다.** `DELETE ...?preview=1` 은 지우지 않고 사라질 것
  (학생 수, 토론 수, 대화 건수, 채점 건수)만 돌려준다. FK 가 전부 cascade 라
  되돌릴 수 없으므로 UI 는 이 숫자를 보여준 뒤에만 실제 삭제를 호출한다.
- **진행 중(`open`)인 토론은 보관도 삭제도 하지 않는다.** 보관하면 학급 코드가 죽어서
  대화하던 학생이 그대로 튕긴다. 세션 삭제는 `.neq("status","open")` 으로 DB 레벨에서도 막는다.
- **보관된 것은 학생에게 보이지 않는다.** `findClassByJoinCode` 와 `listOpenSessions`,
  `listSessions` 가 `archived_at is null` 로 거른다. 새 조회를 추가할 때 이 필터를 빠뜨리지 말 것.
- **채점 프롬프트에 `moderation_flags` 를 넘기지 않는다.** 주제 이탈 감점은 평가자가
  대화 자체를 읽고 판단한다. 판정기는 학생을 의심하지 않는 쪽으로 넉넉하게 보고,
  평가는 이탈 횟수와 토론에 미친 영향을 따지므로 기준이 다르다. 판정 결과를 넘기면
  같은 행동이 이중으로 감점된다.
  (R50 은 원래 "태도와 토론 능력은 별개 축" 이었으나, 100점 루브릭이 주제 이탈 감점을
  포함하면서 원칙이 바뀌었다. 판정 결과를 넘기지 않는다는 구현 규칙만 그대로다.)
- **길잡이 안내는 관련성 판정과 어긋나면 안 된다.** 판정이 `off_topic` 인데 길잡이가
  칭찬하면 학생이 점수 안내를 믿지 못한다. `triage.ts` 가 판정을 우선해 코칭을 맞춘다.
  부적절 판정에는 칭찬하지 않고 조용히 둔다(교사가 다룬다).
- **채점 총점은 `computeTotals` 가 계산한다.** 모델은 영역 점수와 감점만 낸다.
  감점이 양수로 오더라도 감점으로 취급하고, 최종 점수는 0 미만으로 내려가지 않는다.
- **학생 응답에 반 평균·순위·타 학생 정보를 담지 않는다** (R53).
  `api/debate/result` 의 응답 키는 `topic/stance/messageCount/score` 넷뿐이다.
- **대시보드는 DB 왕복 1회로 끝난다.** `dashboard_snapshot(uuid)` SQL 함수가 집계를
  담당한다. 학생 수만큼 쿼리를 도는 구조로 바꾸지 말 것.
- **분량 규칙은 시스템 프롬프트 맨 끝에 둔다.** 교수법 지침이 길어서, 앞쪽에 두면
  모델이 학년을 잊고 3학년에게 55자 문장을 쓴다. `debate.ts` 의 "# 분량 규칙" 블록을
  위로 올리지 말 것. `tests/debate-guide.test.ts` 가 위치를 검사한다.

## 마이그레이션

`supabase/migrations/` 의 up 파일은 전부 멱등이다(`create ... if not exists`,
`create or replace function`). 이미 배포된 DB 가 있으므로 `0001_init.sql` 을 고칠 때는
증분 파일(`0002_...`)도 함께 만들어 기존 DB 가 따라올 수 있게 한다.
`psql` 이 없으면 SQL Editor 에 번호순으로 붙여넣어도 된다.

## 테스트 관례

- `vitest.config.ts` 가 `server-only` 를 빈 스텁으로 별칭 처리한다.
- DB 를 쓰는 코드는 `@/lib/supabase/admin` 을 목킹하거나 인메모리 대역을 쓴다
  (`tests/session-grade-snapshot.test.ts` 의 supabase 체인 대역 참고).
- **목이 실제 동작과 어긋나지 않게 할 것.** 예: `triageMessage` 를 throw 하도록
  목킹하면 존재하지 않는 경로를 테스트하게 된다(실제로는 예외를 삼킨다).
- 분류 품질과 채점 품질은 목킹된 테스트로 증명되지 않는다. `npm run verify:quality` 로
  실제 모델을 불러 확인한다.

## 환경 변수

이름은 `.env.example` 에 있다. `DATABASE_URL` 은 마이그레이션 전용이며 앱 런타임은
`supabase-js` 만 쓴다. 모델 이름은 `OPENAI_DEBATE_MODEL` / `OPENAI_TRIAGE_MODEL` /
`OPENAI_SCORING_MODEL` 로 교체 가능하므로 코드에 박지 말 것.
부적절 판정은 OpenAI Moderation API(무료), 주제 이탈 판정만 소형 모델을 쓴다.
