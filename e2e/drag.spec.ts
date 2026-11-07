import { expect, test } from "@playwright/test";
import { center, issue, openProject, reset, row, rows, state, touchDrag } from "./helpers";

// 拖曳排序（#42）與手把（#54）
test.beforeEach(async ({ page }) => {
  await reset(page);
  await openProject(page);
});

test.describe("觸控", () => {
  test.skip(({ isMobile }) => !isMobile, "只在手機");

  test("手把常駐、夠大", async ({ page }) => {
    const grip = row(page, "整理專案文件").locator(".grip");
    const b = (await grip.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(36);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(Number(await grip.evaluate((e) => getComputedStyle(e).opacity))).toBeGreaterThan(0.3);
  });

  test("點手把不會開啟任務，點任務本身才會", async ({ page }) => {
    const g = center((await row(page, "整理專案文件").locator(".grip").boundingBox())!);
    await page.touchscreen.tap(g.x, g.y);
    await page.waitForTimeout(300);
    await expect(page.locator("aside.detail")).toHaveCount(0);
    await row(page, "整理專案文件").locator(".node-title").tap();
    await expect(page.locator("aside.detail")).toBeVisible();
  });

  test("在列上滑動不會變成拖曳", async ({ page }) => {
    const from = (await row(page, "整理專案文件").boundingBox())!;
    const to = (await row(page, "行銷活動").boundingBox())!;
    await touchDrag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: from.x + from.width / 2, y: to.y + 4 });
    await page.waitForTimeout(400);
    expect((await issue(page, 13)).body).not.toContain("rank");
  });

  test("用手把把第三項拖到第二項上方", async ({ page }) => {
    expect(await rows(page)).toEqual(["官網改版", "行銷活動", "整理專案文件", expect.stringContaining("非常非常長")]);
    const g = center((await row(page, "整理專案文件").locator(".grip").boundingBox())!);
    const t = (await row(page, "行銷活動").boundingBox())!;
    await touchDrag(page, g, { x: g.x + 20, y: t.y + 6 });
    await expect.poll(() => rows(page)).toEqual(["官網改版", "整理專案文件", "行銷活動", expect.stringContaining("非常非常長")]);
    await expect.poll(async () => (await issue(page, 13)).body).toContain('"rank":5.5');
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
  });
});

test.describe("滑鼠與鍵盤", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test("手把平常隱藏，hover 才出現", async ({ page }) => {
    const grip = row(page, "官網改版").locator(".grip");
    expect(Number(await grip.evaluate((e) => getComputedStyle(e).opacity))).toBe(0);
    await row(page, "官網改版").hover();
    expect(Number(await grip.evaluate((e) => getComputedStyle(e).opacity))).toBeGreaterThan(0);
  });

  test("拖曳時有放置線，放下後不會誤開任務", async ({ page }) => {
    await row(page, "官網改版").hover();
    const g = center((await row(page, "官網改版").locator(".grip").boundingBox())!);
    const t = (await row(page, "整理專案文件").boundingBox())!;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 10, g.y + 10, { steps: 3 });
    await page.mouse.move(g.x + 10, t.y + t.height - 4, { steps: 10 });
    await expect(page.locator(".node.drop-after")).toHaveCount(1);
    await expect(page.locator(".drag-ghost")).toHaveText("官網改版");
    await page.mouse.up();
    await expect.poll(() => rows(page)).toEqual(["行銷活動", "整理專案文件", "官網改版", expect.stringContaining("非常非常長")]);
    await expect(page.locator("aside.detail")).toHaveCount(0);
  });

  test("子任務拖曳改的是 GitHub 原生順序", async ({ page }) => {
    await row(page, "官網改版").locator(".twisty").click();
    await row(page, "後台 API").hover();
    const g = center((await row(page, "後台 API").locator(".grip").boundingBox())!);
    const t = (await row(page, "首頁設計").boundingBox())!;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, t.y + 4, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await state(page)).repos["demo/website"].children["1"]).toEqual([6, 2]);
  });

  test("手把上按上鍵移動一格", async ({ page }) => {
    await row(page, "行銷活動").locator(".grip").focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => rows(page)).toEqual(["行銷活動", "官網改版", "整理專案文件", expect.stringContaining("非常非常長")]);
  });

  test("Esc 取消拖曳", async ({ page }) => {
    await row(page, "整理專案文件").hover();
    const g = center((await row(page, "整理專案文件").locator(".grip").boundingBox())!);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x, g.y - 60, { steps: 6 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect((await issue(page, 13)).body).not.toContain("rank");
    await expect(page.locator(".drag-ghost")).toHaveCount(0);
  });
});
