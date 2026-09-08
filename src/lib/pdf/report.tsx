import "server-only";
import path from "node:path";
import React from "react";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { SCORE_KEYS, SCORE_LABEL } from "@/lib/prompts/scoring";

let registered = false;
function registerFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "NotoSansKR",
    fonts: [
      { src: path.join(dir, "NotoSansKR-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansKR-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 한글은 아무 데서나 줄바꿈해도 된다. 기본 하이픈 분리를 끈다.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

export interface ReportStudent {
  name: string;
  stance: "pro" | "con" | null;
  messageCount: number;
  messages: { role: "student" | "bot"; content: string; verdict: string | null }[];
  score: {
    status: string;
    total: number | null;
    scores: Record<string, number | null>;
    reasons: Record<string, string> | null;
    strengths: string[] | null;
    nextStep: string | null;
  } | null;
}

export interface ReportData {
  className: string;
  gradeLevel: number;
  topic: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  generatedAt: string;
  summary: {
    totalStudents: number;
    joinedStudents: number;
    proCount: number;
    conCount: number;
    totalMessages: number;
    offTopicTotal: number;
    inappropriateTotal: number;
    scoredCount: number;
    averageTotal: number | null;
  };
  students: ReportStudent[];
}

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansKR", fontSize: 10, padding: 36, lineHeight: 1.5 },
  coverTitle: { fontSize: 22, fontWeight: 700, marginBottom: 12 },
  coverTopic: { fontSize: 15, marginBottom: 20 },
  meta: { fontSize: 11, marginBottom: 3, color: "#333333" },
  notice: { fontSize: 10, marginTop: 14, color: "#a15c00" },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  studentHeader: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  sub: { fontSize: 9, color: "#555555", marginBottom: 8 },
  row: { flexDirection: "row", marginBottom: 2 },
  cellLabel: { width: 130, color: "#555555" },
  bubbleStudent: { marginBottom: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#2563eb" },
  bubbleBot: { marginBottom: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#9ca3af" },
  flagOff: { backgroundColor: "#fef3c7" },
  flagBad: { backgroundColor: "#fee2e2" },
  speaker: { fontSize: 8, color: "#666666", marginBottom: 1 },
  scoreBox: { marginTop: 6, marginBottom: 8, padding: 8, backgroundColor: "#f3f4f6" },
  scoreTotal: { fontSize: 12, fontWeight: 700, marginBottom: 4 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#dddddd", marginVertical: 10 },
});

const STANCE = { pro: "찬성", con: "반대" } as const;

function ScoreBlock({ score }: { score: ReportStudent["score"] }) {
  if (!score) return <Text style={s.sub}>채점 기록이 없습니다.</Text>;
  if (score.status === "skipped") return <Text style={s.sub}>대화가 짧아 채점하지 않았습니다.</Text>;
  if (score.status === "failed") return <Text style={s.sub}>채점에 실패했습니다.</Text>;
  if (score.status !== "done") return <Text style={s.sub}>채점 중입니다.</Text>;

  return (
    <View style={s.scoreBox}>
      <Text style={s.scoreTotal}>토론 점수 {score.total} / 20점</Text>
      {SCORE_KEYS.map((k) => (
        <View key={k} style={s.row}>
          <Text style={s.cellLabel}>
            {SCORE_LABEL[k]} {score.scores?.[k] ?? "-"}점
          </Text>
          <Text style={{ flex: 1 }}>{score.reasons?.[k] ?? ""}</Text>
        </View>
      ))}
      {score.strengths && score.strengths.length > 0 ? (
        <Text style={{ marginTop: 4 }}>잘한 점: {score.strengths.join(" / ")}</Text>
      ) : null}
      {score.nextStep ? <Text>다음에 해볼 것: {score.nextStep}</Text> : null}
    </View>
  );
}

function Report({ data }: { data: ReportData }) {
  return (
    <Document>
      <Page size="A4" style={s.page}>
        <Text style={s.coverTitle}>토론 수업 기록</Text>
        <Text style={s.coverTopic}>{data.topic}</Text>
        {data.description ? <Text style={s.meta}>{data.description}</Text> : null}
        <Text style={s.meta}>학급: {data.className}</Text>
        <Text style={s.meta}>학년: 초등 {data.gradeLevel}학년</Text>
        <Text style={s.meta}>만든 날짜: {data.generatedAt}</Text>
        {data.status !== "closed" ? (
          <Text style={s.notice}>※ 아직 진행 중인 토론입니다. 이 문서는 진행 중 시점 기준입니다.</Text>
        ) : null}

        <Text style={s.h2}>수업 요약</Text>
        <Text style={s.meta}>
          참여 {data.summary.joinedStudents}명 / 전체 {data.summary.totalStudents}명 (찬성{" "}
          {data.summary.proCount}명, 반대 {data.summary.conCount}명)
        </Text>
        <Text style={s.meta}>학생 발언 수 합계: {data.summary.totalMessages}회</Text>
        <Text style={s.meta}>
          주제에서 벗어난 발언 {data.summary.offTopicTotal}건, 부적절한 발언{" "}
          {data.summary.inappropriateTotal}건
        </Text>
        <Text style={s.meta}>
          채점 완료 {data.summary.scoredCount}명, 반 평균{" "}
          {data.summary.averageTotal != null ? `${data.summary.averageTotal} / 20점` : "-"}
        </Text>
      </Page>

      {data.students.map((st, i) => (
        <Page size="A4" style={s.page} key={i}>
          <Text style={s.studentHeader}>{st.name}</Text>
          <Text style={s.sub}>
            입장: {st.stance ? STANCE[st.stance] : "참여하지 않음"} · 발언 {st.messageCount}회
          </Text>
          <ScoreBlock score={st.score} />
          <View style={s.divider} />
          {st.messages.length === 0 ? (
            <Text style={s.sub}>대화 기록이 없습니다.</Text>
          ) : (
            st.messages.map((m, j) => (
              <View
                key={j}
                style={[
                  m.role === "student" ? s.bubbleStudent : s.bubbleBot,
                  m.verdict === "off_topic" ? s.flagOff : {},
                  m.verdict === "inappropriate" ? s.flagBad : {},
                ]}
              >
                <Text style={s.speaker}>
                  {m.role === "student" ? st.name : "토론 친구"}
                  {m.verdict === "off_topic" ? "  [주제에서 벗어남]" : ""}
                  {m.verdict === "inappropriate" ? "  [부적절한 표현]" : ""}
                </Text>
                <Text>{m.content}</Text>
              </View>
            ))
          )}
        </Page>
      ))}
    </Document>
  );
}

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<Report data={data} />);
}
