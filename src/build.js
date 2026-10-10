import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  rename,
  rm,
  mkdtemp,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectSite } from "./content.js";
import { inside } from "./config.js";

const client = fileURLToPath(new URL("../client/", import.meta.url));
const marker = ".doxen-output";

export async function siteFiles(config, dev = false) {
  const { data, assets } = await collectSite(config);
  const files = new Map();
  const initial = new Intl.Segmenter("ko", { granularity: "grapheme" })
    .segment(config.title.trim().normalize("NFC"))[Symbol.iterator]()
    .next().value.segment;
  files.set(
    "/favicon.svg",
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${config.icon.background}"/><text x="16" y="17" dominant-baseline="central" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="${config.icon.color}">${initial.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</text></svg>`,
    ),
  );
  for (const name of ["index.html", "app.js", "style.css", "search.js"])
    files.set(`/${name}`, await readFile(path.join(client, name)));
  let html = files.get("/index.html").toString();
  html = html.replace(
    "</head>",
    `<style>:root{--icon-background:${config.icon.background};--icon-color:${config.icon.color};--icon-border:${config.icon.border}}</style></head>`,
  );
  html = html.replace(
    "<title>Doxen</title>",
    `<title>${config.title.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}</title>`,
  );
  if (config.description)
    html = html.replace(
      "</head>",
      `<meta name="description" content="${config.description.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)}"/></head>`,
    );
  if (dev)
    html = html.replace(
      "</body>",
      '<script>new EventSource("/__events").addEventListener("reload",()=>location.reload())</script></body>',
    );
  files.set("/index.html", Buffer.from(html));
  files.set("/site.json", Buffer.from(JSON.stringify(data)));
  for (const [name, buffer] of assets) files.set(`/assets/${name}`, buffer);
  return files;
}

export async function build(config) {
  if (config.deploymentState && !config.deploymentState.ready)
    throw new Error("비공개 배포 설정이 아직 완료되지 않았습니다. npx doxen deploy를 다시 실행하세요.");
  const out = path.join(config.root, ".docs-dist");
  if (config.tabs.some((tab) => inside(tab.dir, out) || inside(out, tab.dir)))
    throw new Error(".docs-dist를 문서 폴더로 사용하거나 포함할 수 없습니다.");
  const info = await lstat(out).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (info && (!info.isDirectory() || info.isSymbolicLink()))
    throw new Error(".docs-dist는 일반 디렉터리여야 합니다.");
  if (
    info &&
    (await readdir(out)).length &&
    !(await readFile(path.join(out, marker), "utf8").then(
      (value) => value === "doxen\n",
      () => false,
    ))
  )
    throw new Error(
      "기존 .docs-dist가 Doxen 빌드 폴더가 아니므로 덮어쓰지 않습니다.",
    );
  const files = await siteFiles(config);
  if (config.deploy !== undefined) {
    const { protectedFiles } = await import("./deploy.js");
    for (const [name, buffer] of await protectedFiles(config.deploy)) files.set(name, buffer);
  }
  const temporary = await mkdtemp(path.join(config.root, ".docs-build-"));
  try {
    for (const [name, buffer] of files) {
      const target = path.join(temporary, name.slice(1));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }
    await writeFile(path.join(temporary, marker), "doxen\n");
    await rm(out, { recursive: true, force: true });
    await rename(temporary, out);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return out;
}
