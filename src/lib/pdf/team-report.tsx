import "server-only";
import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { registerFonts } from "./report";
import { JUDGE_LABEL } from "@/lib/prompts/team-judge-guide";
import { PHASE_LABEL, type Side, type TeamPhase } from "@/lib/team/rules";

/**
 * 팀 토론 결과 PDF (ver2 V-R45).
 * 표지 · 점수 요약 · 우승팀 · 종합 피드백 · 학생별 참여 요약 · 전체 토론방 기록 전문.
 * **팀 채팅은 넣지 않는다.**
 */

export interface TeamPdfData {
  className: string;
  gradeLevel: number;
  topic: string;
  description: string | null;
  generatedAt: string;
  teamNames: Record<Side, string>;
  /** 결과 생성 전이면 표지에 표기한다 */
  reportReady: boolean;
  totals: { pro: number; con: number; byStage: Partial<Record<TeamPhase, Record<Side, number>>>; pendingCount: number; failedCount: number };
  winner: Side | "draw" | null;
  feedback: { best: Record<Side, { point: string; why: string }>; missed: string[]; suggestions: string[] } | null;
  members: { name: string; side: Side; speechCount: number; note: string | null }[];
  penalties: { side: Side; phase: TeamPhase; points: number; reason: string }[];
  floor: {
    seq: number;
    phase: TeamPhase;
    kind: string;
    side: Side | null;
    author: string | null;
    content: string;
    hidden: boolean;
    score: {
      status: string; total: number | null; logic: number | null; evidence: number | null;
      response: number | null; phaseFit: number | null; attitude: number | null; reason: string | null; edited: boolean;
    } | null;
  }[];
}

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansKR", fontSize: 10, padding: 36, lineHeight: 1.5 },
  coverTitle: { fontSize: 22, fontWeight: 700, marginBottom: 12 },
  coverTopic: { fontSize: 15, marginBottom: 20 },
  meta: { fontSize: 11, marginBottom: 3, color: "#333333" },
  notice: { fontSize: 10, marginTop: 14, color: "#a15c00" },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 16, marginBottom: 6 },
  h3: { fontSize: 11, fontWeight: 700, marginTop: 10, marginBottom: 4 },
  sub: { fontSize: 9, color: "#555555" },
  row: { flexDirection: "row", marginBottom: 2 },
  cell: { width: 120 },
  big: { fontSize: 16, fontWeight: 700, marginBottom: 6 },
  speechPro: { marginBottom: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#2563eb" },
  speechCon: { marginBottom: 5, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: "#ea580c" },
  system: { marginBottom: 4, fontSize: 9, color: "#666666" },
  hidden: { backgroundColor: "#fee2e2" },
  score: { fontSize: 8, color: "#444444" },
});

const SIDE_LABEL: Record<Side, string> = { pro: "찬성", con: "반대" };

function winnerText(d: TeamPdfData): string {
  if (!d.winner) return "발언이 없어 결과가 없습니다.";
  if (d.winner === "draw") return "무승부";
  return `${d.teamNames[d.winner]} 우승`;
}

function scoreLine(sc: NonNullable<TeamPdfData["floor"][number]["score"]>): string {
  if (sc.status === "failed") return "채점 대기";
  if (sc.status !== "done") return "채점 중";
  const parts = [
    `${JUDGE_LABEL.logic} ${sc.logic}`,
    `${JUDGE_LABEL.evidence} ${sc.evidence}`,
    `${JUDGE_LABEL.response} ${sc.response}`,
    `${JUDGE_LABEL.phaseFit} ${sc.phaseFit}`,
    `${JUDGE_LABEL.attitude} ${sc.attitude}`,
  ].join(" · ");
  return `${sc.total}점 (${parts})${sc.edited ? " · 선생님 수정" : ""}${sc.reason ? ` — ${sc.reason}` : ""}`;
}

