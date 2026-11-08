import { expect, test, type Page } from "@playwright/test";
import { center, reset, touchDrag } from "./helpers";

// 看板（#43、#82）：欄位＝自訂狀態，卡片＝任務，欄內照任務樹順序
const BOARD = "/#/p/demo/website/board";

const col = (page: Page, name: string) => page.locator(".board-col", { has: page.locator(".board-col-head", { hasText: name }) });
const cards = (page: Page, name: string) => col(page, name).locator(".board-title").allInnerTexts();
const card = (page: Page, title: string) => page.locator(".board-card", { has: page.locator(".board-title", { hasText: title }) }).first();

async function openBoard(page: Page) {
  await page.goto(BOARD);
  await expect(page.locator(".board-card").first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("從分頁切到看板，網址記住目前的視圖", async ({ page }) => {
  await page.goto("/#/p/demo/website");
  await page.getByRole("button", { name: "看板" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-col")).toHaveCount(5);
  await page.reload();
  await expect(page.locator(".board-card").first()).toBeVisible();
  await page.getByRole("button", { name: "任務樹" }).click();
  await expect(page.locator(".node-title").first()).toBeVisible();
});

test("每個狀態一欄，欄內照任務樹的順序，卡片顯示上層任務", async ({ page }) => {
  await openBoard(page);
  expect(await page.locator(".board-col-head .pill").allInnerTexts()).toEqual(["待處理", "進行中", "待審核", "完成", "放棄"]);
  expect(await cards(page, "進行中")).toEqual(["官網改版", "首頁設計", "後台 API"]);
  const todo = await cards(page, "待處理");
  expect(todo.slice(0, 3)).toEqual(["Hero 主視覺", "文章列表 API", "上傳圖片 API"]);
  await expect(card(page, "Hero 主視覺").locator(".board-crumb")).toHaveText("官網改版 › 首頁設計");
  await expect(col(page, "進行中").locator(".board-col-head")).toContainText("3");
});

test("只看最底層任務：有子任務的卡片不顯示，重新整理後還記得", async ({ page }) => {
  await openBoard(page);
  await page.getByText("只看最底層任務").click();
  expect(await cards(page, "進行中")).toEqual([]);
  expect(await cards(page, "待處理")).not.toContain("行銷活動");
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "只看最底層任務" })).toBeChecked();
  expect(await cards(page, "進行中")).toEqual([]);
});

test("和任務樹共用篩選：只放符合的卡片", async ({ page }) => {
  await openBoard(page);
  await page.getByLabel("依分配人篩選").selectOption("ben");
  for (const t of await page.locator(".board-card").all()) {
    await expect(t.locator('img[alt="ben"]')).toBeVisible();
  }
  await page.getByLabel("搜尋任務").fill("不存在的字");
  await expect(page.locator(".board-card")).toHaveCount(0);
  await expect(page.locator(".board-tools")).toContainText("沒有符合的任務");
});

test("完成欄照「隱藏已完成」設定；改成完成的卡片照 #63 留著", async ({ page }) => {
  await openBoard(page);
  expect(await cards(page, "完成")).toEqual([]);
  await card(page, "上傳圖片 API").locator(".board-card-main").click();
  await page.locator("aside.detail").getByLabel("狀態", { exact: true }).selectOption("done");
  await expect.poll(() => cards(page, "完成")).toEqual(["上傳圖片 API"]);
  await page.locator("aside.detail").getByRole("button", { name: "關閉" }).click(); // 手機上面板會蓋住篩選列
  await page.getByRole("checkbox", { name: /顯示已完成/ }).click();
  await expect.poll(async () => (await cards(page, "完成")).length).toBeGreaterThan(1);
});

test("點卡片開任務詳情；展開成整頁再關閉會回到看板", async ({ page }) => {
  await openBoard(page);
  await card(page, "Hero 主視覺").locator(".board-card-main").click();
  const panel = page.locator("aside.detail");
  await expect(panel.locator(".title-input")).toHaveValue("Hero 主視覺");
  await panel.getByRole("button", { name: "展開成整頁" }).click();
  await expect(page).toHaveURL(/\/board\/t\/\d+$/);
  await page.getByRole("button", { name: "回到任務列表" }).click();
  await expect(page).toHaveURL(/\/board$/);
  await expect(page.locator(".board-card").first()).toBeVisible();
});

test("別人改了狀態，卡片自動換欄（多人同步）", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("rootask:poll-ms", "400"));
  await openBoard(page);
  await page.request.patch("/api/gh/repos/demo/website/issues/13", { data: { labels: ["status:review"] } });
  await expect.poll(() => cards(page, "待審核"), { timeout: 5000 }).toContain("整理專案文件");
});

