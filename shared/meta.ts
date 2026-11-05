// 任務的額外欄位（GitHub issue 沒有的），存在 issue 內文最後的隱藏區塊：
//   <!-- rootask:meta {"start":"2026-11-10","due":"2026-11-20"} -->
// GitHub 網頁上看不到這段，使用者直接在 GitHub 編輯內文時也不容易誤刪。

export interface TaskMeta {
  /** 預計開始日 YYYY-MM-DD */
  start?: string;
  /** 預計截止日 YYYY-MM-DD */
  due?: string;
}

const RE = /\n*<!-- rootask:meta (\{.*?\}) -->\s*$/s;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 拆出使用者看到的內文與隱藏欄位；格式壞掉時當作沒有欄位，內文原樣保留 */
export function parseMeta(body: string | null | undefined): { text: string; meta: TaskMeta } {
  const raw = body ?? "";
  const m = raw.match(RE);
  if (!m) return { text: raw, meta: {} };
  try {
    const obj = JSON.parse(m[1]) as Record<string, unknown>;
    const meta: TaskMeta = {};
    if (isDate(obj.start)) meta.start = obj.start;
    if (isDate(obj.due)) meta.due = obj.due;
    return { text: raw.slice(0, m.index).replace(/\s+$/, ""), meta };
  } catch {
    return { text: raw, meta: {} };
  }
}

/** 把內文與欄位組回 issue body；沒有任何欄位時不留隱藏區塊 */
export function writeMeta(text: string, meta: TaskMeta): string {
  const clean: TaskMeta = {};
  if (meta.start && isDate(meta.start)) clean.start = meta.start;
  if (meta.due && isDate(meta.due)) clean.due = meta.due;
  const base = parseMeta(text).text.replace(/\s+$/, ""); // 避免重複疊加
  if (!clean.start && !clean.due) return base;
  return `${base}${base ? "\n\n" : ""}<!-- rootask:meta ${JSON.stringify(clean)} -->`;
}

/** 檢查預計日期的合理性，回傳錯誤訊息 */
export function metaError(meta: TaskMeta): string | null {
  if (meta.start && meta.due && meta.start > meta.due) return "預計開始日不能晚於預計截止日";
  return null;
}

/** 以本地日期判斷是否逾期（截止日當天不算逾期） */
export function isOverdue(due: string | undefined, today: string): boolean {
  return !!due && due < today;
}

export function todayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
