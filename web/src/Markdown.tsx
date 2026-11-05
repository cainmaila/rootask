import type { ReactNode } from "react";
import { viewUrl } from "../../shared/attachments";

// 留言與任務說明用的精簡 Markdown：標題、清單、核取方塊、引言、粗體、行內程式碼、圖片、連結。
// 不使用 innerHTML，所有內容都以文字或受控的元素輸出，不會被注入腳本。

const TOKEN =
  /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<>()]+)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (m[2]) {
      const src = viewUrl(m[2]);
      out.push(
        <a key={key} href={src} target="_blank" rel="noreferrer" className="md-img">
          <img src={src} alt={m[1]} loading="lazy" />
        </a>,
      );
    } else if (m[4]) {
      out.push(
        <a key={key} href={viewUrl(m[4])} target="_blank" rel="noreferrer">
          {m[3]}
        </a>,
      );
    } else if (m[5]) {
      out.push(<strong key={key}>{m[5]}</strong>);
    } else if (m[6]) {
      out.push(<code key={key}>{m[6]}</code>);
    } else if (m[7]) {
      out.push(
        <a key={key} href={viewUrl(m[7])} target="_blank" rel="noreferrer">
          {m[7]}
        </a>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "li"; items: { text: string; check: boolean | null }[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "p"; lines: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const last = out[out.length - 1];
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      out.push({ kind: "h", level: m[1].length, text: m[2] });
    } else if ((m = line.match(/^\s*[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/))) {
      const item = { text: m[2], check: m[1] === undefined ? null : m[1].toLowerCase() === "x" };
      if (last?.kind === "li") last.items.push(item);
      else out.push({ kind: "li", items: [item] });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      if (last?.kind === "quote") last.lines.push(m[1]);
      else out.push({ kind: "quote", lines: [m[1]] });
    } else if (line === "") {
      out.push({ kind: "p", lines: [] }); // 空行＝分段
    } else if (last?.kind === "p" && last.lines.length) {
      last.lines.push(line);
    } else {
      out.push({ kind: "p", lines: [line] });
    }
  }
  return out.filter((b) => b.kind !== "p" || b.lines.length);
}

function lines(ls: string[], key: string): ReactNode[] {
  return ls.flatMap((l, i) => [...inline(l, `${key}-${i}`), i < ls.length - 1 ? <br key={`${key}-br${i}`} /> : null]);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {blocks(text).map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case "h": {
            const H = (`h${Math.min(b.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6");
            return <H key={k}>{inline(b.text, k)}</H>;
          }
          case "li":
            return (
              <ul key={k}>
                {b.items.map((it, j) => (
                  <li key={j} className={it.check === null ? "" : "task-item"}>
                    {it.check !== null && <input type="checkbox" checked={it.check} readOnly disabled />}
                    {inline(it.text, `${k}-${j}`)}
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return <blockquote key={k}>{lines(b.lines, k)}</blockquote>;
          default:
            return <p key={k}>{lines(b.lines, k)}</p>;
        }
      })}
    </div>
  );
}
