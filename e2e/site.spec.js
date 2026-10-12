import { test, expect } from "@playwright/test";

test("folders show immediate child cards and sidebar labels follow the active tab", async ({ page }, testInfo) => {
  const documents = [
    ["policy", "0. 공통 데이터 정의/01. 회원", "01. 회원"],
    ["policy", "0. 공통 데이터 정의/02. 상품", "02. 상품"],
    ["policy", "0. 공통 데이터 정의/상세/01. 가격", "01. 가격"],
    ["policy", "0. 공통 데이터 정의/상세/02. 주문", "02. 주문"],
    ["api", "소개", "API 소개"],
  ].map(([tab, path, title]) => ({
    id: `${tab}/${path}`, tab, path: `${path}.md`, title,
    html: `<h1>${title}</h1><h2 id="details">상세 내용</h2>`,
    toc: [{ title: "상세 내용", level: 2, anchor: "details" }],
    sections: [],
  }));
  await page.route("**/site.json", (route) => route.fulfill({ json: {
    title: "pharmaresearch",
    tabs: [{ slug: "policy", title: "정책" }, { slug: "api", title: "API 문서" }],
    documents,
  } }));
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("./");
  await expect(page.locator(".sidebar .eyebrow")).toHaveText("정책");
  const folder = page.locator("#documents summary a").getByText("0. 공통 데이터 정의", { exact: true });
  await folder.click();
  await expect(page.locator("article h1")).toHaveText("0. 공통 데이터 정의");
  await expect(folder).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".folder-cards a")).toHaveText(["01. 회원", "02. 상품", "상세"]);
  await expect(page.locator(".toc")).toBeHidden();
  await expect(page.locator("#pagination")).toBeHidden();
  await page.reload();
  await expect(page.locator("article h1")).toHaveText("0. 공통 데이터 정의");
  await page.screenshot({ path: testInfo.outputPath("folder-desktop.png") });
  await page.locator(".folder-cards").getByRole("link", { name: "상세", exact: true }).click();
  await expect(page.locator(".folder-cards a")).toHaveText(["01. 가격", "02. 주문"]);
  await expect(page.locator("#breadcrumb a")).toHaveText(["정책", "0. 공통 데이터 정의", "상세"]);
  await expect(page.locator("#breadcrumb a").nth(1)).toHaveAttribute("href", `#/${encodeURIComponent("policy/0. 공통 데이터 정의/")}`);
  await expect(page.locator("#breadcrumb a").last()).toHaveAttribute("aria-current", "page");
  await page.locator(".folder-cards").getByRole("link", { name: "01. 가격", exact: true }).click();
  await expect(page.locator("article h1")).toHaveText("01. 가격");
  await expect(page.locator("#breadcrumb a")).toHaveText(["정책", "0. 공통 데이터 정의", "상세", "01. 가격"]);
  await page.locator("#breadcrumb a").getByText("상세", { exact: true }).click();
  await expect(page.locator("article h1")).toHaveText("상세");
  await page.locator(".folder-cards").getByRole("link", { name: "01. 가격", exact: true }).click();
  await expect(page.locator(".toc")).toBeVisible();
  await expect(page.locator("#pagination")).toBeVisible();
  await page.goBack();
  await expect(page.locator("article h1")).toHaveText("상세");
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = page.locator(".folder-cards a");
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("folder-mobile.png") });
  await page.locator("#tabs").getByRole("link", { name: "API 문서" }).click();
  await expect(page.locator(".sidebar .eyebrow")).toHaveText("API 문서");
  await expect(page.locator("article h1")).toHaveText("API 소개");
});

test("tabs, relative links, Korean heading deep links and refresh work under a hosting subpath", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator("article h1")).toHaveText("팀의 지식을 한곳에");
  await expect(page.locator("#breadcrumb a")).toHaveText(["시작하기", "01-introduction"]);
  await page
    .getByRole("navigation", { name: "문서 탭" })
    .getByRole("link", { name: "레퍼런스" })
    .click();
  await expect(page.locator("article h1")).toHaveText("설정 레퍼런스");
  await page
    .getByRole("navigation", { name: "문서 탭" })
    .getByRole("link", { name: "시작하기" })
    .click();
  await page
    .locator("article")
    .getByRole("link", { name: "작성 가이드" })
    .click();
  await expect(page.locator("article h1")).toHaveText("문서 작성 가이드");
  await page
    .locator("article")
    .getByRole("link", { name: "설정 레퍼런스" })
    .click();
  await expect(page).toHaveURL(/%ED%83%AD-%EC%84%A4%EC%A0%95/);
  await page.reload();
  await expect(page.locator("article h1")).toHaveText("설정 레퍼런스");
  await expect(page.locator("#tabs [aria-current]")).toHaveText("레퍼런스");
  expect(errors).toEqual([]);
});

