// 以手把拖曳（#54）。用 Pointer Events 自己實作，滑鼠與觸控共用同一套：
// - 只有手把能開始拖曳；列的其他地方點了是開啟、滑動是捲動，不會誤觸
// - 拖曳時有跟著指標的影像、放置標示，接近畫面上下緣（與橫向捲動容器左右緣）自動捲動
// 任務樹（useTreeDrag）與看板（#83、#84）共用 usePointerDrag，只差在「指標下面是什麼」。
import { useEffect, useMemo, useRef, useState } from "react";

export type DropPosition = "before" | "after";
export interface Over {
  n: number;
  position: DropPosition;
  /** 放在整個清單的最後（指標在最後一列下方的空白處，#61） */
  end?: boolean;
}

/** 指標移動超過這個距離才算開始拖曳（避免只是按一下手把） */
export const DRAG_THRESHOLD = 4;
/** 距離畫面上下緣多近開始自動捲動 */
export const EDGE = 64;
/** 自動捲動每格最快幾 px */
export const MAX_SPEED = 18;

/** 指標在列的上半或下半 */
export function positionFor(rect: { top: number; height: number }, y: number): DropPosition {
  return y < rect.top + rect.height / 2 ? "before" : "after";
}

/** 自動捲動速度：負值往上（左）、正值往下（右）、0 不捲；start／end 是可視範圍的兩端 */
export function scrollSpeed(p: number, end: number, start = 0): number {
  if (p < start + EDGE) return -Math.ceil(((start + EDGE - Math.max(p, start)) / EDGE) * MAX_SPEED);
  if (p > end - EDGE) return Math.ceil(((Math.min(p, end) - (end - EDGE)) / EDGE) * MAX_SPEED);
  return 0;
}

export interface PointerDragOptions<T> {
  /** 指標在 (x, y) 時的放置目標；null 表示不能放 */
  hitTest: (moving: number, x: number, y: number) => T | null;
  /** 兩個目標是否相同（相同就不必重繪） */
  same: (a: T | null, b: T | null) => boolean;
  drop: (moving: number, target: T) => void;
  titleOf: (n: number) => string;
  /** 會橫向捲動的容器（看板）：指標接近它的左右緣時跟著捲 */
  scrollX?: () => HTMLElement | null;
}

export function usePointerDrag<T>(options: PointerDragOptions<T>) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<T | null>(null);

  // 最新的 callback 放 ref，事件處理器不必重新綁定
  const opts = useRef(options);
  opts.current = options;

  type St = {
    n: number;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    over: T | null;
    ghost: HTMLDivElement | null;
    raf: number;
    handle: HTMLElement;
  };

  // 事件處理器只建立一次（removeEventListener 需要同一個函式）
  const { start, cleanup } = useMemo(() => {
    const s: { current: St | null } = { current: null };

    const cleanup = () => {
      const st = s.current;
      if (!st) return;
      cancelAnimationFrame(st.raf);
      st.ghost?.remove();
      try {
        st.handle.releasePointerCapture(st.pointerId);
      } catch {
        /* 已釋放 */
      }
      document.body.classList.remove("tree-dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      s.current = null;
      setDragging(null);
      setOver(null);
    };

    function hitTest() {
      const st = s.current!;
      const next = opts.current.hitTest(st.n, st.x, st.y);
      if (!opts.current.same(next, st.over)) {
        st.over = next;
        setOver(next);
      }
    }

    function tick() {
      const st = s.current;
      if (!st?.active) return;
      let moved = false;
      const v = scrollSpeed(st.y, window.innerHeight);
      if (v) {
        window.scrollBy(0, v);
        moved = true;
      }
      const box = opts.current.scrollX?.();
      if (box) {
        const r = box.getBoundingClientRect();
        // 只在指標位於容器的高度範圍內才橫向捲
        if (st.y >= r.top && st.y <= r.bottom) {
          const h = scrollSpeed(st.x, r.right, r.left);
          if (h) {
            box.scrollLeft += h;
            moved = true;
          }
        }
      }
      if (moved) hitTest(); // 內容捲動了，指標下的目標也變了
      st.raf = requestAnimationFrame(tick);
    }

    function activate() {
      const st = s.current!;
      st.active = true;
      const g = document.createElement("div");
      g.className = "drag-ghost";
      g.textContent = opts.current.titleOf(st.n);
      document.body.appendChild(g);
      st.ghost = g;
      document.body.classList.add("tree-dragging");
      setDragging(st.n);
      st.raf = requestAnimationFrame(tick);
    }

    function onMove(e: PointerEvent) {
      const st = s.current;
      if (!st || e.pointerId !== st.pointerId) return;
      st.x = e.clientX;
      st.y = e.clientY;
      if (!st.active) {
        if (Math.hypot(st.x - st.startX, st.y - st.startY) < DRAG_THRESHOLD) return;
        activate();
      }
      e.preventDefault();
      st.ghost!.style.transform = `translate(${st.x + 12}px, ${st.y - 18}px)`;
      hitTest();
    }

    function onUp(e: PointerEvent) {
      const st = s.current;
      if (!st || e.pointerId !== st.pointerId) return;
      const { active, over: o, n } = st;
      cleanup();
      if (active && o !== null) opts.current.drop(n, o);
    }

    function onCancel() {
      cleanup();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") cleanup();
    }

    /** 手把的 onPointerDown */
    const start = (n: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || s.current) return;
      e.preventDefault(); // 不要選取文字、不要觸發觸控的長按選單
      const handle = e.currentTarget;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* 部分瀏覽器不支援 */
      }
      s.current = {
        n,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        active: false,
        over: null,
        ghost: null,
        raf: 0,
        handle,
      };
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey);
    };

    return { start, cleanup };
  }, []);

  // 離開頁面時收拾
  useEffect(() => cleanup, [cleanup]);

  return { dragging, over, start };
}

interface TreeOptions {
  canDrop: (moving: number, target: number) => boolean;
  drop: (moving: number, target: number, position: DropPosition) => void;
  titleOf: (n: number) => string;
  /** 指標不在任何一列上時的放置目標（例如清單最下方的空白處） */
  fallback?: (moving: number, x: number, y: number) => Over | null;
}

/** 任務樹：放在某一列的前或後 */
export function useTreeDrag({ canDrop, drop, titleOf, fallback }: TreeOptions) {
  return usePointerDrag<Over>({
    hitTest: (moving, x, y) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-node]");
      if (!el) return fallback?.(moving, x, y) ?? null;
      const target = Number(el.dataset.node);
      if (target === moving || !canDrop(moving, target)) return null;
      return { n: target, position: positionFor(el.getBoundingClientRect(), y) };
    },
    same: (a, b) => a?.n === b?.n && a?.position === b?.position && a?.end === b?.end,
    drop: (moving, o) => drop(moving, o.n, o.position),
    titleOf,
  });
}
