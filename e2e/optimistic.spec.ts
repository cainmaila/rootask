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

// QA 對 #48 的回報（#66～#70）
test.describe("樂觀更新：QA 回報", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  /** 在 ms 毫秒內每 100ms 讀一次 */
  async function sample(page: import("@playwright/test").Page, ms: number, read: () => Promise<string>) {
    const seen: string[] = [];
    for (let t = 0; t < ms; t += 100) {
      seen.push(await read());
      await page.waitForTimeout(100);
    }
    return seen;
  }

  test("#66 同步中回到前景（整頁重讀），還沒寫完的修改不會跳回舊值", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__latency?ms=2500");
    await row(page, "整理專案文件").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中");
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const seen = await sample(page, 2500, () => row(page, "整理專案文件").locator(".pill").innerText());
    expect(seen.every((x) => x === "進行中"), seen.join(",")).toBe(true);
    await expect(page.getByText("✓ 已同步")).toBeVisible({ timeout: 6000 });
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中");
  });

  test("#66 同一張任務的另一個修改先完成，不會蓋掉還在寫的那個", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await page.request.post("/__latency?ms=1500");
    await panel.locator(".title-input").fill("整理專案文件 v2");
    await panel.locator(".title-input").blur();
    // 標題還在同步，狀態欄位鎖住；等標題寫完前，先用拖曳排序（另一個任務）製造重讀
    await expect(panel.getByLabel("狀態", { exact: true })).toBeDisabled();
    const seen = await sample(page, 1200, () => row(page, "整理專案文件").locator(".node-title").innerText());
    expect(seen.every((x) => x === "整理專案文件 v2"), seen.join(",")).toBe(true);
    await expect(panel.getByLabel("狀態", { exact: true })).toBeEnabled({ timeout: 5000 });
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await panel.locator(".title-input").fill("整理專案文件 v3");
    await panel.locator(".title-input").blur();
    const seen2 = await sample(page, 3500, async () =>
      [await row(page, "v3").locator(".pill").innerText().catch(() => "?"), await panel.locator(".title-input").inputValue()].join("/"),
    );
    // 狀態寫完後讀回來時，標題還沒寫完；反之亦然：兩個都不能跳回去
    expect(seen2.filter((x) => x !== "進行中/整理專案文件 v3"), seen2.join(",")).toEqual([]);
  });

  test("#67 接連兩個操作失敗：兩則錯誤都在；說明沒存到時內容放回編輯框", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.getByRole("button", { name: /加上說明/ }).click();
    await panel.locator("textarea").first().fill("很重要的說明");
    await panel.getByRole("button", { name: "儲存" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("更新說明（#13）失敗");
    await expect(panel.locator("textarea").first()).toHaveValue("很重要的說明");
    await expect(panel).toContainText("說明沒有存到");
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(alert).toContainText("改狀態（#13）失敗");
    await expect(alert).toContainText("更新說明（#13）失敗");
    // 關掉一則，另一則還在
    await alert.locator(".sync-row", { hasText: "改狀態" }).getByRole("button", { name: "關閉" }).click();
    await expect(alert).toContainText("更新說明（#13）失敗");
    await expect(alert).not.toContainText("改狀態");
    await alert.getByRole("button", { name: "重試" }).click();
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await expect(panel.getByRole("button", { name: "儲存" })).toHaveCount(0); // 編輯框關了
    await expect(panel.locator(".description")).toContainText("很重要的說明");
    await expect(panel).not.toContainText("說明沒有存到");
    await expect.poll(async () => (await (await page.request.get("/__state")).json()).repos["demo/website"].issues.find((i: { number: number }) => i.number === 13).body).toContain("很重要的說明");
  });

  test("#68 改狀態後，實際時間在同步完成後就出現", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__latency?ms=800");
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await expect(panel.locator(".actual")).toContainText("開始：—");
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(page.getByText("✓ 已同步")).toBeVisible({ timeout: 6000 });
    await expect(panel.locator(".actual")).not.toContainText("開始：—");
  });

  test("#69 子任務改成完成，父任務的完成數立刻變", async ({ page }) => {
    await openProject(page);
    await row(page, "官網改版").locator(".twisty").click();
    const before = await row(page, "官網改版").locator(".node-meta").innerText();
    const m = before.match(/(\d+)\/(\d+)/)!;
    await page.request.post("/__latency?ms=2500");
    await row(page, "首頁設計").locator(".node-title").click();
    await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("done");
    await expect(row(page, "官網改版").locator(".node-meta")).toContainText(`${Number(m[1]) + 1}/${m[2]}`, { timeout: 1000 });
  });

  test("#70 按重試時畫面先變，同步中狀態欄位鎖住", async ({ page }) => {
    await openProject(page);
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await row(page, "整理專案文件").locator(".node-title").click();
    const select = page.locator("aside.detail").getByLabel("狀態", { exact: true });
    await select.selectOption("doing");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("改狀態（#13）失敗");
    await expect(select).toHaveValue("todo");
    await page.request.post("/__latency?ms=2000");
    await alert.getByRole("button", { name: "重試" }).click();
    await expect(row(page, "整理專案文件").locator(".pill")).toHaveText("進行中", { timeout: 1000 });
    await expect(select).toBeDisabled();
    await expect(page.getByText("✓ 已同步")).toBeVisible({ timeout: 6000 });
    await expect(select).toBeEnabled();
  });
});

