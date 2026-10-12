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
import { build, siteFiles } from "../src/build.js";
import { dev } from "../src/dev.js";
import { prepareAi } from "../src/ai.js";
import { matchesRow } from "../client/search.js";

test("row filtering matches phrases, normalizes Korean and restores empty searches", () => {
  assert.equal(matchesRow("문서 번호 변경", "문서"), true);
  assert.equal(matchesRow("문서 번호 변경", "번호 변경"), true);
  assert.equal(matchesRow("문서 번호 변경", "번호 없음"), false);
  assert.equal(matchesRow("빌드".normalize("NFD"), "빌드"), true);
  assert.equal(matchesRow("ＡＰＩ 오류", "api"), true);
  assert.equal(matchesRow("일반 행", "   "), true);
});
import { searchDocuments, matchRanges } from "../client/search.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "guide"));
  await mkdir(path.join(root, "api"));
  await writeFile(
    path.join(root, "docs.config.ts"),
    `export default { title: '팀 문서', tabs: [{title:'안내',slug:'guide',dir:'./guide'}, {title:'API',slug:'api',dir:'./api'}] } satisfies {title:string,tabs:unknown[]};`,
  );
  await writeFile(
    path.join(root, "guide", "start.md"),
    "# 시작하기\n\n안내 본문\n\n## 빌드 설정\n\n빌드 명령으로 사이트를 생성합니다.\n\n## 빌드 설정\n\n중복 제목입니다.\n\n[API](../api/ref.md#조회)\n\n:::search 설정 검색\n## 작성\n\nMarkdown으로 문서를 작성합니다.\n:::\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))",
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
  assert.equal(pkg.scripts["docs:build"], "doxen build");
  assert.equal(pkg.dependencies.react, "19.0.0");
});

