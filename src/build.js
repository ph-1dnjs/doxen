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
const marker = ".safibook-output";

export async function siteFiles(config, dev = false) {
  const { data, assets } = await collectSite(config);
  const files = new Map();
  for (const name of ["index.html", "app.js", "style.css", "search.js"])
    files.set(`/${name}`, await readFile(path.join(client, name)));
  let html = files.get("/index.html").toString();
  html = html.replace(
    "<title>Safibook</title>",
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
      (value) => value === "safibook\n",
      () => false,
    ))
  )
    throw new Error(
      "기존 .docs-dist가 Safibook 빌드 폴더가 아니므로 덮어쓰지 않습니다.",
    );
  const files = await siteFiles(config);
  const temporary = await mkdtemp(path.join(config.root, ".docs-build-"));
  try {
    for (const [name, buffer] of files) {
      const target = path.join(temporary, name.slice(1));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }
    await writeFile(path.join(temporary, marker), "safibook\n");
    await rm(out, { recursive: true, force: true });
    await rename(temporary, out);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  return out;
}
