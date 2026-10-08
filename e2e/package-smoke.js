import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(path.join(tmpdir(), "safibook-consumer-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const useYarn = process.argv.includes("--yarn");
const run = (args, cwd) =>
  execFileSync(npm, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_cache: path.join(tmpdir(), "safibook-npm-cache"),
    },
  });
try {
  const [pack] = JSON.parse(
    run(["pack", "--json", "--pack-destination", root], process.cwd()),
  );
  assert(
    pack.files.every(({ path: file }) =>
      /^(bin\/|src\/|client\/|README.md$|LICENSE$|package.json$)/.test(file),
    ),
  );
  const consumer = path.join(root, "app");
  await mkdir(consumer);
  await writeFile(
    path.join(consumer, "package.json"),
    JSON.stringify({ private: true, scripts: { dev: "echo existing-app" } }),
  );
  const yarn = (args) =>
    execFileSync("yarn", args, {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...process.env,
        YARN_CACHE_FOLDER: path.join(tmpdir(), "safibook-yarn-cache"),
      },
    });
  if (useYarn) {
    yarn([
      "add",
      "-D",
      path.join(root, pack.filename),
      "--ignore-scripts",
      "--non-interactive",
    ]);
    yarn(["safibook", "init"]);
  } else {
    run(
      [
        "install",
        "-D",
        path.join(root, pack.filename),
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      consumer,
    );
    run(["exec", "--", "docs", "init"], consumer);
  }
  await writeFile(
    path.join(consumer, "docs.config.ts"),
    `import {defineConfig} from '@unana_dev/doxen'; export default defineConfig({title:'설치 테스트',tabs:[{title:'가이드',dir:'./docs',slug:'guide'}]});`,
  );
  if (useYarn) yarn(["docs:build"]);
  else run(["run", "docs:build"], consumer);
  const data = JSON.parse(
    await readFile(path.join(consumer, ".docs-dist", "site.json"), "utf8"),
  );
  assert.equal(data.title, "설치 테스트");
  assert.equal(data.documents.length, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(consumer, "package.json"), "utf8"))
      .scripts.dev,
    "echo existing-app",
  );
  const prompt = run(
    [
      "exec",
      "--",
      "docs",
      "ai",
      "--file",
      "docs/README.md",
      "--instruction",
      "표준 양식으로 정리",
    ],
    consumer,
  );
  assert.match(prompt, /표준 양식/);
  console.log(
    `${useYarn ? "Yarn" : "npm"} 패키지 설치 검증 통과: ${pack.files.length}개 배포 파일, init → typed config → build → ai`,
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
