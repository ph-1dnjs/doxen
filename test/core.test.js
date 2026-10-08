import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { init } from "../src/init.js";
import { loadConfig } from "../src/config.js";
import { collectSite } from "../src/content.js";
import { build } from "../src/build.js";
import { dev } from "../src/dev.js";
import { prepareAi } from "../src/ai.js";
import { matchesRow } from "../client/search.js";

test("row filtering matches phrases, normalizes Korean and restores empty searches", () => {
  assert.equal(matchesRow("사업자 번호 변경", "사업자"), true);
  assert.equal(matchesRow("사업자 번호 변경", "번호 변경"), true);
  assert.equal(matchesRow("사업자 번호 변경", "번호 없음"), false);
  assert.equal(matchesRow("정산".normalize("NFD"), "정산"), true);
  assert.equal(matchesRow("ＡＰＩ 오류", "api"), true);
  assert.equal(matchesRow("일반 행", "   "), true);
});
import { searchDocuments, matchRanges } from "../client/search.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "safibook-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "guide"));
  await mkdir(path.join(root, "api"));
  await writeFile(
    path.join(root, "docs.config.ts"),
    `export default { title: '팀 문서', tabs: [{title:'안내',slug:'guide',dir:'./guide'}, {title:'API',slug:'api',dir:'./api'}] } satisfies {title:string,tabs:unknown[]};`,
  );
  await writeFile(
    path.join(root, "guide", "start.md"),
    "# 시작하기\n\n안내 본문\n\n## 정산 정책\n\n정산은 매월 지급합니다.\n\n## 정산 정책\n\n중복 제목입니다.\n\n[API](../api/ref.md#조회)\n\n:::search 정책 검색\n## 환불\n\n환불은 7일 이내입니다.\n:::\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
  );
  await writeFile(
    path.join(root, "api", "ref.md"),
    "# 레퍼런스\n\n## 조회\n\nGET /settlements",
  );
  return root;
}

test("init preserves existing application scripts, config and documents; repeated init is stable", async (t) => {
  const root = await fixture(t);
  const configBefore = await readFile(
    path.join(root, "docs.config.ts"),
    "utf8",
  );
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "existing-app",
      scripts: { dev: "vite", "docs:dev": "custom-command" },
      dependencies: { react: "19.0.0" },
    }),
  );
  await init(root);
  const before = await readFile(path.join(root, "package.json"), "utf8");
  const ignore = await readFile(path.join(root, ".gitignore"), "utf8");
  await init(root);
  assert.equal(await readFile(path.join(root, "package.json"), "utf8"), before);
  assert.equal(await readFile(path.join(root, ".gitignore"), "utf8"), ignore);
  assert.equal(
    await readFile(path.join(root, "docs.config.ts"), "utf8"),
    configBefore,
  );
  const pkg = JSON.parse(before);
  assert.equal(pkg.scripts.dev, "vite");
  assert.equal(pkg.scripts["docs:dev"], "custom-command");
  assert.equal(pkg.scripts["docs:build"], "safibook build");
  assert.equal(pkg.dependencies.react, "19.0.0");
});

test("TypeScript config, cross-tab links, unique Korean anchors and searchable containers", async (t) => {
  const root = await fixture(t);
  const { data } = await collectSite(await loadConfig(root));
  assert.equal(data.documents.length, 2);
  const doc = data.documents[0];
  assert.deepEqual(
    doc.toc.map((heading) => heading.anchor),
    ["시작하기", "정산-정책", "정산-정책-1", "환불"],
  );
  assert.match(doc.html, /href="#\/api%2Fref\/%EC%A1%B0%ED%9A%8C"/);
  assert.match(doc.html, /data-section-search/);
  assert.match(doc.html, /<label for="section-search-0">정책 검색<\/label>/);
  assert.doesNotMatch(doc.html, /<script>|href="javascript:/);
  assert.equal(
    searchDocuments(data.documents, "정산 지급")[0].section.anchor,
    "정산-정책",
  );
  assert.equal(
    searchDocuments(data.documents, "GET settlements")[0].doc.tab,
    "api",
  );
  assert.equal(searchDocuments(data.documents, "없는검색").length, 0);
  assert.equal(searchDocuments(data.documents, "   ").length, 0);
});

test("search normalizes decomposed Korean and fullwidth Latin while preserving highlight offsets", () => {
  const source = "정산".normalize("NFD");
  assert.deepEqual(matchRanges(`앞 ${source} 뒤`, "정산"), [
    [2, 2 + source.length],
  ]);
  assert.deepEqual(matchRanges("ＡＰＩ api API", "api"), [
    [0, 3],
    [4, 7],
    [8, 11],
  ]);
  assert.deepEqual(matchRanges("정산정책", "정산 정산정책"), [[0, 4]]);
});

test("invalid or duplicate tab slugs and directories outside the root fail clearly", async (t) => {
  const root = await fixture(t);
  for (const tabs of [
    [
      { title: "A", slug: "a", dir: "./guide" },
      { title: "B", slug: "a", dir: "./api" },
    ],
    [{ title: "A", slug: "../a", dir: "./guide" }],
    [{ title: "A", slug: "a", dir: ".." }],
    [{ title: "A", slug: "a", dir: "." }],
  ]) {
    await writeFile(
      path.join(root, "docs.config.ts"),
      `export default ${JSON.stringify({ title: "x", tabs })}`,
    );
    await assert.rejects(loadConfig(root));
  }
});

test("build includes only referenced assets, skips hidden and symlink files, and is reproducible", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "guide", ".private.md"), "# SECRET");
  await writeFile(path.join(root, "guide", "unused.pdf"), "UNUSED");
  await symlink(
    path.join(root, "guide", ".private.md"),
    path.join(root, "guide", "alias.md"),
  );
  await writeFile(
    path.join(root, "guide", "image.png"),
    Buffer.from([1, 2, 3]),
  );
  await writeFile(
    path.join(root, "api", "ref.md"),
    "# 레퍼런스\n\n![이미지](../guide/image.png)",
  );
  const config = await loadConfig(root);
  const out = await build(config);
  assert.equal((await readdir(path.join(out, "assets"))).length, 1);
  const data = await readFile(path.join(out, "site.json"), "utf8");
  assert.doesNotMatch(data, /SECRET|UNUSED|safibook-test-/);
  await build(config);
  assert.equal(await readFile(path.join(out, "site.json"), "utf8"), data);
  assert.match(
    await readFile(path.join(out, "index.html"), "utf8"),
    /<title>팀 문서<\/title>/,
  );
});

