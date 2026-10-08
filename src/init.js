import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

export async function init(cwd) {
  const packageFile = path.join(cwd, "package.json");
  const pkg = (await exists(packageFile))
    ? JSON.parse(await readFile(packageFile, "utf8"))
    : { private: true };
  let hasConfig = false;
  for (const name of ["docs.config.ts", "docs.config.mjs", "docs.config.js"])
    if (await exists(path.join(cwd, name))) hasConfig = true;
  if (!hasConfig) {
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(
      path.join(cwd, "docs.config.ts"),
      `export default {\n  title: '팀 문서',\n  tabs: [\n    { title: '가이드', dir: './docs', slug: 'guide' },\n  ],\n};\n`,
      { flag: "wx" },
    );
    if (!(await exists(path.join(cwd, "docs", "README.md"))))
      await writeFile(
        path.join(cwd, "docs", "README.md"),
        "# 시작하기\n\n팀의 문서를 여기에 작성하세요.\n\n## 문서 연결\n\n설정 파일의 tabs에 문서 폴더를 추가하세요.\n\n:::search 용어 검색\n## 용어 사전\n\n| 용어 | 설명 |\n| --- | --- |\n| Safibook | 저장소 기반 문서 사이트 도구 |\n:::\n",
        { flag: "wx" },
      );
  }
  pkg.scripts ||= {};
  for (const [name, command] of Object.entries({
    "docs:dev": "safibook dev",
    "docs:build": "safibook build",
  })) {
    if (pkg.scripts[name] && pkg.scripts[name] !== command)
      console.log(`기존 ${name} 스크립트를 유지합니다: ${pkg.scripts[name]}`);
    else pkg.scripts[name] = command;
  }
  await writeFile(packageFile, `${JSON.stringify(pkg, null, 2)}\n`);
  const ignorePath = path.join(cwd, ".gitignore");
  let ignore = (await exists(ignorePath))
    ? await readFile(ignorePath, "utf8")
    : "";
  for (const entry of [".docs-dist/", ".docs-build-*/", "node_modules/"])
    if (!ignore.split(/\r?\n/).includes(entry))
      ignore += `${ignore && !ignore.endsWith("\n") ? "\n" : ""}${entry}\n`;
  await writeFile(ignorePath, ignore);
  console.log(
    "설정과 실행 스크립트를 준비했습니다. docs.config.ts를 편집한 후 npm run docs:dev 또는 yarn docs:dev를 실행하세요.",
  );
}
