import { expect, test } from "@playwright/test";
import { openProject, reset, row, rows } from "./helpers";

// 樂觀更新（#48）：操作先在畫面上生效，寫回失敗才還原；之後只重新讀取受影響的任務
const LONG = expect.stringContaining("非常非常長");

test.describe("樂觀更新", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("改狀態：GitHub 還沒回應，畫面就已經改好", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__latency?ms=2000");
    await row(page, "整理專案文件").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
    // 寫入要 2 秒，畫面要在那之前就變
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中", { timeout: 1000 });
    await expect(page.getByText("同步中…")).toBeVisible();
    await expect(page.getByText("✓ 已同步")).toBeVisible({ timeout: 6000 });
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中");
  });

  test("調整順序：立刻移動，失敗時移回原位", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__latency?ms=1500");
    await page.request.post("/__fail?times=1&method=PATCH");
    await row(page, "整理專案文件").locator(".grip").focus();
    await page.keyboard.press("ArrowUp");
    await expect
      .poll(() => rows(page), { timeout: 1000 })
      .toEqual(["官網改版", "整理專案文件", "行銷活動", LONG]);
    await expect(page.getByRole("alert")).toContainText("調整順序（#13）失敗", { timeout: 6000 });
    await expect.poll(() => rows(page)).toEqual(["官網改版", "行銷活動", "整理專案文件", LONG]);
  });

  test("改狀態失敗：還原成原本的狀態，按重試就成功", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await row(page, "整理專案文件").locator(".node-title").click();
    const select = page.locator("aside.detail").getByLabel("狀態", { exact: true });
    await select.selectOption("doing");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("改狀態（#13）失敗");
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("待處理");
    await expect(select).toHaveValue("todo");
    await alert.getByRole("button", { name: "重試" }).click();
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中");
  });

  test("改標題、分配人失敗時，欄位也還原", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.locator(".title-input").fill("改壞的標題");
    await panel.locator(".title-input").blur();
    await expect(page.getByRole("alert")).toContainText("更新標題（#13）失敗");
    await expect(panel.locator(".title-input")).toHaveValue("整理專案文件");
    await expect(row(page, "整理專案文件")).toBeVisible();

    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.getByRole("button", { name: "amy" }).click();
    await expect(page.getByRole("alert")).toContainText("更新分配人（#13）失敗");
    await expect(panel.getByRole("button", { name: "amy" })).not.toHaveClass(/\bon\b/);
  });

  test("寫回後只重新讀取受影響的任務，不重讀設定、成員、權限", async ({ page }) => {
    await openProject(page);
    await page.request.get("/__requests"); // 清掉進入專案時的請求
    await row(page, "整理專案文件").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    const reqs = (await (await page.request.get("/__requests")).json()) as string[];
    // 打開面板時讀留言與事件紀錄；之後是 1 個寫入＋1 個 GraphQL 查詢
    const after = reqs.filter((r) => !/\/comments|\/events/.test(r));
    expect(after).toEqual(["PATCH /repos/demo/website/issues/13", "POST /graphql"]);
  });

  test("新增任務只讀取新任務，不重讀整棵樹", async ({ page }) => {
    await openProject(page);
    await page.request.get("/__requests");
    await page.getByPlaceholder("新增任務…").fill("新的任務");
    await page.getByRole("button", { name: "新增", exact: true }).click();
    await expect.poll(() => rows(page)).toContain("新的任務");
    const reqs = (await (await page.request.get("/__requests")).json()) as string[];
    expect(reqs).toEqual(["POST /repos/demo/website/issues", "POST /graphql"]);
  });

  test("換父任務：立刻搬過去", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__latency?ms=2000");
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    const opt = panel.getByLabel("父任務").locator("option", { hasText: "行銷活動" });
    await panel.getByLabel("父任務").selectOption((await opt.getAttribute("value"))!);
    // 「行銷活動」底下多一個子任務（還沒展開也看得到數字）
    await expect(row(page, "行銷活動")).toContainText("/2", { timeout: 1000 });
    await expect.poll(() => rows(page), { timeout: 1000 }).not.toContain("整理專案文件");
    await expect(page.getByText("✓ 已同步")).toBeVisible({ timeout: 6000 });
  });
});
