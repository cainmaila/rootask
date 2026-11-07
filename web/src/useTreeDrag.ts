// 以手把拖曳排序（#54）。用 Pointer Events 自己實作，滑鼠與觸控共用同一套：
// - 只有手把能開始拖曳；列的其他地方點了是開啟、滑動是捲動，不會誤觸
// - 拖曳時有跟著指標的影像、放置線，接近畫面上下緣自動捲動
// 之後看板（#43）也沿用。
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

/** 自動捲動速度：負值往上、正值往下、0 不捲 */
export function scrollSpeed(y: number, viewport: number): number {
  if (y < EDGE) return -Math.ceil(((EDGE - Math.max(y, 0)) / EDGE) * MAX_SPEED);
  if (y > viewport - EDGE) return Math.ceil(((y - (viewport - EDGE)) / EDGE) * MAX_SPEED);
  return 0;
}

interface Options {
  canDrop: (moving: number, target: number) => boolean;
  drop: (moving: number, target: number, position: DropPosition) => void;
  titleOf: (n: number) => string;
  /** 指標不在任何一列上時的放置目標（例如清單最下方的空白處） */
  fallback?: (moving: number, x: number, y: number) => Over | null;
}

export function useTreeDrag({ canDrop, drop, titleOf, fallback }: Options) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<Over | null>(null);

  // 最新的 callback 放 ref，事件處理器不必重新綁定
  const opts = useRef({ canDrop, drop, titleOf, fallback });
  opts.current = { canDrop, drop, titleOf, fallback };

  type St = {
    n: number;
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    over: Over | null;
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

    /** 依指標位置找出放置目標 */
    function hitTest() {
      const st = s.current!;
      const el = document.elementFromPoint(st.x, st.y)?.closest<HTMLElement>("[data-node]");
      const target = el ? Number(el.dataset.node) : NaN;
      let next: Over | null = null;
      if (el && target !== st.n && opts.current.canDrop(st.n, target)) {
        next = { n: target, position: positionFor(el.getBoundingClientRect(), st.y) };
      }
      if (!el) next = opts.current.fallback?.(st.n, st.x, st.y) ?? null;
      if (next?.n !== st.over?.n || next?.position !== st.over?.position || next?.end !== st.over?.end) {
        st.over = next;
        setOver(next);
      }
    }

    function tick() {
      const st = s.current;
      if (!st?.active) return;
      const v = scrollSpeed(st.y, window.innerHeight);
      if (v) {
        window.scrollBy(0, v);
        hitTest(); // 內容捲動了，指標下的列也變了
      }
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
      if (active && o) opts.current.drop(n, o.n, o.position);
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
