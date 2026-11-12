import { test, expect } from "@playwright/test";
import MarkdownIt from "markdown-it";

test("folder spreadsheet opens and switches sheets", async ({ page }) => {
  await page.route("**/site.json", (route) => route.fulfill({ json: {
    title: "문서", tabs: [{ slug: "guide", title: "안내" }],
    documents: [{ id: "guide/자료/보고서.xlsx", tab: "guide", path: "자료/보고서.xlsx", title: "보고서.xlsx", toc: [], sections: [], spreadsheet: { data: "./assets/sheets.json", file: "./assets/report.xlsx" } }],
  } }));
  await page.route("**/assets/sheets.json", (route) => route.fulfill({ json: [
    { sheet: "첫째", data: [["이름", 42]] },
    { sheet: "둘째", data: [["두 번째 시트"]] },
  ] }));
  await page.goto("./#/guide%2F%EC%9E%90%EB%A3%8C%2F");
  await page.locator(".folder-cards").getByRole("link", { name: "보고서.xlsx" }).click();
  await expect(page.locator(".spreadsheet-table")).toContainText("이름");
  await expect(page.locator(".spreadsheet-table")).toContainText("42");
  await expect(page.locator(".sheet-col-head")).toHaveText(["A", "B"]);
  await page.locator('[data-cell="0-1"]').click();
  await expect(page.locator(".sheet-name-box")).toHaveText("B1");
  await expect(page.locator(".sheet-formula-value")).toHaveText("42");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".sheet-name-box")).toHaveText("A1");
  await page.getByPlaceholder("시트에서 찾기 (Enter: 다음)").fill("42");
  await expect(page.locator(".sheet-find-count")).toHaveText("0/1");
  await page.getByRole("tab", { name: /둘째/ }).click();
  await expect(page.locator(".spreadsheet-table")).toContainText("두 번째 시트");
  await expect(page.getByRole("tab", { name: /둘째/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "펼치기" }).click();
  await expect(page.locator(".sheet-viewer")).toHaveClass(/is-full/);
  await page.getByRole("button", { name: "좁히기" }).click();
  await expect(page.locator(".sheet-viewer")).not.toHaveClass(/is-full/);
  await expect(page.getByRole("link", { name: "엑셀 파일 다운로드" })).toHaveAttribute("download", "보고서.xlsx");
});

test("Mermaid renders locally, preserves invalid sources and survives navigation", async ({ page }, testInfo) => {
  const source = [
    "# [개요] 회원가입 기능 흐름",
    "> **범위:** `/signup`에서 사업자 정보 확인, 회원·담당자 정보 입력, SMS 인증, 약관 동의, 가입 완료까지의 현재 프론트엔드 흐름 기준",
    "---",
    "## 1. 기능 목적",
    "- 신규 사업자의 사업자등록번호를 검증하고 사업자·계정·담당자 정보를 수집합니다.\n- 아이디 중복 확인과 담당자 SMS 인증, 필수 약관 동의가 모두 완료된 경우에만 가입을 요청합니다.\n- 기존 회원은 신규 가입이 아닌 계정 연동 흐름으로 안내합니다.",
    "## 2. 전체 구성",
    "| 단계 | 주요 입력·행동 | 완료 조건 |\n| --- | --- | --- |\n| **01 사업자 정보** | 상호명, 사업자등록번호 조회, 대표자·업태·주소·사업자등록증 등 입력 | 가입 가능한 사업자 검증과 필수 사업자 정보 입력 |\n| **02 회원 정보** | 아이디 중복확인, 비밀번호, 담당자·SMS 인증, 세금계산서 이메일, 약관 동의 | 아이디·SMS 인증·필수 약관 동의 완료 |\n| **가입 완료** | 가입 아이디·담당자 정보 요약과 관리자 검토 안내 표시 | 메인으로 돌아가기 |",
    "## 3. 클라이언트 · 서버 요청 흐름",
    "```mermaid\nsequenceDiagram\n    autonumber\n    participant C as 클라이언트\n    participant S as 서버\n    C->>S: 사업자 정보 확인\n    S-->>C: 검증 결과\n    C->>S: 회원가입 요청\n    S-->>C: 가입 완료\n```",
    "```\nsequenceDiagram\n    A->>B: 언어 표시 없는 시퀀스\n```",
    "```mermaid\nflowchart LR\n    A[입력] --> B[완료]\n```",
    "```mermaid\ninvalid diagram syntax\n```",
    "```js\nconst message = '일반 코드는 유지';\n```",
  ].join("\n\n");
  await page.route("**/site.json", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.documents[0].html = new MarkdownIt().render(source);
    data.documents[0].title = "[개요] 회원가입 기능 흐름";
    await route.fulfill({ json: data });
  });
  const external = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:")) external.push(request.url());
  });
  await page.setViewportSize({ width: 2048, height: 1200 });
  await page.goto("./");
  await expect(page.locator(".diagram svg")).toHaveCount(3);
  await expect(page.locator(".diagram").first()).toContainText("사업자 정보 확인");
  await expect(page.locator(".diagram-error")).toHaveCount(1);
  await expect(page.locator("pre code.language-mermaid")).toHaveText("invalid diagram syntax\n");
  await expect(page.locator("pre code.language-js")).toContainText("일반 코드는 유지");
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans KR Variable"', "회원가입"))).toBe(true);
  expect(external).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("signup-desktop.png") });
  await page.locator(".diagram").first().screenshot({ path: testInfo.outputPath("sequence-diagram.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#tabs").getByRole("link", { name: "레퍼런스" }).click();
  await expect(page.locator(".diagram")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".diagram svg")).toHaveCount(3);
});

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


