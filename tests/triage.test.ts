import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTriageSystemPrompt } from "@/lib/prompts/triage";

/** 두 판정 호출을 각각 제어한다 */
const behavior = {
  moderationFlagged: false,
  moderationCategories: {} as Record<string, boolean>,
  onTopic: true,
  coachKind: "none" as "praise" | "need_reason" | "off_topic" | "none",
  coachMessage: "",
  moderationThrows: false,
  topicThrows: false,
};
const calls = { moderation: 0, topic: 0 };

vi.mock("openai", () => ({
  default: class {
    moderations = {
      create: async () => {
        calls.moderation++;
        if (behavior.moderationThrows) throw new Error("moderation 실패");
        return {
          results: [
            { flagged: behavior.moderationFlagged, categories: behavior.moderationCategories },
          ],
        };
      },
    };
  },
}));

vi.mock("ai", () => ({
  generateObject: async () => {
    calls.topic++;
    if (behavior.topicThrows) throw new Error("triage 모델 실패");
    return {
      object: {
        onTopic: behavior.onTopic,
        reason: "테스트 이유",
        coachKind: behavior.coachKind,
        coachMessage: behavior.coachMessage,
      },
    };
  },
}));

vi.mock("@ai-sdk/openai", () => ({ createOpenAI: () => () => "model" }));
vi.mock("@/lib/env", () => ({
  env: { openaiApiKey: "test-key", triageModel: "test-triage-model" },
}));

const { triageMessage } = await import("@/lib/ai/triage");

beforeEach(() => {
  behavior.moderationFlagged = false;
  behavior.moderationCategories = {};
  behavior.onTopic = true;
  behavior.coachKind = "none";
  behavior.coachMessage = "";
  behavior.moderationThrows = false;
  behavior.topicThrows = false;
  calls.moderation = 0;
  calls.topic = 0;
});

const TOPIC = "숙제는 없어져야 한다";
const CTX = { topic: TOPIC, grade: 4, botPrevious: null };

describe("판정 파이프라인 (R24, R25)", () => {
  it("주제와 관련된 말은 on_topic 이다", async () => {
    const r = await triageMessage(CTX, "숙제가 많으면 놀 시간이 없어요");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(false);
  });

  it("주제와 상관없는 말은 off_topic 이다 (AC11)", async () => {
    behavior.onTopic = false;
    const r = await triageMessage(CTX, "오늘 급식 뭐야?");
    expect(r.verdict).toBe("off_topic");
    expect(r.reason).toBe("테스트 이유");
  });

  it("부적절한 말은 inappropriate 이다 (AC12)", async () => {
    behavior.moderationFlagged = true;
    behavior.moderationCategories = { harassment: true, violence: false };
    const r = await triageMessage(CTX, "<욕설 샘플>");
    expect(r.verdict).toBe("inappropriate");
    expect(r.reason).toBe("harassment");
  });

  it("부적절 판정이 주제 판정보다 우선한다 (R25)", async () => {
    behavior.moderationFlagged = true;
    behavior.moderationCategories = { harassment: true };
    behavior.onTopic = false; // 이탈이기도 하지만
    const r = await triageMessage(CTX, "x");
    expect(r.verdict).toBe("inappropriate");
  });

  it("두 판정이 함께 실행된다", async () => {
    await triageMessage(CTX, "x");
    expect(calls.moderation).toBe(1);
    expect(calls.topic).toBe(1);
  });
});

describe("판정 실패는 대화를 막지 않는다 (R26, AC13)", () => {
  it("moderation 이 터져도 on_topic + failed 로 돌려준다", async () => {
    behavior.moderationThrows = true;
    const r = await triageMessage(CTX, "아무 말");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(true);
  });

  it("주제 판정 모델이 터져도 on_topic + failed 로 돌려준다", async () => {
    behavior.topicThrows = true;
    const r = await triageMessage(CTX, "아무 말");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(true);
  });

  it("어떤 경우에도 예외를 던지지 않는다", async () => {
    behavior.moderationThrows = true;
    behavior.topicThrows = true;
    await expect(triageMessage(CTX, "아무 말")).resolves.toBeDefined();
  });
});

describe("판정 프롬프트 (오탐 방지)", () => {
  it("경험담과 비유를 관련 있음으로 보라고 지시한다", () => {
    const p = buildTriageSystemPrompt(TOPIC);
    expect(p).toContain("자기 경험담");
    expect(p).toContain("비유나 예시");
    expect(p).toContain("애매하면 on_topic");
  });

  it("주제를 프롬프트에 넣는다", () => {
    expect(buildTriageSystemPrompt(TOPIC)).toContain(TOPIC);
  });
});


