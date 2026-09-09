"use client";

export type CoachKind = "praise" | "need_reason" | "off_topic" | "none";

export interface CoachFeedback {
  messageId: string;
  kind: CoachKind;
  message: string;
}

/** 종류별 얼굴과 색. 아이가 색만 보고도 무슨 뜻인지 알 수 있게 한다. */
const LOOK: Record<Exclude<CoachKind, "none">, {
  face: string;
  label: string;
  box: string;
  bubble: string;
  title: string;
}> = {
  praise: {
    face: "🦉",
    label: "잘했어요",
    box: "border-green-300 bg-green-50",
    bubble: "bg-white text-green-900",
    title: "text-green-800",
  },
  need_reason: {
    face: "🦉",
    label: "이유를 더 써볼까요",
    box: "border-amber-300 bg-amber-50",
    bubble: "bg-white text-amber-900",
    title: "text-amber-800",
  },
  off_topic: {
    face: "🦉",
    label: "주제로 돌아와요",
    box: "border-orange-400 bg-orange-50",
    bubble: "bg-white text-orange-900",
    title: "text-orange-800",
  },
};

interface Props {
  feedback: CoachFeedback | null;
  /** 아직 안내가 없을 때 보여줄 기본 안내 */
  idleHint?: string;
  onDismiss?: () => void;
}

/**
 * 토론 화면 옆에서 실시간으로 안내하는 '길잡이'.
 *
 * 토론 챗봇은 주제 이탈을 혼내지 않고 대화를 이어가도록 되어 있다.
 * 무엇이 점수에 영향을 주는지 알려주는 역할은 여기서 맡는다.
 */
export default function Coach({ feedback, idleHint, onDismiss }: Props) {
  if (!feedback || feedback.kind === "none") {
    if (!idleHint) return null;
    return (
      <div className="flex items-center gap-3 rounded-2xl border-2 border-gray-200 bg-white px-4 py-3">
        <span className="text-2xl" aria-hidden>🦉</span>
        <p className="text-sm text-gray-600">{idleHint}</p>
      </div>
    );
  }

  const look = LOOK[feedback.kind];

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${look.box}`}
    >
      <span className="shrink-0 text-3xl leading-none" aria-hidden>
        {look.face}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-bold ${look.title}`}>길잡이 · {look.label}</p>
        <p className={`mt-1 rounded-xl px-3 py-2 ${look.bubble}`}>{feedback.message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="안내 닫기"
          className="shrink-0 rounded-lg px-2 py-1 text-lg text-gray-400 hover:text-gray-700"
        >
          ×
        </button>
      )}
    </div>
  );
}
