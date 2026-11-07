import { expect, test } from "@playwright/test";
import { center, openProject, reset, row, rows } from "./helpers";

// 第一輪 QA 回報的問題（#56～#64），照 QA 的重現步驟寫成測試，避免再犯
const LONG = expect.stringContaining("非常非常長");

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test.describe("桌面", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test("#56 鍵盤可以連續移動，焦點留在同一個手把", async ({ page }) => {
    await openProject(page);
    const grip = row(page, "非常非常長").locator(".grip");
    await grip.focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => rows(page)).toEqual(["官網改版", "行銷活動", LONG, "整理專案文件"]);
    await expect(grip).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => rows(page)).toEqual(["官網改版", LONG, "行銷活動", "整理專案文件"]);
    await expect(grip).toBeFocused();
  });

  test("#57 篩選中鍵盤移動只和看得到的任務交換", async ({ page }) => {
    await openProject(page);
    await page.getByLabel("依分配人篩選").selectOption("ben");
    await expect(page.getByText(/符合 \d+ 項/)).toBeVisible();
    await row(page, "非常非常長").locator(".grip").focus();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await page.getByRole("button", { name: "清除篩選" }).click();
    await expect.poll(() => rows(page)).toEqual([LONG, "官網改版", "行銷活動", "整理專案文件"]);
  });

  test("#59 唯讀成員看得出不能改：沒有手把、不能新增、欄位停用，但可以留言", async ({ page }) => {
    await page.request.post("/__as?login=amy&role=read");
    await openProject(page);
    await expect(page.getByRole("note")).toContainText("只有讀取權限");
    await expect(page.locator(".grip")).toHaveCount(0);
    await expect(page.getByPlaceholder("新增任務…")).toHaveCount(0);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await expect(panel.getByLabel("狀態", { exact: true })).toBeDisabled();
    await expect(panel.getByLabel("父任務")).toBeDisabled();
    await expect(panel.getByRole("button", { name: "↑ 上移" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "編輯" })).toHaveCount(0);
    await expect(panel.getByPlaceholder(/寫下留言/)).toBeVisible();
  });

  test("#59 權限不足這類錯誤不提供重試", async ({ page }) => {
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13&status=403");
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("改狀態（#13）失敗");
    await expect(alert.getByRole("button", { name: "重試" })).toHaveCount(0);
  });

  test("#60 隱藏已完成時，搜尋會提醒已完成的沒有列入", async ({ page }) => {
    await openProject(page);
    await page.getByLabel("搜尋任務").fill("字體");
    await expect(page.locator(".empty")).toContainText("已完成的任務被隱藏了");
    await page.getByLabel("搜尋任務").fill("API");
    await expect(page.getByText("已完成的任務沒有列入搜尋")).toBeVisible();
    await page.locator(".filter-hint").getByRole("button", { name: "顯示已完成" }).click();
    await page.getByLabel("搜尋任務").fill("字體");
    await expect.poll(() => rows(page)).toContain("字體與色票");
  });

  test("#61 拖到最後一列下方的空白處＝移到最後", async ({ page }) => {
    await openProject(page);
    await row(page, "官網改版").hover();
    const g = center((await row(page, "官網改版").locator(".grip").boundingBox())!);
    const last = (await row(page, "非常非常長").boundingBox())!;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    await page.mouse.move(g.x + 10, g.y + 10, { steps: 3 });
    await page.mouse.move(g.x + 10, last.y + last.height + 15, { steps: 12 });
    await expect(page.locator(".drop-end")).toBeVisible();
    await page.mouse.up();
    await expect.poll(() => rows(page)).toEqual(["行銷活動", "整理專案文件", LONG, "官網改版"]);
  });

  test("#64 順序說明已更新", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    await expect(page.locator("aside.detail")).toContainText("也可以用列表左側的 ⋮⋮ 手把拖曳");
    await expect(page.locator("aside.detail")).not.toContainText("桌面版可直接在列表拖曳");
  });
});

test.describe("手機", () => {
  test.skip(({ isMobile }) => !isMobile, "只在手機");

  test("#58 深層任務的標題看得到", async ({ page }) => {
    await openProject(page);
    await row(page, "官網改版").locator(".twisty").tap();
    await row(page, "首頁設計").locator(".twisty").tap();
    await row(page, "後台 API").locator(".twisty").tap();
    for (const t of ["首頁設計", "Hero 主視覺", "文章列表 API"]) {
      const title = row(page, t).locator(".node-title");
      const w = (await title.boundingBox())!.width;
      // 標題至少有 9 個字的寬度，而且沒有被截斷
      expect(w, t).toBeGreaterThan(9 * 15);
      expect(await title.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), t).toBe(true);
    }
  });

  test("#62 同步失敗的訊息完整顯示，頂端列不變形", async ({ page }) => {
    await page.request.post("/__fail?times=1&method=PATCH");
    await openProject(page);
    await row(page, "官網改版").locator(".twisty").tap();
    await row(page, "後台 API").locator(".twisty").tap();
    await row(page, "文章列表 API").locator(".node-title").tap();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("模擬失敗（503）");
    const box = (await alert.boundingBox())!;
    const vw = page.viewportSize()!.width;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    expect(await alert.locator(".sync-msg").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    const logout = (await page.getByRole("link", { name: "登出" }).boundingBox())!;
    expect(logout.height).toBeLessThan(30);
  });
});