describe("길잡이 안내", () => {
  it("근거를 들어 잘 답하면 칭찬한다", async () => {
    behavior.coachKind = "praise";
    behavior.coachMessage = "좋은 의견이에요! 채점에 좋게 반영돼요.";
    const r = await triageMessage(CTX, "숙제가 많으면 잘 시간이 부족하기 때문이에요");
    expect(r.coachKind).toBe("praise");
    expect(r.coachMessage).toContain("좋은 의견");
  });

  it("근거 없는 단답이면 이유를 더 쓰라고 안내한다", async () => {
    behavior.coachKind = "need_reason";
    behavior.coachMessage = "왜 그렇게 생각하는지 이유를 써볼까요?";
    const r = await triageMessage(CTX, "그냥요");
    expect(r.coachKind).toBe("need_reason");
    expect(r.coachMessage).toContain("이유");
  });

  it("주제를 벗어나면 감점 가능성을 알린다", async () => {
    behavior.onTopic = false;
    behavior.coachKind = "off_topic";
    behavior.coachMessage = "주제에서 벗어났어요. 점수가 깎일 수 있어요.";
    const r = await triageMessage(CTX, "오늘 급식 뭐예요?");
    expect(r.verdict).toBe("off_topic");
    expect(r.coachKind).toBe("off_topic");
    expect(r.coachMessage).toContain("점수");
  });

  it("관련성 판정이 이탈이면 코칭도 이탈로 맞춘다", async () => {
    // 모델이 엇갈리게 답해도 학생에게 보이는 안내와 점수 판정이 어긋나면 안 된다.
    behavior.onTopic = false;
    behavior.coachKind = "praise";
    behavior.coachMessage = "잘했어요";
    const r = await triageMessage(CTX, "딴 이야기");
    expect(r.verdict).toBe("off_topic");
    expect(r.coachKind).toBe("off_topic");
  });

  it("관련성 판정이 정상인데 코칭만 이탈이면 안내하지 않는다", async () => {
    behavior.onTopic = true;
    behavior.coachKind = "off_topic";
    behavior.coachMessage = "주제에서 벗어났어요";
    const r = await triageMessage(CTX, "숙제 이야기");
    expect(r.verdict).toBe("on_topic");
    expect(r.coachKind).toBe("none");
    expect(r.coachMessage).toBeNull();
  });

  it("모델이 문구를 비워 보내도 기본 문구로 채운다", async () => {
    behavior.coachKind = "need_reason";
    behavior.coachMessage = "   ";
    const r = await triageMessage(CTX, "응");
    expect(r.coachKind).toBe("need_reason");
    expect(r.coachMessage).toBeTruthy();
    expect(r.coachMessage).toContain("이유");
  });

  it("부적절한 말에는 칭찬하지 않고 조용히 있는다", async () => {
    behavior.moderationFlagged = true;
    behavior.moderationCategories = { harassment: true };
    behavior.coachKind = "praise";
    behavior.coachMessage = "잘했어요";
    const r = await triageMessage(CTX, "<욕설>");
    expect(r.verdict).toBe("inappropriate");
    expect(r.coachKind).toBe("none");
    expect(r.coachMessage).toBeNull();
  });

  it("판정이 실패하면 안내하지 않는다 (대화는 계속된다)", async () => {
    behavior.topicThrows = true;
    const r = await triageMessage(CTX, "무슨 말이든");
    expect(r.failed).toBe(true);
    expect(r.coachKind).toBe("none");
    expect(r.coachMessage).toBeNull();
  });

  it("none 이면 안내 문구가 없다", async () => {
    behavior.coachKind = "none";
    const r = await triageMessage(CTX, "그렇구나");
    expect(r.coachMessage).toBeNull();
  });
});

describe("길잡이 프롬프트", () => {
  it("네 가지 종류와 판단 기준이 들어 있다", async () => {
    const { buildCoachRules } = await import("@/lib/prompts/coach");
    const p = buildCoachRules(4);
    for (const k of ["praise", "need_reason", "off_topic", "none"]) {
      expect(p, `${k} 누락`).toContain(k);
    }
    expect(p).toContain("짧아도 이유가 있으면 praise");
    expect(p).toContain("매번 칭찬하면 시끄럽다");
    expect(p).toContain("점수가 깎일 수 있다는 것을 꼭 알려준다");
  });

  it("학년에 맞는 문장 길이를 요구한다", async () => {
    const { buildCoachRules } = await import("@/lib/prompts/coach");
    expect(buildCoachRules(3)).toContain("25자 이내");
    expect(buildCoachRules(6)).toContain("55자 이내");
  });
});
