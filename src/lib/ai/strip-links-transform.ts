import "server-only";
import type { StreamTextTransform, ToolSet } from "ai";
import { LinkStripper } from "@/lib/strip-links";

/**
 * 학생에게 가는 토론 응답 스트림에서 링크를 지운다 (`stripLinks` 참고).
 *
 * 토론 AI 에는 근거 자료의 주소를 넘기지 않지만, 모델이 기억에서 주소를 쓰는 경우에 대비한 안전장치다.
 */
export function stripLinksTransform<TOOLS extends ToolSet>(): StreamTextTransform<TOOLS> {
  return () => {
    const strippers = new Map<string, LinkStripper>();
    return new TransformStream({
      transform(part, controller) {
        if (part.type === "text-delta") {
          let s = strippers.get(part.id);
          if (!s) strippers.set(part.id, (s = new LinkStripper()));
          const text = s.push(part.text);
          if (text) controller.enqueue({ ...part, text });
          return;
        }
        if (part.type === "text-end") {
          const s = strippers.get(part.id);
          const rest = s?.flush();
          if (rest) controller.enqueue({ type: "text-delta", id: part.id, text: rest });
          strippers.delete(part.id);
        }
        controller.enqueue(part);
      },
    });
  };
}
