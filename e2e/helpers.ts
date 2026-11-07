import { expect, type Page } from "@playwright/test";

export const PROJECT = "/#/p/demo/website";

export async function reset(page: Page, opts: { latency?: number } = {}) {
  await page.request.post("/__reset");
  if (opts.latency) await page.request.post(`/__latency?ms=${opts.latency}`);
}

export async function openProject(page: Page) {
  await page.goto(PROJECT);
  await expect(page.locator(".node-title").first()).toBeVisible();
}

/** 任務樹目前顯示的列；淡化的脈絡列用括號標示 */
export function rows(page: Page) {
  return page.$$eval(".node", (els) =>
    els.map((e) => {
      const t = e.querySelector(".node-title")!.textContent!;
      return e.classList.contains("context") ? `(${t})` : t;
    }),
  );
}

export const row = (page: Page, title: string) =>
  page.locator(".node", { has: page.locator(".node-title", { hasText: title }) }).first();

export async function state(page: Page) {
  const r = await page.request.get("/__state");
  return (await r.json()) as {
    repos: Record<string, { issues: { number: number; body: string; labels: string[]; state: string }[]; children: Record<string, number[]> }>;
  };
}

export async function issue(page: Page, n: number) {
  const s = await state(page);
  return s.repos["demo/website"].issues.find((i) => i.number === n)!;
}

export const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** 用 CDP 送出真實的觸控事件（Playwright 的 touchscreen 只有 tap） */
export async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (p: { x: number; y: number }) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from) });
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(p) });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