test("手機：欄位在看板裡橫向滑動，頁面本身不會左右捲", async ({ page, isMobile }) => {
  test.skip(!isMobile, "只在手機");
  await openBoard(page);
  const board = page.locator(".board");
  expect(await board.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await card(page, "Hero 主視覺").locator(".board-card-main").tap();
  await expect(page.locator("aside.detail .title-input")).toHaveValue("Hero 主視覺");
});

// ---------- 拖曳（#83 換欄＝改狀態、#84 欄內排序） ----------

async function serverIssue(page: Page, title: string) {
  const st = await (await page.request.get("/__state")).json();
  const r = st.repos["demo/website"];
  const i = (r.issues as { number: number; title: string; labels: string[]; parent: number | null }[]).find((x) => x.title === title)!;
  return { ...i, siblings: (r.children[String(i.parent)] ?? []) as number[] };
}

/** 用滑鼠拖卡片的手把到某個位置 */
async function mouseDrag(page: Page, title: string, to: { x: number; y: number }, release = true) {
  await card(page, title).hover();
  const g = center((await card(page, title).locator(".grip").boundingBox())!);
  await page.mouse.move(g.x, g.y);
  await page.mouse.down();
  await page.mouse.move(g.x + 10, g.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (release) await page.mouse.up();
}

const colCenter = async (page: Page, name: string) => {
  const b = (await col(page, name).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height - 20, 90) };
};

test.describe("看板拖曳（桌面）", () => {
  test.skip(({ isMobile }) => !!isMobile, "只在桌面");

  test("#83 拖到別欄＝改狀態：畫面先換欄，GitHub 上的標籤跟著改", async ({ page }) => {
    await openBoard(page);
    await mouseDrag(page, "上傳圖片 API", await colCenter(page, "進行中"));
    await expect.poll(() => cards(page, "進行中")).toContain("上傳圖片 API");
    await expect.poll(async () => (await serverIssue(page, "上傳圖片 API")).labels).toContain("status:doing");
  });

  test("#83 轉換規則不允許的欄位：拖曳中淡化並標示，放下也不會改", async ({ page }) => {
    await page.request.post("/__as?login=amy&role=write");
    await openBoard(page);
    await mouseDrag(page, "導覽列互動", await colCenter(page, "完成"), false);
    await expect(col(page, "完成")).toHaveClass(/drop-no/);
    await expect(col(page, "完成")).toContainText("轉換規則不允許");
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await cards(page, "待審核")).toContain("導覽列互動");
    expect((await serverIssue(page, "導覽列互動")).labels).toContain("status:review");
  });

  test("#84 同一欄、同一個父任務：上下拖曳＝在任務樹中移動", async ({ page }) => {
    await openBoard(page);
    const target = (await card(page, "文章列表 API").boundingBox())!;
    await mouseDrag(page, "上傳圖片 API", { x: target.x + target.width / 2, y: target.y + 6 });
    const todo = await cards(page, "待處理");
    expect(todo.indexOf("上傳圖片 API")).toBeLessThan(todo.indexOf("文章列表 API"));
    const up = await serverIssue(page, "上傳圖片 API");
    const art = await serverIssue(page, "文章列表 API");
    await expect.poll(async () => {
      const sibs = (await serverIssue(page, "上傳圖片 API")).siblings;
      return sibs.indexOf(up.number) < sibs.indexOf(art.number);
    }).toBe(true);
    // 任務樹的順序也跟著變（共用同一個順序）
    await page.getByRole("button", { name: "任務樹" }).click();
    await page.locator(".node", { has: page.locator(".node-title", { hasText: "官網改版" }) }).first().locator(".twisty").click();
    await page.locator(".node", { has: page.locator(".node-title", { hasText: "後台 API" }) }).first().locator(".twisty").click();
    const tree = await page.locator(".node-title").allInnerTexts();
    expect(tree.indexOf("上傳圖片 API")).toBeLessThan(tree.indexOf("文章列表 API"));
  });

  test("#84 不同父任務的卡片不能互換：標示提示，放下不改", async ({ page }) => {
    await openBoard(page);
    const before = await cards(page, "待處理");
    const target = (await card(page, "Hero 主視覺").boundingBox())!;
    await mouseDrag(page, "上傳圖片 API", { x: target.x + target.width / 2, y: target.y + 6 }, false);
    await expect(card(page, "Hero 主視覺")).toHaveClass(/drop-no/);
    await expect(card(page, "Hero 主視覺")).toHaveAttribute("data-hint", "不同父任務，不能互換位置");
    await page.mouse.up();
    await page.waitForTimeout(400);
    expect(await cards(page, "待處理")).toEqual(before);
  });

  test("鍵盤：左右換欄、上下在同一個父任務的卡片間移動", async ({ page }) => {
    await openBoard(page);
    const grip = card(page, "上傳圖片 API").locator(".grip");
    await grip.focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(async () => {
      const todo = await cards(page, "待處理");
      return todo.indexOf("上傳圖片 API") < todo.indexOf("文章列表 API");
    }).toBe(true);
    await expect(card(page, "上傳圖片 API")).not.toHaveClass(/syncing/);
    await card(page, "上傳圖片 API").locator(".grip").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cards(page, "進行中")).toContain("上傳圖片 API");
  });

  test("唯讀成員沒有手把；triage 可以換欄但不能在欄內排序", async ({ page }) => {
    await page.request.post("/__as?login=amy&role=read");
    await openBoard(page);
    await expect(page.locator(".board-card .grip")).toHaveCount(0);
    await page.request.post("/__as?login=amy&role=triage");
    await page.reload();
    await expect(page.locator(".board-card .grip").first()).toBeAttached();
    const before = await cards(page, "待處理");
    await card(page, "上傳圖片 API").locator(".grip").focus();
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(400);
    expect(await cards(page, "待處理")).toEqual(before);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cards(page, "進行中")).toContain("上傳圖片 API");
  });
});

