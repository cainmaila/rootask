// 搜尋與篩選（#47）。純函式，任務樹與之後的看板（#43）共用。
// 篩選後保留樹狀結構：符合的任務，加上它們的上層（當作脈絡，淡化顯示）。

export interface TaskFilter {
  /** 文字搜尋：標題、說明、#編號；多個詞要全部符合 */
  text: string;
  /** "" 不限、"@me" 我、"@none" 未分配、其他為帳號 */
  assignee: string;
  /** "" 不限，否則為狀態 id */
  status: string;
  /** 只看逾期 */
  overdue: boolean;
}

export const EMPTY_FILTER: TaskFilter = { text: "", assignee: "", status: "", overdue: false };

export function isFilterActive(f: TaskFilter): boolean {
  return !!(f.text.trim() || f.assignee || f.status || f.overdue);
}

/** 篩選需要的任務資料（避免依賴前端的 Task 型別） */
export interface FilterableTask {
  number: number;
  title: string;
  body: string;
  parent: number | null;
  assignees: string[];
  statusId: string;
  /** 狀態類別是完成或取消 */
  closed: boolean;
  due?: string;
}

export interface FilterResult {
  /** 要顯示的任務：符合的＋它們的上層 */
  visible: Set<number>;
  /** 真正符合條件的任務 */
  matches: Set<number>;
  /** 為了讓符合的任務看得到，需要展開的上層 */
  expand: Set<number>;
}

const norm = (s: string) => s.normalize("NFKC").toLowerCase();

function matchText(t: FilterableTask, words: string[]): boolean {
  if (words.length === 0) return true;
  const hay = norm(`${t.title}\n${t.body}`);
  return words.every((w) => {
    const m = w.match(/^#(\d+)$/);
    if (m) return t.number === Number(m[1]);
    return hay.includes(w);
  });
}

export function matchesFilter(t: FilterableTask, f: TaskFilter, me: string, today: string): boolean {
  const words = norm(f.text).split(/\s+/).filter(Boolean);
  if (!matchText(t, words)) return false;
  if (f.assignee === "@me" && !t.assignees.some((a) => norm(a) === norm(me))) return false;
  if (f.assignee === "@none" && t.assignees.length > 0) return false;
  if (f.assignee && !f.assignee.startsWith("@") && !t.assignees.some((a) => norm(a) === norm(f.assignee))) return false;
  if (f.status && t.statusId !== f.status) return false;
  if (f.overdue && !(t.due && !t.closed && t.due < today)) return false;
  return true;
}

export function filterTasks(tasks: FilterableTask[], f: TaskFilter, me: string, today: string): FilterResult {
  const by = new Map(tasks.map((t) => [t.number, t]));
  const matches = new Set<number>();
  const visible = new Set<number>();
  const expand = new Set<number>();
  for (const t of tasks) {
    if (!matchesFilter(t, f, me, today)) continue;
    matches.add(t.number);
    visible.add(t.number);
    // 往上把每一層加進來，並展開
    let p = t.parent;
    const seen = new Set<number>();
    while (p !== null && by.has(p) && !seen.has(p)) {
      seen.add(p);
      visible.add(p);
      expand.add(p);
      p = by.get(p)!.parent;
    }
  }
  return { visible, matches, expand };
}
