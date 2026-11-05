import { Fragment, type ReactNode } from "react";
import { viewUrl } from "../../shared/attachments";

// 留言用的極簡 Markdown：只處理圖片、連結、自動連結與換行。
// 不使用 innerHTML，任何內容都以文字或受控的元素輸出，不會被注入腳本。

const TOKEN = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+)/g;

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
      out.push(
        <a key={key} href={viewUrl(m[5])} target="_blank" rel="noreferrer">
          {m[5]}
        </a>,
      );
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="md">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {inline(line, String(i))}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </div>
  );
}