function TeamReport({ data }: { data: TeamPdfData }) {
  const n = data.teamNames;
  const stages = (["claim", "rebuttal", "counter", "final"] as TeamPhase[]).filter((p) => data.totals.byStage[p]);
  const bySide = (side: Side) => data.members.filter((m) => m.side === side);

  return (
    <Document title={`팀 토론 결과 - ${data.topic}`}>
      <Page size="A4" style={s.page}>
        <Text style={s.coverTitle}>팀 토론 결과</Text>
        <Text style={s.coverTopic}>{data.topic}</Text>
        {data.description ? <Text style={s.meta}>{data.description}</Text> : null}
        <Text style={s.meta}>토론: {data.className} · 초등 {data.gradeLevel}학년</Text>
        <Text style={s.meta}>만든 날: {data.generatedAt}</Text>
        {(["pro", "con"] as Side[]).map((side) => (
          <Text key={side} style={s.meta}>
            {n[side]}({SIDE_LABEL[side]}): {bySide(side).map((m) => m.name).join(", ") || "없음"}
          </Text>
        ))}
        {!data.reportReady ? <Text style={s.notice}>결과 생성 전 기록입니다. 점수가 바뀔 수 있습니다.</Text> : null}

        <Text style={s.h2}>점수 요약</Text>
        <Text style={s.big}>{winnerText(data)}</Text>
        <Text>
          {n.pro} {data.totals.pro}점 : {n.con} {data.totals.con}점
        </Text>
        {stages.map((p) => (
          <View key={p} style={s.row}>
            <Text style={s.cell}>{PHASE_LABEL[p]}</Text>
            <Text>
              {data.totals.byStage[p]?.pro ?? 0} : {data.totals.byStage[p]?.con ?? 0}
            </Text>
          </View>
        ))}
        {data.penalties.map((p, i) => (
          <Text key={i} style={s.sub}>
            {n[p.side]} {p.points}점 — {PHASE_LABEL[p.phase]} 단계 {p.reason}
          </Text>
        ))}
        {data.totals.pendingCount + data.totals.failedCount > 0 ? (
          <Text style={s.notice}>채점 대기 {data.totals.pendingCount + data.totals.failedCount}건 (0점으로 계산)</Text>
        ) : null}

        <Text style={s.h2}>종합 피드백</Text>
        {data.feedback ? (
          <View>
            {(["pro", "con"] as Side[]).map((side) => (
              <View key={side}>
                <Text style={s.h3}>{n[side]} — 가장 좋았던 논증</Text>
                <Text>{data.feedback!.best[side].point}</Text>
                <Text style={s.sub}>{data.feedback!.best[side].why}</Text>
              </View>
            ))}
            <Text style={s.h3}>놓친 반박 지점</Text>
            {data.feedback.missed.map((m, i) => <Text key={i}>· {m}</Text>)}
            <Text style={s.h3}>다음 토론을 위한 제안</Text>
            {data.feedback.suggestions.map((m, i) => <Text key={i}>· {m}</Text>)}
          </View>
        ) : (
          <Text style={s.sub}>아직 종합 피드백이 없습니다.</Text>
        )}

        <Text style={s.h2}>학생별 참여 요약</Text>
        {data.members.map((m, i) => (
          <View key={i} style={s.row}>
            <Text style={s.cell}>
              {m.name} ({n[m.side]}) · 발언 {m.speechCount}번
            </Text>
            <Text style={{ flex: 1 }}>{m.note ?? ""}</Text>
          </View>
        ))}
      </Page>

      <Page size="A4" style={s.page}>
        <Text style={s.h2}>전체 토론방 기록</Text>
        {data.floor.map((m) => {
          if (m.kind === "speech") {
            const side = (m.side ?? "pro") as Side;
            return (
              <View key={m.seq} style={[side === "pro" ? s.speechPro : s.speechCon, m.hidden ? s.hidden : {}]} wrap={false}>
                <Text style={s.sub}>
                  #{m.seq} · {PHASE_LABEL[m.phase]} · {n[side]} {m.author ?? ""}
                  {m.hidden ? " · 숨김 (점수 제외)" : ""}
                </Text>
                <Text>{m.content}</Text>
                {m.score ? <Text style={s.score}>{scoreLine(m.score)}</Text> : <Text style={s.score}>채점 기록 없음</Text>}
              </View>
            );
          }
          const label = m.kind === "pass" ? "패스" : m.kind === "announcement" ? "공지" : "진행";
          return (
            <Text key={m.seq} style={s.system}>
              #{m.seq} [{label}] {m.content}
            </Text>
          );
        })}
      </Page>
    </Document>
  );
}

export async function renderTeamReportPdf(data: TeamPdfData): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<TeamReport data={data} />);
}