test("TypeScript config, cross-tab links, unique Korean anchors and searchable containers", async (t) => {
  const root = await fixture(t);
  const { data } = await collectSite(await loadConfig(root));
  assert.equal(data.documents.length, 2);
  const doc = data.documents[0];
  assert.deepEqual(
    doc.toc.map((heading) => heading.anchor),
    ["시작하기", "빌드-설정", "빌드-설정-1", "작성"],
  );
  assert.match(doc.html, /href="#\/api%2Fref\/%EC%A1%B0%ED%9A%8C"/);
  assert.match(doc.html, /data-section-search/);
  assert.match(doc.html, /<label for="section-search-0">설정 검색<\/label>/);
  assert.doesNotMatch(doc.html, /<script>|href="javascript:/);
  assert.equal(
    searchDocuments(data.documents, "빌드 생성")[0].section.anchor,
    "빌드-설정",
  );
  assert.equal(
    searchDocuments(data.documents, "GET settlements")[0].doc.tab,
    "api",
  );
  assert.equal(searchDocuments(data.documents, "없는검색").length, 0);
  assert.equal(searchDocuments(data.documents, "   ").length, 0);
});

test("search normalizes decomposed Korean and fullwidth Latin while preserving highlight offsets", () => {
  const source = "빌드".normalize("NFD");
  assert.deepEqual(matchRanges(`앞 ${source} 뒤`, "빌드"), [
    [2, 2 + source.length],
  ]);
  assert.deepEqual(matchRanges("ＡＰＩ api API", "api"), [
    [0, 3],
    [4, 7],
    [8, 11],
  ]);
  assert.deepEqual(matchRanges("빌드설정", "빌드 빌드설정"), [[0, 4]]);
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
  assert.doesNotMatch(data, /SECRET|UNUSED|doxen-test-/);
  await build(config);
  assert.equal(await readFile(path.join(out, "site.json"), "utf8"), data);
  assert.match(
    await readFile(path.join(out, "index.html"), "utf8"),
    /<title>팀 문서<\/title>/,
  );
  assert.match(
    await readFile(path.join(out, "index.html"), "utf8"),
    /<link rel="icon" type="image\/svg\+xml" href="\.\/favicon.svg"/,
  );
  assert.match(
    await readFile(path.join(out, "favicon.svg"), "utf8"),
    />팀<\/text>/,
  );
});

test("favicon and header logo uppercase English initials, preserve other graphemes and escape markup", async (t) => {
  const config = await loadConfig(await fixture(t));
  for (const [title, expected] of [
    ["  Project docs", "P"],
    ["pharmaresearch", "P"],
    ["  doxen", "D"],
    ["ß docs", "ß"],
    ["팀 문서".normalize("NFD"), "팀"],
    ["👩‍💻 Docs", "👩‍💻"],
    ["& Docs", "&#38;"],
    ["<Docs", "&#60;"],
  ]) {
    const files = await siteFiles({ ...config, title });
    assert.ok(files.get("/favicon.svg").toString().includes(`>${expected}</text>`));
    assert.ok(files.get("/index.html").toString().includes(`<span class="brand-icon">${expected}</span`));
    assert.match(files.get("/favicon.svg").toString(), /x="16" y="16" dominant-baseline="middle"/);
  }
});

test("icon colors default independently, customize built icons and reject invalid colors", async (t) => {
  const root = await fixture(t);
  const config = await loadConfig(root);
  assert.deepEqual(config.icon, { background: "#edf8ff", color: "#467792", border: "#bcdff8" });
  const source = {
    title: "팀 문서",
    tabs: [
      { title: "안내", slug: "guide", dir: "./guide" },
      { title: "API", slug: "api", dir: "./api" },
    ],
  };
  for (const icon of [
    { color: "#ABC" },
    { border: "#ABC" },
    { background: "#f3e8ff", color: "#7e22ce", border: "#c084fc" },
  ]) {
    await writeFile(
      path.join(root, "docs.config.ts"),
      `export default ${JSON.stringify({ ...source, icon })}`,
    );
    const custom = await loadConfig(root);
    assert.deepEqual(custom.icon, { ...config.icon, ...icon });
    const out = await build(custom);
    const html = await readFile(path.join(out, "index.html"), "utf8");
    const svg = await readFile(path.join(out, "favicon.svg"), "utf8");
    assert.ok(html.includes(`--icon-background:${custom.icon.background}`));
    assert.ok(html.includes(`--icon-color:${custom.icon.color}`));
    assert.ok(html.includes(`--icon-border:${custom.icon.border}`));
    assert.ok(svg.includes(`fill="${custom.icon.background}"`));
    assert.ok(svg.includes(`fill="${custom.icon.color}"`));
  }
  for (const icon of [
    null,
    "yellow",
    [],
    { color: 123 },
    { color: "red" },
    { background: "#abcd" },
    { border: "purple" },
    { color: '#fff"/><script>' },
  ]) {
    await writeFile(
      path.join(root, "docs.config.ts"),
      `export default ${JSON.stringify({ ...source, icon })}`,
    );
    await assert.rejects(loadConfig(root), /icon/);
  }
});

test("a single icon color generates matching tones and supports short HEX", async (t) => {
  const root = await fixture(t);
  const source = await readFile(path.join(root, "docs.config.ts"), "utf8");
  for (const [color, expected] of [
    ["#eab308", { background: "#fdf7e6", border: "#f7e19c", color: "#816204" }],
    ["#ABC", { background: "#f7f8fa", border: "#dde4eb", color: "#5e6770" }],
    ["#ffffff", { background: "#ffffff", border: "#ffffff", color: "#8c8c8c" }],
    ["#000000", { background: "#e6e6e6", border: "#999999", color: "#000000" }],
  ]) {
    await writeFile(
      path.join(root, "docs.config.ts"),
      source.replace("title: '팀 문서'", `title: '팀 문서', icon: '${color}'`),
    );
    const config = await loadConfig(root);
    assert.deepEqual(config.icon, expected);
    const files = await siteFiles(config, true);
    assert.ok(files.get("/index.html").toString().includes(`--icon-border:${expected.border}`));
    assert.ok(files.get("/favicon.svg").toString().includes(`fill="${expected.color}"`));
  }
});

test("site color supports HEX, inherits a single icon color and allows independent overrides", async (t) => {
  const root = await fixture(t);
  const source = { title: "팀 문서", tabs: [{ title: "안내", slug: "guide", dir: "./guide" }, { title: "API", slug: "api", dir: "./api" }] };
  for (const [settings, expected] of [
    [{}, undefined],
    [{ icon: { color: "#ABC" } }, undefined],
    [{ icon: "#eab308" }, "#eab308"],
    [{ color: "#ABC" }, "#ABC"],
    [{ color: "#000000" }, "#000000"],
    [{ color: "#ffffff" }, "#ffffff"],
    [{ color: "#7e22ce", icon: "#eab308" }, "#7e22ce"],
    [{ color: "#7e22ce", icon: { color: "#123456" } }, "#7e22ce"],
  ]) {
    await writeFile(path.join(root, "docs.config.ts"), `export default ${JSON.stringify({ ...source, ...settings })}`);
    const config = await loadConfig(root);
    assert.equal(config.color, expected);
    const html = (await siteFiles(config)).get("/index.html").toString();
    assert.equal(html.includes("--accent:"), expected !== undefined);
    if (expected) assert.ok(html.includes(`--accent:${expected};`));
    if (settings.color === "#ABC")
      assert.deepEqual(config.icon, { background: "#f7f8fa", border: "#dde4eb", color: "#5e6770" });
    if (settings.icon === "#eab308") assert.equal(config.icon.color, "#816204");
    if (typeof settings.icon === "object") assert.equal(config.icon.color, settings.icon.color);
  }
  for (const color of [null, 123, {}, "red", "#abcd", "#12345g", "#fff;}</style><script>"]) {
    await writeFile(path.join(root, "docs.config.ts"), `export default ${JSON.stringify({ ...source, color })}`);
    await assert.rejects(loadConfig(root), /color/);
  }
});

test("init includes editable default icon colors in new configs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await init(root);
  const source = await readFile(path.join(root, "docs.config.ts"), "utf8");
  assert.match(source, /icon: \{ background: '#edf8ff', color: '#467792', border: '#bcdff8' \}/);
  assert.deepEqual((await loadConfig(root)).icon, {
    background: "#edf8ff",
    color: "#467792",
    border: "#bcdff8",
  });
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
  const favicon = await fetch(`${base}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/svg+xml");
  assert.match(await favicon.text(), />첫<\/text>/);
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
  await writeFile(
    path.join(root, "docs.config.ts"),
    `import title from './name'; export default {title,icon:{background:'#f3e8ff',color:'#7e22ce',border:'#c084fc'},tabs:[{title:'가이드',slug:'guide',dir:'./guide'},{title:'API',slug:'api',dir:'./api'}]}`,
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
  assert.match(await (await fetch(`${base}/favicon.svg`)).text(), />변<\/text>/);
  assert.match(await (await fetch(`${base}/favicon.svg`)).text(), /fill="#7e22ce"/);
  assert.match(await (await fetch(`${base}/`)).text(), /--icon-background:#f3e8ff;--icon-color:#7e22ce;--icon-border:#c084fc/);
});

test("AI preparation includes the standard template and source without modifying files", async (t) => {
  const root = await fixture(t);
  const file = path.join(root, "guide", "start.md");
  const before = await readFile(file, "utf8");
  const config = await loadConfig(root);
  const prompt = await prepareAi(
    config,
    "guide/start.md",
    "작성 절차를 표로 정리",
  );
  assert.match(prompt, /작성 절차를 표로 정리/);
  assert.match(prompt, /## 표준 양식/);
  assert.match(prompt, /:::search 첫 번째 단계 검색/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(prepareAi(config, "docs.config.ts", "수정"), /Markdown/);
  await assert.rejects(prepareAi(config, "guide/start.md", ""), /변경 요청/);
});