test("global Korean search locates a section and highlights matching content", async ({
  page,
}) => {
  await page.goto("./");
  await page.locator("#open-search").click();
  await page.getByRole("searchbox", { name: "전체 문서 검색" }).fill("산출물");
  await expect(page.locator("#results .result")).toHaveCount(1);
  await expect(page.locator("#results .result strong")).toHaveText("용어 사전");
  await page.locator("#global-search").press("ArrowDown");
  await expect(page.locator("#results .result")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#search-dialog")).not.toBeVisible();
  await expect(page.locator("article mark")).toHaveText("산출물");
  await expect(page.locator("#page-search")).toHaveCount(0);
  await expect(page).toHaveURL(/%EC%9A%A9%EC%96%B4-%EC%82%AC%EC%A0%84/);
  await page.locator("#open-search").click();
  await page.locator("#global-search").fill("존재하지않는검색어");
  await expect(page.locator("#results .result")).toHaveCount(0);
  await expect(page.locator("#search-count")).toHaveText(
    "일치하는 내용이 없습니다.",
  );
  // Search inputs consume the first Escape to clear their value in Chromium.
  await page.locator("#global-search").fill("");
  await page.keyboard.press("Escape");
  await expect(page.locator("#search-dialog")).not.toBeVisible();
});

test("table searches are automatic and keep filters independent", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".document-find")).toHaveCount(0);
  await expect(page.locator("[data-table-search]")).toHaveCount(2);
  const tables = page.locator("article table");
  const first = page.getByRole("searchbox", { name: "문서를 연결하는 방법 표 검색" });
  const second = page.getByRole("searchbox", { name: "팀 용어 빠르게 찾기" });
  await first.fill("검색");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await second.fill("산출물");
  await expect(first).toHaveValue("검색");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await expect(tables.nth(1).locator("tbody tr:visible")).toHaveCount(1);
  await expect(tables.nth(1).locator("tbody tr:visible")).toContainText("산출물");
  await second.fill("");
  await expect(tables.nth(1).locator("tbody tr:visible")).toHaveCount(4);
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(2);
  await first.fill("없는검색어");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(0);
  await expect(tables.nth(0).locator("thead")).toBeVisible();
  await first.fill("   ");
  await expect(tables.nth(0).locator("tbody tr:visible")).toHaveCount(3);
  await page.locator("article").getByRole("link", { name: "작성 가이드" }).click();
  await expect(page.locator("[data-table-search]")).toHaveCount(0);
});

test("desktop and mobile layouts stay within the viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("./");
  await expect(page.locator("article h1")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article h1")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.locator("#open-search").click();
  await expect(page.locator("#global-search")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("section tables filter by any cell and restore rows on clear", async ({ page }) => {
  await page.goto("./#/guide%2F03-section-template");
  await expect(page.locator("article h2")).toHaveCount(4);
  await expect(page.locator("[data-table-search]")).toHaveCount(3);
  await expect(page.locator(".section-tools + table")).toHaveCount(3);
  const section = page.locator(".search-section").nth(0);
  const input = page.getByRole("searchbox", { name: "문서 준비 검색", exact: true });
  await expect(section.locator("tbody tr:visible")).toHaveCount(6);
  await input.fill("문서");
  await expect(section.locator("tbody tr:visible")).toHaveCount(3);
  await expect(section.locator("thead")).toBeVisible();
  await expect(page.locator(".search-section").nth(1).locator("tbody tr:visible")).toHaveCount(5);
  await input.fill("markdown");
  await expect(section.locator("tbody tr:visible")).toHaveCount(2);
  await input.fill("번호 추가");
  await expect(section.locator("tbody tr:visible")).toHaveCount(1);
  await input.fill("없는검색어");
  await expect(section.locator("tbody tr:visible")).toHaveCount(0);
  await input.fill("");
  await expect(section.locator("tbody tr:visible")).toHaveCount(6);
});
