import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createJiti } from "jiti";

export async function loadConfig(cwd, configPath) {
  let file;
  if (configPath) file = path.resolve(cwd, configPath);
  else {
    for (const name of [
      "docs.config.ts",
      "docs.config.mjs",
      "docs.config.js",
    ]) {
      const candidate = path.join(cwd, name);
      if (
        await access(candidate).then(
          () => true,
          () => false,
        )
      ) {
        file = candidate;
        break;
      }
    }
  }
  if (!file)
    throw new Error("docs.config.ts가 없습니다. docs init을 먼저 실행하세요.");
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
  });
  const config = await jiti.import(file, { default: true });
  if (!config || typeof config.title !== "string" || !config.title.trim())
    throw new Error("title은 비어 있지 않은 문자열이어야 합니다.");
  if (
    config.description !== undefined &&
    typeof config.description !== "string"
  )
    throw new Error("description은 문자열이어야 합니다.");
  if (!Array.isArray(config.tabs) || !config.tabs.length)
    throw new Error("tabs를 하나 이상 설정하세요.");
  const root = await realpath(path.dirname(file));
  const slugs = new Set();
  const tabs = [];
  for (const tab of config.tabs) {
    if (
      !tab ||
      typeof tab.title !== "string" ||
      !tab.title.trim() ||
      typeof tab.dir !== "string" ||
      !tab.dir.trim()
    )
      throw new Error("각 탭의 title과 dir을 설정하세요.");
    if (
      typeof tab.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tab.slug) ||
      slugs.has(tab.slug)
    )
      throw new Error(
        "탭 slug는 중복 없는 영문 소문자·숫자·하이픈이어야 합니다.",
      );
    const dir = await realpath(path.resolve(root, tab.dir));
    if (!inside(root, dir) || !(await stat(dir)).isDirectory())
      throw new Error(
        `문서 폴더는 설정 파일 하위의 디렉터리여야 합니다: ${tab.dir}`,
      );
    if (dir === root)
      throw new Error(
        "문서 폴더로 저장소 루트 대신 전용 하위 폴더를 지정하세요.",
      );
    slugs.add(tab.slug);
    tabs.push({ title: tab.title, slug: tab.slug, dir });
  }
  return {
    title: config.title,
    description: config.description || "",
    tabs,
    root,
    file,
  };
}

export function inside(root, file) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
