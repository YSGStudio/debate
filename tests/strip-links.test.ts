import { describe, expect, it } from "vitest";
import { LinkStripper, stripLinks } from "@/lib/strip-links";

/** 한 글자씩, 또는 주어진 크기로 잘라 흘려보낸 결과 */
function streamed(text: string, size = 1): string {
  const s = new LinkStripper();
  let out = "";
  for (let i = 0; i < text.length; i += size) out += s.push(text.slice(i, i + size));
  return out + s.flush();
}

const CITED =
  "세계보건기구에서는 어린이가 하루 1시간 넘게 화면을 보지 않는 게 좋다고 했어. ([who.int](https://www.who.int/news/item/24-04-2019?utm_source=openai)) 그래도 스마트폰이 꼭 필요할까?";
const CLEAN = "세계보건기구에서는 어린이가 하루 1시간 넘게 화면을 보지 않는 게 좋다고 했어. 그래도 스마트폰이 꼭 필요할까?";

describe("stripLinks", () => {
  it("괄호로 감싼 검색 인용을 지운다", () => {
    expect(stripLinks(CITED)).toBe(CLEAN);
  });

  it("인용이 여러 개 묶여 있어도 지운다", () => {
    expect(stripLinks("그렇대. ([a.com](https://a.com/x), [b.org](https://b.org/y)) 어때?")).toBe("그렇대. 어때?");
  });

  it("주소처럼 생긴 링크는 통째로, 말로 된 링크는 글자만 남긴다", () => {
    expect(stripLinks("그건 [kdi.re.kr](https://kdi.re.kr) 조사야.")).toBe("그건 조사야.");
    expect(stripLinks("[한국교육개발원 조사](https://kedi.re.kr/a)에서 나왔어.")).toBe("한국교육개발원 조사에서 나왔어.");
  });

  it("맨 주소를 지운다", () => {
    expect(stripLinks("여기 봐 https://example.com/a?b=1 정말이야.")).toBe("여기 봐 정말이야.");
  });

  it("링크가 없는 글은 그대로 둔다 (괄호 포함)", () => {
    const t = "숙제(특히 주말 숙제)는 스트레스가 될 수 있어. 그런데 복습은 어떻게 할까?";
    expect(stripLinks(t)).toBe(t);
  });

  it("여러 번 적용해도 같다", () => {
    expect(stripLinks(stripLinks(CITED))).toBe(CLEAN);
  });
});

describe("LinkStripper (스트리밍)", () => {
  it.each([1, 2, 3, 7, 16])("조각 크기 %i 로 나눠 와도 링크가 새지 않는다", (size) => {
    const out = streamed(CITED, size);
    expect(out).not.toContain("http");
    expect(out).not.toContain("who.int");
    expect(out).toBe(CLEAN);
  });

  it("링크가 없으면 한 글자씩 받아도 원문과 같다", () => {
    const t = "숙제(특히 주말 숙제)는 스트레스가 될 수 있어. 그런데 [중요] 복습은 어떻게 할까?";
    expect(streamed(t)).toBe(t);
  });

  it("닫히지 않은 괄호는 끝에서 그대로 내보낸다", () => {
    expect(streamed("그건 (내 생각엔 말이야")).toBe("그건 (내 생각엔 말이야");
  });

  it("링크가 없는 부분은 바로 내보내고, 링크는 완성될 때까지 붙잡는다", () => {
    const s = new LinkStripper();
    expect(s.push("안녕! 나는 반대야. ")).toBe("안녕! 나는 반대야.");
    expect(s.push("([who")).toBe("");
    expect(s.push(".int](https://who.int)) 그렇지?")).toBe(" 그렇지?");
    expect(s.flush()).toBe("");
  });

  it("인용 바로 앞 공백과 뒤 문장부호가 어색하게 남지 않는다", () => {
    const t = "그렇게 말했어 ([a.com](https://a.com)). 너는 어때?";
    expect(stripLinks(t)).toBe("그렇게 말했어. 너는 어때?");
    expect(streamed(t)).toBe("그렇게 말했어. 너는 어때?");
  });
});