test.describe("樂觀更新：QA 回報（第二輪）", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("#71 桌面頁面往下捲、有多則錯誤時，任務詳情的關閉鈕不被蓋住", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 420 });
    await page.request.post("/__fail?times=3&method=PATCH");
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await panel.getByLabel("狀態", { exact: true }).selectOption("doing");
    await expect(page.getByRole("alert")).toContainText("改狀態");
    await panel.locator(".title-input").fill("新標題");
    await panel.locator(".title-input").blur();
    await expect(page.getByRole("alert")).toContainText("更新標題");
    await panel.getByRole("button", { name: "amy" }).click();
    await expect(page.getByRole("alert")).toContainText("更新分配人");
    // 把樹展開讓頁面夠長，再往下捲
    for (const t of ["官網改版", "行銷活動", "首頁設計", "後台 API"]) await row(page, t).locator(".twisty").click();
    await page.evaluate(() => window.scrollTo(0, 300));
    await panel.evaluate((el) => (el.scrollTop = 0)); // 面板自己的捲動回到最上面
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // 不讓 Playwright 自己捲動：直接看按鈕所在位置最上層是誰
    const close = panel.getByRole("button", { name: "關閉" });
    const hit = await close.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return r.y >= 0 && !!top && b.contains(top);
    });
    expect(hit).toBe(true);
    const box = (await close.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("alert").locator(".sync-row")).toHaveCount(3);
  });

  test("說明沒存到後切到別的任務再回來，草稿還在", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.getByRole("button", { name: /加上說明/ }).click();
    await panel.locator("textarea").first().fill("不能弄丟的說明");
    await panel.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByRole("alert")).toContainText("更新說明（#13）失敗");
    await page.getByRole("alert").getByRole("button", { name: "關閉" }).click();
    await row(page, "行銷活動").locator(".node-title").click();
    await row(page, "整理專案文件").locator(".node-title").click();
    await expect(panel.locator("textarea").first()).toHaveValue("不能弄丟的說明");
    await expect(panel).toContainText("說明沒有存到");
    await panel.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByText("✓ 已同步")).toBeVisible();
    await expect(panel.locator(".description")).toContainText("不能弄丟的說明");
  });

  test("說明沒存到後按取消：草稿清掉，頂端那則失敗也一起拿掉", async ({ page }) => {
    await openProject(page);
    await row(page, "整理專案文件").locator(".node-title").click();
    const panel = page.locator("aside.detail");
    await page.request.post("/__fail?times=1&method=PATCH&path=/issues/13");
    await panel.getByRole("button", { name: /加上說明/ }).click();
    await panel.locator("textarea").first().fill("後來不要了");
    await panel.getByRole("button", { name: "儲存" }).click();
    await expect(page.getByRole("alert")).toContainText("更新說明（#13）失敗");
    await panel.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(panel).not.toContainText("後來不要了");
  });
});