test("build refuses to delete user-owned output and leaves last successful build on failure", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, ".docs-dist"));
  await writeFile(path.join(root, ".docs-dist", "precious.txt"), "keep");
  const config = await loadConfig(root);
  await assert.rejects(build(config), /덮어쓰지/);
  assert.equal(
    await readFile(path.join(root, ".docs-dist", "precious.txt"), "utf8"),
    "keep",
  );
  await rm(path.join(root, ".docs-dist"), { recursive: true });
  const out = await build(config);
  const before = await readFile(path.join(out, "site.json"), "utf8");
  await writeFile(
    path.join(root, "guide", "broken.md"),
    "[broken](./missing.md)",
  );
  await assert.rejects(build(config), /깨진 문서 링크/);
  assert.equal(await readFile(path.join(out, "site.json"), "utf8"), before);
});

test("rejects local asset links that escape document directories, including symlink targets", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "secret.pdf"), "private");
  await symlink(
    path.join(root, "secret.pdf"),
    path.join(root, "guide", "linked.pdf"),
  );
  await writeFile(
    path.join(root, "api", "ref.md"),
    "[secret](../guide/linked.pdf)",
  );
  await assert.rejects(collectSite(await loadConfig(root)), /문서 폴더 밖/);
});

test("dev serves generated files only and reloads content and imported config dependencies", async (t) => {
  const previous = process.env.CHOKIDAR_USEPOLLING;
  process.env.CHOKIDAR_USEPOLLING = "1";
  t.after(() => {
    if (previous === undefined) delete process.env.CHOKIDAR_USEPOLLING;
    else process.env.CHOKIDAR_USEPOLLING = previous;
  });
  const root = await fixture(t);
  await writeFile(path.join(root, "name.ts"), `export default '첫 제목'`);
  await writeFile(
    path.join(root, "docs.config.ts"),
    `import title from './name'; export default {title,tabs:[{title:'가이드',slug:'guide',dir:'./guide'},{title:'API',slug:'api',dir:'./api'}]}`,
  );
  const running = await dev(root, undefined, 0);
  t.after(() => running.close());
  const base = `http://127.0.0.1:${running.server.address().port}`;
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/docs.config.ts`)).status, 404);
  assert.equal(
    (await (await fetch(`${base}/site.json`)).json()).title,
    "첫 제목",
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  await writeFile(path.join(root, "name.ts"), `export default '변경한 제목'`);
  await writeFile(
    path.join(root, "guide", "new.md"),
    "# 새 문서\n\n검색할 새 내용",
  );
  const deadline = Date.now() + 7000;
  let updated;
  do {
    await new Promise((resolve) => setTimeout(resolve, 100));
    updated = await (await fetch(`${base}/site.json`)).json();
  } while (
    (updated.title !== "변경한 제목" || updated.documents.length !== 3) &&
    Date.now() < deadline
  );
  assert.equal(updated.title, "변경한 제목");
  assert.equal(updated.documents.length, 3);
});

test("AI preparation includes the standard template and source without modifying files", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "guide", "start.md");
  const before = await readFile(file, "utf8");
  const config = await loadConfig(root);
  const prompt = await prepareAi(
    config,
    "guide/start.md",
    "환불 절차를 표로 정리",
  );
  assert.match(prompt, /환불 절차를 표로 정리/);
  assert.match(prompt, /## 표준 양식/);
  assert.match(prompt, /:::search 첫 번째 단계 검색/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(prepareAi(config, "docs.config.ts", "수정"), /Markdown/);
  await assert.rejects(prepareAi(config, "guide/start.md", ""), /변경 요청/);
});