test("#83 手機：用手把觸控拖到別欄", async ({ page, isMobile }) => {
  test.skip(!isMobile, "只在手機");
  await openBoard(page);
  // 先把「進行中」欄捲進畫面一半，拖過去
  const g = center((await card(page, "Hero 主視覺").locator(".grip").boundingBox())!);
  const vw = page.viewportSize()!.width;
  await touchDrag(page, g, { x: vw - 20, y: g.y + 40 }, 30);
  await expect.poll(async () => (await serverIssue(page, "Hero 主視覺")).labels, { timeout: 5000 }).toContain("status:doing");
});

// ---------- QA 回報（#87～#93） ----------
test.describe("看板：QA 回報", () => {
  test("#87 拖到看板右緣會橫向自動捲動", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 700 });
    await openBoard(page);
    const board = page.locator(".board");
    expect(await board.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    const bb = (await board.boundingBox())!;
    await mouseDrag(page, "Hero 主視覺", { x: bb.x + bb.width - 8, y: bb.y + 120 }, false);
    await page.waitForTimeout(1200);
    expect(await board.evaluate((e) => e.scrollLeft)).toBeGreaterThan(100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
  });

  test("#88 鍵盤左右換欄後焦點還在手把，可以連按", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "只在桌面");
    await openBoard(page);
    await card(page, "上傳圖片 API").locator(".grip").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cards(page, "進行中")).toContain("上傳圖片 API");
    await expect(card(page, "上傳圖片 API").locator(".grip")).toBeFocused();
    await expect(card(page, "上傳圖片 API")).not.toHaveClass(/syncing/);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cards(page, "待審核")).toContain("上傳圖片 API");
    await expect(card(page, "上傳圖片 API").locator(".grip")).toBeFocused();
  });

  test("#89 triage 在欄內拖曳時，提示說的是權限", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "只在桌面");
    await page.request.post("/__as?login=amy&role=triage");
    await openBoard(page);
    const target = (await card(page, "文章列表 API").boundingBox())!;
    await mouseDrag(page, "上傳圖片 API", { x: target.x + target.width / 2, y: target.y + 6 }, false);
    await expect(card(page, "文章列表 API")).toHaveAttribute("data-hint", "你沒有調整順序的權限，只能換欄");
    await page.mouse.up();
    await expect(card(page, "上傳圖片 API").locator(".grip")).toHaveAttribute("aria-label", /換欄（改狀態），也可以用左右鍵/);
  });

  test("#90 隱藏已完成時，完成欄說明並可以直接顯示；搜尋時也提醒", async ({ page }) => {
    await openBoard(page);
    const doneCol = col(page, "完成");
    await expect(doneCol).toContainText("已完成的任務被隱藏了");
    await page.getByLabel("搜尋任務").fill("字體");
    await expect(page.locator(".board-tools")).toContainText("已完成的任務沒有列入搜尋");
    await page.getByLabel("搜尋任務").fill("");
    await doneCol.getByRole("button", { name: "顯示已完成" }).click();
    await expect.poll(async () => (await cards(page, "完成")).length).toBeGreaterThan(0);
  });

  test("#91 手機：從整頁任務回到看板，不會蓋上詳情抽屜，捲動位置還在", async ({ page, isMobile }) => {
    test.skip(!isMobile, "只在手機");
    await openBoard(page);
    await page.locator(".board").evaluate((e) => (e.scrollLeft = 300));
    await card(page, "官網改版").locator(".board-card-main").tap();
    await page.locator("aside.detail").getByRole("button", { name: "展開成整頁" }).tap();
    await expect(page).toHaveURL(/\/board\/t\/\d+$/);
    await page.getByRole("button", { name: "回到任務列表" }).tap();
    await expect(page.locator(".board-card").first()).toBeVisible();
    await expect(page.locator("aside.detail")).toHaveCount(0);
    await expect.poll(() => page.locator(".board").evaluate((e) => e.scrollLeft)).toBeGreaterThan(200);
  });

  test("#92 拖到較短欄位下方的空白處也能換欄", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "只在桌面");
    await openBoard(page);
    const c = (await col(page, "待審核").boundingBox())!;
    const lastCard = (await col(page, "待審核").locator(".board-card").last().boundingBox())!;
    // 「待審核」只有一張卡，欄位和最長的欄一樣高；放在卡片下方很遠的空白處
    expect(c.y + c.height).toBeGreaterThan(lastCard.y + lastCard.height + 150);
    // 放在卡片下方的空白（畫面範圍內）
    const vh = page.viewportSize()!.height;
    const y = Math.min(c.y + c.height - 30, vh - 40);
    expect(y).toBeGreaterThan(lastCard.y + lastCard.height + 60);
    await mouseDrag(page, "上傳圖片 API", { x: c.x + c.width / 2, y });
    await expect.poll(() => cards(page, "待審核")).toContain("上傳圖片 API");
  });

  test("#93 鍵盤只移到隔壁欄；隔壁不允許就不動並說明", async ({ page, isMobile }) => {
    test.skip(!!isMobile, "只在桌面");
    await page.request.post("/__as?login=amy&role=write");
    await openBoard(page);
    await card(page, "導覽列互動").locator(".grip").focus();
    await page.keyboard.press("ArrowRight");
    await expect(card(page, "導覽列互動").getByRole("status")).toHaveText("轉換規則不允許改成「完成」");
    await page.waitForTimeout(400);
    expect(await cards(page, "待審核")).toContain("導覽列互動");
    expect(await cards(page, "放棄")).not.toContain("導覽列互動");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => cards(page, "進行中")).toContain("導覽列互動");
  });
});