test("configured color reaches navigation, focus and search highlights", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#tabs a.active")).toHaveCSS("color", "rgb(234, 179, 8)");
  await expect(page.locator("#documents a.selected")).toHaveCSS("color", "rgb(234, 179, 8)");
  await expect(page.locator("#breadcrumb a").first()).toHaveCSS("color", "rgb(234, 179, 8)");
  await page.locator("#open-search").click();
  await page.locator("#global-search").fill("산출물");
  await expect(page.locator("#global-search")).toHaveCSS("outline-color", "color(srgb 0.967059 0.880784 0.612549)");
  const highlight = "color(srgb 0.979412 0.92549 0.757843)";
  await expect(page.locator("#results mark").first()).toHaveCSS("background-color", highlight);
  await page.locator("#results .result").click();
  await expect(page.locator("article mark")).toHaveCSS("background-color", highlight);
  await expect(page.locator("#tabs a.active")).toHaveCSS("border-bottom-color", "rgb(234, 179, 8)");
});

test("comments attach a selected passage and remain expanded", async ({ page }) => {
  let saved;
  const comments = [];
  await page.route("**/site.json", (route) => route.fulfill({ json: {
    title: "문서", tabs: [{ slug: "guide", title: "안내" }],
    documents: [{ id: "guide/test", tab: "guide", path: "test.md", title: "테스트", toc: [], sections: [], html: "<h1>테스트</h1><p>선택할 문장입니다.</p>" }],
  } }));
  await page.route("**/__doxen/comments**", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: comments });
    saved = route.request().postDataJSON();
    const item = { ...saved, author: "member@example.com", created_at: new Date().toISOString() };
    comments.push(item);
    return route.fulfill({ status: 201, json: item });
  });
  await page.goto("./");
  const paragraph = page.locator("#article p").first();
  await expect(paragraph.locator("..").locator(".comment-trigger")).toHaveCount(1);
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 0);
    range.setEnd(node.firstChild, 3);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await paragraph.dispatchEvent("mouseup");
  await page.getByRole("button", { name: "댓글 추가" }).click();
  await expect(paragraph.locator(".comment-draft-highlight")).toHaveText("선택할");
  await expect(paragraph.locator("..").locator(".comment-selection")).toHaveCount(0);
  await expect(paragraph.locator("..").locator(".comment-header")).toHaveCount(0);
  await paragraph.locator("..").getByLabel("댓글 내용").fill("확인해 주세요");
  await expect(paragraph.locator(".comment-draft-highlight")).toHaveText("선택할");
  await expect(paragraph.locator("..").locator(".comment-foot")).toBeHidden();
  await paragraph.locator("..").getByRole("button", { name: "댓글 등록" }).click();
  await expect(page.locator(".comment-panel .comment-card-head")).toContainText("member@example.com");
  expect(saved.quote).toBe("선택할");
  await expect(paragraph.locator(".comment-draft-highlight")).toHaveCount(0);
  await expect(paragraph.locator(".comment-highlight")).toHaveText("선택할");
  await expect(page.getByText("확인해 주세요")).toBeVisible();
  await paragraph.locator("..").getByLabel("댓글 내용").fill("두 번째 댓글");
  await paragraph.locator("..").getByRole("button", { name: "댓글 등록" }).click();
  await expect(page.getByText("확인해 주세요")).toBeVisible();
  await expect(page.getByText("두 번째 댓글")).toBeVisible();
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.getByRole("button", { name: "댓글 2개 더보기" }).click();
  await expect(page.getByText("확인해 주세요")).toBeVisible();
  await expect(page.getByText("두 번째 댓글")).toBeVisible();
  await expect(page.locator(".comment-list details, .comment-list summary")).toHaveCount(0);
});

