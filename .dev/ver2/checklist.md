# Checklist: 팀 대항 토론 모드 (ver2)

요구사항·수용 기준 번호는 `prd.md` 의 V-R / V-AC 다. 태그에서는 접두어 `V-` 를 생략하지 않는다.

## Tasks

- [x] T1 이번에 쓰는 Next.js 16 API(라우트 핸들러, `after`, 동적 params)를 `node_modules/next/dist/docs/` 에서 확인
- [x] T2 `scripts/migrate.ts` down 을 내림차순 실행으로 변경 (req: V-R5) (after: T1)
- [x] T3 `0006_team_debate.sql`/`_down.sql`: 타입·9개 테이블·인덱스·RLS·`open_session_atomic` 갱신 (req: V-R2, V-R4, V-R5) (after: T2)
- [x] T4 `src/lib/team/rules.ts`·`assign.ts` 순수 함수 + 단위 테스트 (req: V-R3, V-R12, V-R20, V-R21, V-R22, V-R23, V-R27, V-R39, V-R40) (ac: V-AC2, V-AC10, V-AC17, V-AC21, V-AC29) (after: T1)
- [x] T5 SQL 함수 `open_team_debate_atomic`·`team_tick`·`team_control`·`team_claim`·`team_speak`·`team_poll` (req: V-R4, V-R10, V-R11, V-R12, V-R13, V-R14, V-R19, V-R20, V-R21, V-R23, V-R24, V-R25, V-R27, V-R49) (ac: V-AC3, V-AC11, V-AC16, V-AC18, V-AC34) (after: T3, T4)
- [x] T6 `src/lib/db/team-debates.ts` + `getOwnedTeamDebate`(404) + `env.judgeModel` + `.env.example` (req: V-R50) (after: T5)
- [x] T7 교사 생성·설정·배정 API와 setup 화면 (드래그 앤 드롭, 무작위 배정, 경고) (req: V-R1, V-R2, V-R3) (ac: V-AC1, V-AC2) (after: T6)
- [x] T8 입장 열기·보관·복원·완전 삭제(미리보기), 학급 보관·삭제 판단에 팀 토론 포함, 학급 상세 목록, 팀 기록 있는 학생은 비활성 처리 (req: V-R4, V-R5) (ac: V-AC3, V-AC4) (after: T7)
- [x] T9 학생 입장: 열린 목록에 배정 토론 추가, `/api/team/enter` + `td_device` 쿠키 + 중복 접속 알림, 대기실 (req: V-R6, V-R7, V-R9) (ac: V-AC5, V-AC6, V-AC8) (after: T8)
- [x] T10 학생 폴링 API + 토론 화면(두 칸/탭, 단계·차례, 시간 막대, 10초 경고, 서버 시각 보정) (req: V-R8, V-R15, V-R19, V-R22, V-R47, V-R49) (ac: V-AC7, V-AC9, V-AC34) (after: T9)
- [x] T11 잠금·발언·팀 채팅 API와 UI (claim, 300자, 못 보낸 발언, 토론방에 올리기, 채팅 2초 제한) (req: V-R24, V-R25, V-R26, V-R27, V-R28, V-R29) (ac: V-AC15, V-AC18, V-AC19, V-AC20, V-AC21, V-AC22) (after: T10)
- [x] T12 교사 관제실: 폴링, 제어 버튼, 공지, 숨김, 팀 채팅 경고, 점수판, 접속 상태, 알림 (req: V-R10, V-R11, V-R12, V-R13, V-R14, V-R15, V-R16, V-R17, V-R18, V-R48) (ac: V-AC9, V-AC10, V-AC11, V-AC12, V-AC13, V-AC14, V-AC16, V-AC17) (after: T10)
- [x] T13 발언 채점: 기준표 파일, 프롬프트(가명·학년 프리셋), `judgeSpeech`(예외 삼킴), claim·재시도·다시 채점, 공개 방식별 노출 (req: V-R30, V-R31, V-R32, V-R33, V-R34, V-R35, V-R37) (ac: V-AC23, V-AC24, V-AC25, V-AC26, V-AC28) (after: T11)
- [x] T14 교사 점수 수정 + 이력 + 재채점 보호 (req: V-R36) (ac: V-AC27) (after: T13, T12)
- [x] T15 Moderation 판정 → 관제실 알림 (req: V-R46) (ac: V-AC33) (after: T11, T12)
- [x] T16 종료 후 결과 생성(대기·합산·우승·피드백·이름 복원), 다시 만들기, 결과 공개 (req: V-R38, V-R39, V-R40, V-R41, V-R42) (ac: V-AC14, V-AC28, V-AC29, V-AC30) (after: T13)
- [x] T17 교사 결과 보고서 + 학생 결과 화면(응답 키 화이트리스트) (req: V-R43, V-R44) (ac: V-AC31) (after: T16, T14)
- [x] T18 팀 토론 PDF (req: V-R45) (ac: V-AC32) (after: T17)
- [x] T19 단위 테스트 보강 + `scripts/verify-team.mjs` + `npm run verify:team`, 기존 테스트·`verify:e2e` 회귀 확인 (ac: V-AC35) (after: T18, T15)
- [x] T20 `CLAUDE.md` 팀 토론 요점·"되돌리면 안 되는 것" 추가, README 에 `verify:team` (after: T19)

