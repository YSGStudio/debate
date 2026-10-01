"use client";

import { useState } from "react";
import { EVIDENCE_MAX, type EvidenceItem } from "@/lib/evidence";

interface Props {
  classId: string;
  topic: string;
  description: string;
  proClaim: string;
  conClaim: string;
  items: EvidenceItem[];
  /** 목록이 바뀔 때마다 부른다. 저장된 토론이면 여기서 서버에 저장한다. */
  onChange: (items: EvidenceItem[]) => Promise<void> | void;
  /** 끝난 토론은 읽기만 한다 */
  readOnly?: boolean;
}

const SIDE_LABEL = { pro: "찬성", con: "반대" } as const;
const SIDE_COLOR = { pro: "text-blue-700", con: "text-orange-600" } as const;

/**
 * 근거 자료 검토 (찾기 · 더 찾기 · 삭제).
 *
 * 토론 AI 는 여기 남은 자료 중 자기 입장 쪽 것만 인용한다. 교사가 출처를 눌러 확인하고
 * 맞지 않는 것은 지운다. 자료 찾기는 웹 검색이라 10~20초 걸린다.
 */
export default function EvidenceEditor(props: Props) {
  const { items, readOnly } = props;
  const [busy, setBusy] = useState<null | "both" | "pro" | "con">(null);
  const [error, setError] = useState<string | null>(null);

  const ready = props.topic.trim() && props.proClaim.trim() && props.conClaim.trim();
  const room = EVIDENCE_MAX - items.length;

  async function find(sides: ("pro" | "con")[]) {
    setError(null);
    setBusy(sides.length === 2 ? "both" : sides[0]);
    const res = await fetch("/api/sessions/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        classId: props.classId,
        topic: props.topic,
        description: props.description || null,
        proClaim: props.proClaim,
        conClaim: props.conClaim,
        sides,
        existing: items,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { items?: EvidenceItem[]; error?: string };
    setBusy(null);
    if (!res.ok) { setError(body.error ?? "자료를 찾지 못했습니다."); return; }
    const found = (body.items ?? []).slice(0, room);
    if (found.length === 0) { setError("새로 찾은 자료가 없습니다. 주장 문장을 조금 바꾸거나 다시 시도해 보세요."); return; }
    await props.onChange([...items, ...found]);
  }

  async function remove(url: string, side: EvidenceItem["side"]) {
    await props.onChange(items.filter((i) => !(i.url === url && i.side === side)));
  }

  return (
    <div className="rounded-xl border border-blue-100 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-700">
          📚 근거 자료 <span className="font-normal text-gray-500">찬성 {items.filter((i) => i.side === "pro").length} · 반대 {items.filter((i) => i.side === "con").length}</span>
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-2">
            {items.length === 0 ? (
              <button type="button" onClick={() => find(["pro", "con"])} disabled={!ready || busy !== null}
                className="rounded-lg border border-blue-300 px-3 py-1.5 text-sm font-bold text-blue-700 disabled:border-gray-200 disabled:text-gray-400">
                {busy ? "찾는 중..." : "근거 자료 찾기"}
              </button>
            ) : (
              (["pro", "con"] as const).map((side) => (
                <button key={side} type="button" onClick={() => find([side])} disabled={!ready || busy !== null || room <= 0}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-bold text-gray-700 disabled:text-gray-400">
                  {busy === side ? "찾는 중..." : `${SIDE_LABEL[side]} 더 찾기`}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {!readOnly && (
        <p className="mb-2 text-xs text-gray-500">
          AI 토론 친구는 여기 남은 자료만 근거로 인용합니다. 출처를 눌러 확인하고, 맞지 않는 자료는 지워 주세요.
          {!ready && " (주제와 찬성·반대 주장을 먼저 입력해야 찾을 수 있어요)"}
          {busy && " 웹에서 찾는 중이라 10~20초 걸립니다."}
          {room <= 0 && ` 최대 ${EVIDENCE_MAX}개까지 둘 수 있어요.`}
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {(["pro", "con"] as const).flatMap((side) =>
            items.filter((i) => i.side === side).map((i) => (
              <li key={`${side}-${i.url}`} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className={`shrink-0 font-bold ${SIDE_COLOR[side]}`}>{SIDE_LABEL[side]}</span>
                <div className="min-w-0 flex-1">
                  <p><span className="font-bold">{i.source}</span> · {i.finding}</p>
                  <a href={i.url} target="_blank" rel="noopener noreferrer"
                    className="break-all text-xs text-blue-700 underline">출처 보기 ↗</a>
                </div>
                {!readOnly && (
                  <button type="button" onClick={() => remove(i.url, side)} aria-label="이 자료 지우기"
                    className="shrink-0 rounded px-2 text-gray-400 hover:bg-red-50 hover:text-red-600">✕</button>
                )}
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}