test('comment lane and table of contents adapt without overlapping', async ({ page }) => {
  await page.route('**/site.json', (route) => route.fulfill({ json: {
    title: '문서', tabs: [{ slug: 'guide', title: '안내' }],
    documents: [{ id: 'guide/test', tab: 'guide', path: 'test.md', title: '테스트', toc: [{ title: '본문', anchor: 'body', level: 2 }], sections: [], html: '<h1>테스트</h1><h2 id="body">본문</h2><p>댓글이 있는 문단입니다.</p>' }],
  } }));
  await page.route('**/__doxen/comments**', (route) => route.fulfill({ json: [{ id: '1', block: JSON.stringify(['댓글이 있는 문단입니다.', 0]), author: 'a@example.com', body: '내용', quote: '', created_at: '2026-11-11T00:00:00Z' }] }));
  for (const width of [1800, 1400, 1200, 1000, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    const trigger = page.getByRole('button', { name: '댓글 1개 더보기' });
    await expect(trigger).toBeVisible();
    const buttonBox = await trigger.boundingBox();
    const articleBox = await page.locator('#article').boundingBox();
    expect(buttonBox.x).toBeGreaterThanOrEqual(articleBox.x + articleBox.width - 1);
    expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(width);
    if (width >= 1200) {
      const toc = page.locator('.toc');
      await expect(toc).toBeVisible();
      const tocBox = await toc.boundingBox();
      expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(tocBox.x);
    } else {
      const toggle = page.getByRole('button', { name: '☰ 목차' });
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.locator('#compact-toc-links')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#compact-toc-links')).toBeHidden();
    }
    await trigger.click();
    const panel = page.locator('.comment-anchor > .comment-panel:not([hidden])');
    await expect(panel).toBeVisible();
    const card = await panel.boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(width);
    if (width >= 1600) await expect(page.locator('body')).toHaveClass(/comment-card-open/);
    if (width < 1600) expect(card.x + card.width).toBeCloseTo(width - 16, 0);
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    await expect(page.locator('body')).not.toHaveClass(/comment-card-open/);
  }
});

test('long comments scroll with the full comment list', async ({ page }) => {
  await page.route('**/site.json', (route) => route.fulfill({ json: {
    title: '문서', tabs: [{ slug: 'guide', title: '안내' }],
    documents: [{ id: 'guide/test', tab: 'guide', path: 'test.md', title: '테스트', toc: [], sections: [], html: '<h1>테스트</h1><p>문단입니다.</p>' }],
  } }));
  await page.route('**/__doxen/comments**', (route) => route.fulfill({ json: [{ id: '1', block: JSON.stringify(['문단입니다.', 0]), author: 'a@example.com', body: '긴 댓글입니다.\n'.repeat(80), quote: '', created_at: '2026-11-11T00:00:00Z' }] }));
  await page.goto('./');
  await page.getByRole('button', { name: '댓글 1개 더보기' }).click();
  const sizes = await page.locator('.comment-list').evaluate((list) => {
    const body = list.querySelector('.comment-body');
    return { listScrollable: list.scrollHeight > list.clientHeight, bodyScrollable: body.scrollHeight > body.clientHeight, bodyOverflow: getComputedStyle(body).overflowY };
  });
  expect(sizes).toEqual({ listScrollable: true, bodyScrollable: false, bodyOverflow: 'visible' });
  const frame = page.locator('.comment-list-frame');
  await expect(frame).toHaveClass(/has-below/);
  await expect(frame).not.toHaveClass(/has-above/);
  await page.locator('.comment-list').evaluate((list) => { list.scrollTop = list.scrollHeight; });
  await expect(frame).toHaveClass(/has-above/);
  await expect(frame).not.toHaveClass(/has-below/);
  const initialHeight = await page.locator('.comment-list').evaluate((list) => list.clientHeight);
  await page.setViewportSize({ width: 1280, height: 500 });
  const shorterHeight = await page.locator('.comment-list').evaluate((list) => list.clientHeight);
  expect(shorterHeight).toBeLessThan(initialHeight);
});

test('long table of contents fades in the scroll direction', async ({ page }) => {
  await page.route('**/site.json', (route) => route.fulfill({ json: {
    title: '문서', tabs: [{ slug: 'guide', title: '안내' }],
    documents: [{ id: 'guide/test', tab: 'guide', path: 'test.md', title: '테스트', toc: Array.from({ length: 40 }, (_, i) => ({ title: `항목 ${i}`, anchor: `item-${i}`, level: 2 })), sections: [], html: '<h1>테스트</h1>' }],
  } }));
  await page.setViewportSize({ width: 1600, height: 700 });
  await page.goto('./');
  const frame = page.locator('.toc-frame');
  const toc = page.locator('#toc');
  await expect(frame).toHaveClass(/has-below/);
  await expect(frame).not.toHaveClass(/has-above/);
  expect(await toc.evaluate((node) => getComputedStyle(node).scrollbarWidth)).toBe('none');
  await toc.evaluate((node) => { node.scrollTop = node.scrollHeight; });
  await expect(frame).toHaveClass(/has-above/);
  await expect(frame).not.toHaveClass(/has-below/);
});

test('selected text across formatting remains visible while composing and clears on close', async ({ page }) => {
  await page.route('**/site.json', (route) => route.fulfill({ json: {
    title: '문서', tabs: [{ slug: 'guide', title: '안내' }],
    documents: [{ id: 'guide/test', tab: 'guide', path: 'test.md', title: '테스트', toc: [], sections: [], html: '<h1>테스트</h1><p>시작 <strong>강조 문구</strong> 끝</p>' }],
  } }));
  await page.route('**/__doxen/comments**', (route) => route.fulfill({ json: [] }));
  await page.goto('./');
  const paragraph = page.locator('#article p').first();
  await expect(paragraph.locator('..').locator('.comment-trigger')).toHaveCount(1);
  await paragraph.evaluate((node) => {
    const range = document.createRange();
    range.setStart(node.firstChild, 1);
    range.setEnd(node.querySelector('strong').firstChild, 2);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await paragraph.dispatchEvent('mouseup');
  await page.getByRole('button', { name: '댓글 추가' }).click();
  await expect(paragraph.locator('.comment-draft-highlight')).toHaveCount(2);
  await page.getByLabel('댓글 내용').filter({ visible: true }).fill('임시 댓글');
  await expect(paragraph.locator('.comment-draft-highlight')).toHaveCount(2);
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await expect(paragraph.locator('.comment-draft-highlight')).toHaveCount(0);
  await expect(paragraph).toHaveText('시작 강조 문구 끝');
});

test('comment link opens the correct document and comment', async ({ page }) => {
  await page.route('**/site.json', (route) => route.fulfill({ json: {
    title: '문서', tabs: [{ slug: 'guide', title: '안내' }],
    documents: [{ id: 'guide/test', tab: 'guide', path: 'test.md', title: '테스트', toc: [], sections: [], html: '<h1>테스트</h1><p>첫 문단</p><p>대상 문단</p>' }],
  } }));
  await page.route('**/__doxen/comments**', (route) => route.fulfill({ json: [
    { id: 'other', block: JSON.stringify(['첫 문단', 0]), author: 'a@example.com', body: '첫 댓글', quote: '', created_at: '2026-11-11T00:00:00Z' },
    { id: 'target', block: JSON.stringify(['대상 문단', 0]), author: 'b@example.com', body: '찾는 댓글', quote: '', created_at: '2026-11-11T00:00:00Z' },
  ] }));
  await page.goto('./#/guide%2Ftest/comment/target');
  const target = page.locator('[data-comment-id="target"]');
  await expect(target).toBeVisible();
  await expect(target).toContainText('찾는 댓글');
  await expect(page.locator('[data-comment-id="other"]')).toBeHidden();
  await expect(page.locator('textarea:focus')).toHaveCount(0);
});

test("search filters by a tab tag and Backspace removes it", async ({ page }) => {
  await page.route("**/site.json", (route) => route.fulfill({ json: {
    title: "문서", tabs: [{ slug: "policy", title: "정책" }, { slug: "api", title: "API 문서" }],
    documents: ["policy", "api"].map((tab) => ({ id: `${tab}/one`, tab, path: "one.md", title: tab, html: `<h1>${tab}</h1>`, toc: [], sections: [{ title: tab, text: "공통 검색어", anchor: "" }], modified: { date: "2026-01-02T00:00:00Z", author: "작성자" } })),
  } }));
  await page.goto("./");
  await expect(page.locator(".document-modified")).toContainText("작성자");
  await page.getByRole("button", { name: /검색/ }).first().click();
  const input = page.locator("#global-search");
  await input.fill("#API 문서 ");
  await expect(page.locator("#search-tag")).toHaveText("#API 문서");
  await input.fill("공통");
  await expect(page.locator("#results .result")).toHaveCount(1);
  await expect(page.locator("#results .result")).toContainText("API 문서");
  await input.fill("");
  await input.press("Backspace");
  await expect(page.locator("#search-tag")).toBeHidden();
  await input.fill("공통");
  await expect(page.locator("#results .result")).toHaveCount(2);
});
