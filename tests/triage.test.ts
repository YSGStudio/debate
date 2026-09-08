import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTriageSystemPrompt } from "@/lib/prompts/triage";

/** 두 판정 호출을 각각 제어한다 */
const behavior = {
  moderationFlagged: false,
  moderationCategories: {} as Record<string, boolean>,
  onTopic: true,
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
    return { object: { onTopic: behavior.onTopic, reason: "테스트 이유" } };
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
  behavior.moderationThrows = false;
  behavior.topicThrows = false;
  calls.moderation = 0;
  calls.topic = 0;
});

const TOPIC = "숙제는 없어져야 한다";

describe("판정 파이프라인 (R24, R25)", () => {
  it("주제와 관련된 말은 on_topic 이다", async () => {
    const r = await triageMessage(TOPIC, "숙제가 많으면 놀 시간이 없어요");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(false);
  });

  it("주제와 상관없는 말은 off_topic 이다 (AC11)", async () => {
    behavior.onTopic = false;
    const r = await triageMessage(TOPIC, "오늘 급식 뭐야?");
    expect(r.verdict).toBe("off_topic");
    expect(r.reason).toBe("테스트 이유");
  });

  it("부적절한 말은 inappropriate 이다 (AC12)", async () => {
    behavior.moderationFlagged = true;
    behavior.moderationCategories = { harassment: true, violence: false };
    const r = await triageMessage(TOPIC, "<욕설 샘플>");
    expect(r.verdict).toBe("inappropriate");
    expect(r.reason).toBe("harassment");
  });

  it("부적절 판정이 주제 판정보다 우선한다 (R25)", async () => {
    behavior.moderationFlagged = true;
    behavior.moderationCategories = { harassment: true };
    behavior.onTopic = false; // 이탈이기도 하지만
    const r = await triageMessage(TOPIC, "x");
    expect(r.verdict).toBe("inappropriate");
  });

  it("두 판정이 함께 실행된다", async () => {
    await triageMessage(TOPIC, "x");
    expect(calls.moderation).toBe(1);
    expect(calls.topic).toBe(1);
  });
});

describe("판정 실패는 대화를 막지 않는다 (R26, AC13)", () => {
  it("moderation 이 터져도 on_topic + failed 로 돌려준다", async () => {
    behavior.moderationThrows = true;
    const r = await triageMessage(TOPIC, "아무 말");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(true);
  });

  it("주제 판정 모델이 터져도 on_topic + failed 로 돌려준다", async () => {
    behavior.topicThrows = true;
    const r = await triageMessage(TOPIC, "아무 말");
    expect(r.verdict).toBe("on_topic");
    expect(r.failed).toBe(true);
  });

  it("어떤 경우에도 예외를 던지지 않는다", async () => {
    behavior.moderationThrows = true;
    behavior.topicThrows = true;
    await expect(triageMessage(TOPIC, "아무 말")).resolves.toBeDefined();
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
