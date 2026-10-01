/**
 * 토론 챗봇 응답에서 링크를 지운다.
 *
 * 웹 검색을 쓰면 모델이 `([example.com](https://...))` 같은 인용 표시를 붙인다.
 * 초등학생 화면에는 주소를 보여주지 않는다 — 출처는 "○○에서 조사했더니" 처럼 말로만 전한다.
 * 지침에도 링크를 쓰지 말라고 적었지만, 모델이 어겨도 학생에게 닿지 않도록 여기서 한 번 더 거른다.
 */

/** 이미 다 받은 글에서 링크를 지운다. 여러 번 적용해도 결과가 같다. */
export function stripLinks(text: string): string {
  return (
    text
      // 괄호로 감싼 인용: ([a.com](url)) , ([a.com](url), [b.com](url))
      .replace(/[ \t]*\(\s*\[[^\]]*\]\([^)\s]*\)(?:\s*,?\s*\[[^\]]*\]\([^)\s]*\))*\s*\)/g, "")
      // 마크다운 링크: 글자가 주소처럼 생겼으면 통째로, 아니면 글자만 남긴다
      .replace(/\[([^\]]*)\]\([^)\s]*\)/g, (_, label: string) =>
        /^\S+\.\S+$/.test(label.trim()) ? "" : label,
      )
      // 맨 주소
      .replace(/[ \t]*https?:\/\/[^\s)]+/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]+([.,!?])/g, "$1")
      .replace(/[ \t]{2,}/g, " ")
  );
}

/** 이보다 길게 닫히지 않으면 링크가 아니라고 보고 내보낸다 */
const MAX_HOLD = 400;

/**
 * 스트리밍용. 링크가 조각 사이에 걸쳐 올 수 있으므로,
 * 아직 닫히지 않은 `[` `(` 와 쓰는 중인 주소는 붙잡아 두었다가 완성되면 지워서 내보낸다.
 */
export class LinkStripper {
  private buf = "";

  push(chunk: string): string {
    this.buf += chunk;
    if (this.buf.length - holdFrom(this.buf) > MAX_HOLD) return this.flush();
    const hold = holdFrom(this.buf);
    const ready = this.buf.slice(0, hold);
    this.buf = this.buf.slice(hold);
    return stripLinks(ready);
  }

  flush(): string {
    const out = stripLinks(this.buf);
    this.buf = "";
    return out;
  }
}

/** 이 위치부터는 링크의 일부일 수 있어 아직 내보내면 안 된다 */
function holdFrom(s: string): number {
  const stack: { ch: "[" | "("; start: number }[] = [];
  let lastBracket: { start: number; end: number } | null = null;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[") stack.push({ ch: "[", start: i });
    else if (c === "]") {
      const top = stack[stack.length - 1];
      if (top?.ch === "[") {
        stack.pop();
        lastBracket = { start: top.start, end: i };
      }
    } else if (c === "(") {
      // `[글자](` 는 `[` 부터 한 덩어리다
      const start = lastBracket && lastBracket.end === i - 1 ? lastBracket.start : i;
      stack.push({ ch: "(", start });
    } else if (c === ")") {
      if (stack[stack.length - 1]?.ch === "(") stack.pop();
    }
  }

  let hold = s.length;
  for (const o of stack) hold = Math.min(hold, o.start);
  // `[글자]` 로 끝났으면 바로 뒤에 `(주소)` 가 올 수 있다
  if (lastBracket && lastBracket.end === s.length - 1) hold = Math.min(hold, lastBracket.start);

  // 쓰는 중인 주소: 마지막 낱말이 "http" 의 앞부분이거나 주소
  const m = /(\S+)$/.exec(s);
  if (m) {
    const word = m[1];
    const partial = word.startsWith("h") && ("https://".startsWith(word) || "http://".startsWith(word));
    if (partial || /^https?:\/\/\S*$/.test(word)) {
      hold = Math.min(hold, m.index);
    }
  }
  // 붙잡는 곳 바로 앞(또는 글 끝)의 공백도 붙잡는다.
  // 뒤에 인용이 오면 공백째 지워야 "했어 ." 나 "했어.  그래도" 처럼 남지 않는다.
  while (hold > 0 && (s[hold - 1] === " " || s[hold - 1] === "\t")) hold--;
  return hold;
}