## 진행 기록 (implement)

- 로컬 Postgres 17 임시 클러스터에 0001~0006 적용 2회(멱등)·down(역순)·재적용 확인.
- SQL 시나리오 76개 통과 (scratchpad `team_sql_test.sql`), 동시성: 입장 열기 2회 → opened 1, 잠금 2명 → ok 1, 마감 후 30명 동시 폴링 → 패스 1건.
- `npm test` 236개 통과 (신규 team-rules 22, team-pdf 2, team-scoring-service 19, team-routes 18, 학생 삭제 2).
- typecheck·lint 0 오류, `next build` 성공, `.next/static` 키 노출 0건.
- 개발 Supabase 에 0006 만 적용(사용자 SQL Editor). `verify:e2e` 36/36, `verify:team` 49/49 통과.
- 브라우저(학생): 1:1 과 팀 토론 선택지가 함께 보임, 1:1 찬반 화면 그대로, 팀 대기실·주장 단계 화면 확인. 교사 화면은 비밀번호 입력이 필요해 자동 확인하지 않음.
- 0004 재실행 시 1:1 채점이 지워지던 버그 수정(옛 컬럼이 있을 때만 UPDATE). 로컬 DB 로 두 경우 확인.

## Acceptance Criteria

- [x] V-AC1 팀 토론 생성 시 기본값 채움 + 학년 스냅샷, open 이후 설정 변경 409
- [x] V-AC2 7명 무작위 배정 4:3, 5:2 배치 시 경고하되 저장
- [x] V-AC3 "한 번에 하나만" 에서 1:1 ↔ 팀 상호 거부 + 주제 안내, 동시 두 번 열기 1회만 성공
- [x] V-AC4 open 토론 보관·삭제 409, 닫은 뒤 보관→미리보기(발언·채팅·채점 수)→삭제, 팀 기록 있는 학생 삭제 시 비활성
- [x] V-AC5 배정 학생만 목록에 팀 토론이 보이고 미배정 학생 직접 호출 404
- [x] V-AC6 waiting 단계에 주제·우리 팀·팀원만, 입력창 없음
- [x] V-AC7 상대 팀 채팅 요청 404, 폴링 응답에 상대 팀 채팅 없음
- [x] V-AC8 두 번째 기기 입장 시 앞 기기 409 replaced + 중복 접속 알림
- [x] V-AC9 단계 시간 종료 시 잠김·단계 유지, "다음 단계로" 후 3초 안에 전원 반영
- [x] V-AC10 단계별 첫 차례(찬·반·찬·반), final 팀당 2회 후 잠김
- [x] V-AC11 일시정지·재개 후 남은 시간 유지, 일시정지 중 발언 409·채팅 성공
- [x] V-AC12 시간 끝난 단계 "1분 연장" 시 재개방 + 60초
- [x] V-AC13 공지 두 번 → 두 번째만 고정, 첫 번째 기록 유지
- [x] V-AC14 발언 숨김 → 가림 문구 + 총점에서 제외, 되돌리면 복원
- [x] V-AC15 발언 후 즉시 상대 차례 60초, 상대 차례에 발언 409
- [x] V-AC16 차례 시간 초과 시 패스 정확히 1회 (30명 동시 폴링에도)
- [x] V-AC17 연속 패스 2회 → 감점 -1 + 알림 1회, 3회째 추가 감점 없음
- [x] V-AC18 동시 잠금 요청 한 명만 성공, 20초 무입력 후 다른 학생 획득
- [x] V-AC19 301자 400, 잠금 없는 발언 409
- [ ] V-AC20 (API 저장은 확인, 화면 자동 저장은 브라우저 미확인) 차례 넘어가면 쓰던 글이 팀 채팅에 "(못 보낸 발언)"
- [x] V-AC21 발언자 고르게: 15초 제한 동작, 접속 중 대상 없으면 즉시 허용
- [ ] V-AC22 (429 확인, '토론방에 올리기' 입력창 채움은 브라우저 미확인) 팀 채팅 1초 간격 두 번째 429, "토론방에 올리기" 입력창 채움
- [x] V-AC23 발언 후 5초 안에 교사 화면 점수·근거, 점수 = 항목 합 + 감점(0 하한)
- [x] V-AC24 채점·결과 프롬프트에 실명 0건, 가명 존재, Moderation 필드 없음
- [x] V-AC25 4학년 기본 after_end(학생 응답에 점수 없음), 6학년 기본 live
- [x] V-AC26 채점 실패 시 발언·차례 정상, "채점 대기", 다시 채점으로 복구
- [x] V-AC27 교사 수정 → 총점 반영 + 이력 1건, 재채점이 덮어쓰지 않음, 범위 밖 400
- [x] V-AC28 같은 발언 동시 채점 요청 모델 호출 1회, 결과 생성도 1회
- [x] V-AC29 동점 시 반론꺾기 우선, 그다음 무승부, 발언 0개면 결과 없음
- [x] V-AC30 "토론 종료" 1초 안 응답, 60초 안에 보고서 완성
- [x] V-AC31 공개 전 학생 결과 준비 중, 공개 후 응답 키 화이트리스트(개인 정보 없음)
- [x] V-AC32 PDF 한글 정상, 10명×40발언 전문·점수·숨김·패스, 팀 채팅 없음
- [x] V-AC33 욕설 발언 알림만(자동 숨김 없음), Moderation 실패해도 저장
- [x] V-AC34 폴링이 since 이후만, 폴링 1회 = RPC 1회
- [x] V-AC35 기존 `npm test` 와 `verify:e2e` 36항목 그대로 통과

## Human Checks

- [ ] H1 6명 이상으로 40분 한 차시 시범 운영 — 순서·시간 안내 이해도
- [ ] H2 태블릿 세로 탭 전환·차례 강조·키보드 가림
- [ ] H3 학교 네트워크에서 1.5초 폴링 체감 속도 (P3)
- [ ] H4 AI 발언 점수 vs 교사 채점 20개 비교
- [ ] H5 3학년 기준 근거·피드백 말투
- [ ] H6 관제실에서 두 팀 채팅 + 토론방 동시 파악, 알림 3초 인지
- [ ] H7 20초 잠금 규칙·발언자 고르게 옵션의 교실 반응
- [ ] H8 PDF 인쇄 가독성
