# 토론 친구 (debate-classroom)

초등학생이 교사가 정한 주제로 AI와 1:1 토론하고, 교사가 반 전체를 한 화면에서 지켜보는 웹 서비스.

- **학생**: 로그인 없음. 학급 코드 6자리 → 명단에서 이름 클릭 → 찬성/반대 선택 → 토론
- **챗봇**: 학생이 고른 입장의 **반대편**을 대화 내내 고수. 학년(3~6)에 맞춰 어휘와 문장 길이를 조절
- **교사**: 대시보드 3초 자동 갱신, 주제 이탈(노랑)·부적절 발언(빨강) 즉시 식별, 세션 전체 PDF 내려받기
- **채점**: 토론이 끝나면 4항목 20점 만점으로 자동 채점. 점수와 피드백을 학생과 교사가 모두 확인

요구사항 원본은 [.dev/debate-classroom/prd.md](.dev/debate-classroom/prd.md) 를 본다.

## 준비

### 1. 의존성

```bash
npm install
```

### 2. Supabase 프로젝트

[supabase.com](https://supabase.com) 에서 프로젝트를 만들고 다음을 확보한다.

- Project URL, `anon` key, `service_role` key — Project Settings → API
- Postgres 직접 연결 문자열 — Project Settings → Database → Connection string

### 3. 환경 변수

`.env.local` 을 열어 빈 값을 채운다. (`STUDENT_SESSION_SECRET`, `TEACHER_SESSION_SECRET` 은 이미 채워져 있다.)

| 변수 | 설명 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key. **서버에서만 쓴다** |
| `DATABASE_URL` | 마이그레이션 전용 Postgres 연결 문자열 |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `OPENAI_DEBATE_MODEL` | 토론 응답 모델 (기본 `gpt-4.1`) |
| `OPENAI_TRIAGE_MODEL` | 주제 이탈 판정 모델 (기본 `gpt-4.1-mini`) |
| `OPENAI_SCORING_MODEL` | 채점 모델 (기본 `gpt-4.1`) |
| `STUDENT_SESSION_SECRET` | 학생 세션 쿠키 서명 키 |
| `TEACHER_SESSION_SECRET` | 교사 세션 쿠키 서명 키 |

### 4. 스키마 적용

```bash
npm run db:migrate          # 적용
npm run db:migrate -- down  # 되돌리기 (데이터가 전부 사라진다)
```

`psql` 이 없으면 [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) 을 Supabase 대시보드의 SQL Editor 에 그대로 붙여넣어도 된다.

### 5. 시드

```bash
npm run db:seed
```

초대 코드 1개(`TEACHER2026`), 데모 교사, 학급 1개, 학생 5명을 만든다. 실행하면 로그인 정보와 학급 코드를 출력한다.

### 6. 실행

```bash
npm run dev
```

## 써보기

1. `/teacher/signup` — 초대 코드 `TEACHER2026` 으로 가입
2. 학급을 만들고 **학년**을 고른 뒤, 이름을 줄바꿈으로 붙여넣어 명단 등록
3. 토론 주제를 만들고 **토론 시작**
4. 다른 브라우저(또는 시크릿 창)에서 `/join` → 학급 코드 → 이름 클릭 → 찬성/반대 → 대화
5. 교사 대시보드에서 실시간으로 지켜보기
6. **토론 종료** → 채점이 자동으로 돌고, **PDF 내려받기**

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run typecheck` | 타입 검사 |
| `npm run lint` | 린트 |
| `npm test` | 단위·통합 테스트 (145개) |
| `npm run verify:e2e` | 실제 Supabase 에 붙는 E2E 검증 36항목 (개발 서버 필요) |
| `npm run verify:quality` | 실제 OpenAI 를 불러 챗봇·판정·채점 품질 검증 18항목 |
| `npm run db:migrate` | 스키마 적용 |
| `npm run db:seed` | 시드 데이터 |

## 검증

```bash
npm run dev          # 한 터미널
npm run verify:e2e   # 다른 터미널
```

교사 가입부터 PDF 내려받기까지 36개 항목을 실제 Supabase 에 붙어 확인한다.

```bash
npm run verify:quality
```

실제 OpenAI 를 불러 챗봇이 10턴 내내 반대 입장을 지키는지, 3학년과 6학년 응답이
실제로 다른지, 개인 경험담을 주제 이탈로 잘못 잡지 않는지, 채점이 제대로 도는지를
확인한다. 대화 전문이 `quality-transcript.txt` 에 남으므로 말투를 직접 읽어볼 수 있다.
OpenAI 호출이 30~40회 일어난다.

두 스크립트 모두 `e2e-`/`q-` 로 시작하는 검증용 계정과 학급만 만들었다가 끝나면 지운다.
**운영 데이터가 들어 있는 프로젝트에서는 돌리지 말 것.**

## 보관함

학급과 토론은 바로 지워지지 않는다. **보관함으로 → 완전 삭제** 두 단계다.

- **보관함으로**: 목록에서 사라지고, 학급 코드로 학생이 들어올 수 없다. 되돌릴 수 있다.
- **완전 삭제**: 보관함에서만 할 수 있다. 지우기 전에 학생 수·토론 수·대화 건수·채점 건수를
  보여주고, 대화가 있으면 PDF 를 먼저 받으라고 안내한다. FK 가 cascade 라 되돌릴 수 없다.

진행 중인 토론은 보관도 삭제도 되지 않는다. 대화하던 학생 화면이 그대로 멈추기 때문이다.

## 구조에서 알아둘 것

- **모든 DB 접근은 서버에서 service role 키로만 한다.** 모든 테이블에 RLS 를 켜고 정책을 만들지 않았다(전면 거부). anon 키가 노출돼도 데이터가 읽히지 않는다.
- **학년 프리셋은 [src/lib/grade-presets.ts](src/lib/grade-presets.ts) 한 곳에만 있다.** 토론 프롬프트와 채점 프롬프트가 같은 상수를 읽는다. 여기를 고치면 두 곳에 함께 반영된다.
- **채점 총점은 모델이 아니라 서버가 합산한다.** 모델에게 산술을 맡기면 항목 합과 총점이 어긋난다.
- **채점 중복 실행은 DB unique 제약으로 막는다.** 세션 종료와 메시지 상한 도달이 동시에 일어나도 모델은 한 번만 호출된다.
- **판정 실패가 대화를 막지 않는다.** 이탈/부적절 판정은 응답 스트리밍과 병렬로 돌고, 실패하면 `on_topic` + `triage_failed` 로 기록만 남긴다.
- **채점 프롬프트에 판정 결과를 넘기지 않는다.** 태도와 토론 능력은 별개 축이다.
- **대시보드는 DB 왕복 1회로 끝난다.** `dashboard_snapshot(uuid)` SQL 함수가 집계를 담당한다.
