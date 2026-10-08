import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import MarkdownIt from "markdown-it";
import container from "markdown-it-container";
import GithubSlugger from "github-slugger";
import sanitizeHtml from "sanitize-html";
import { inside } from "./config.js";

const assetExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
]);
const escape = (text) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const route = (id, anchor = "") =>
  `#/${encodeURIComponent(id)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}`;
const inlineText = (token) =>
  (token.children || [])
    .map((child) =>
      child.type === "softbreak" || child.type === "hardbreak"
        ? " "
        : child.content || "",
    )
    .join("");

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (
      entry.name.startsWith(".") ||
      entry.name === "node_modules" ||
      entry.isSymbolicLink()
    )
      continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else if (/\.md$/i.test(entry.name)) files.push(file);
  }
  return files.sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}

export async function collectSite(config) {
  const documents = [];
  for (const tab of config.tabs) {
    for (const file of await walk(tab.dir)) {
      const relative = path.relative(tab.dir, file).split(path.sep).join("/");
      documents.push({
        id: `${tab.slug}/${relative.replace(/\.md$/i, "")}`,
        tab: tab.slug,
        path: relative,
        file,
        source: await readFile(file, "utf8"),
      });
    }
  }
  const byFile = new Map(documents.map((doc) => [doc.file, doc]));
  const assets = new Map();
  for (const doc of documents) {
    const slugger = new GithubSlugger();
    const md = new MarkdownIt({
      html: false,
      linkify: true,
      typographer: false,
    });
    let searchIndex = 0;
    md.use(container, "search", {
      render(tokens, index) {
        if (tokens[index].nesting === -1) return "</div></section>\n";
        const label =
          tokens[index].info.trim().slice(6).trim() || "이 섹션 검색";
        const id = `section-search-${searchIndex++}`;
        return `<section class="search-section"><div class="section-tools"><label for="${id}">${escape(label)}</label><input id="${id}" type="search" data-section-search placeholder="섹션 안에서 찾기"/><span class="match-count" aria-live="polite"></span><button type="button" data-find-prev aria-label="이전 일치">↑</button><button type="button" data-find-next aria-label="다음 일치">↓</button></div><div class="section-content">`;
      },
    });
    const tokens = md.parse(doc.source, {});
    const toc = [];
    const sections = [{ anchor: "", title: "", text: "" }];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === "heading_open") {
        const title = inlineText(tokens[i + 1]);
        const anchor = slugger.slug(title) || slugger.slug("section");
        token.attrSet("id", anchor);
        const level = Number(token.tag.slice(1));
        toc.push({ title, anchor, level });
        sections.push({ anchor, title, text: "" });
      }
      if (token.type === "inline")
        sections.at(-1).text += `${inlineText(token)}\n`;
      if (token.type === "fence" || token.type === "code_block")
        sections.at(-1).text += `${token.content}\n`;
      for (const child of token.children || []) {
        if (child.type !== "link_open" && child.type !== "image") continue;
        const attr = child.type === "image" ? "src" : "href";
        const href = child.attrGet(attr);
        if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue;
        if (href.startsWith("#")) {
          child.attrSet(attr, route(doc.id, decodeURIComponent(href.slice(1))));
          continue;
        }
        const [pathname, fragment = ""] = href.split("#");
        const local = path.resolve(
          path.dirname(doc.file),
          decodeURIComponent(pathname.split("?")[0]),
        );
        if (byFile.has(local)) {
          child.attrSet(
            attr,
            route(byFile.get(local).id, decodeURIComponent(fragment)),
          );
          continue;
        }
        if (/\.md$/i.test(local))
          throw new Error(`깨진 문서 링크: ${doc.path} → ${href}`);
        if (!assetExtensions.has(path.extname(local).toLowerCase()))
          throw new Error(
            `지원하지 않는 로컬 첨부 파일: ${doc.path} → ${href}`,
          );
        const actual = await realpath(local);
        if (!config.tabs.some((tab) => inside(tab.dir, actual)))
          throw new Error(`문서 폴더 밖의 첨부 파일: ${href}`);
        const buffer = await readFile(actual);
        const name = `${createHash("sha256").update(buffer).digest("hex").slice(0, 20)}${path.extname(actual).toLowerCase()}`;
        assets.set(name, buffer);
        child.attrSet(
          attr,
          `./assets/${name}${fragment ? `#${fragment}` : ""}`,
        );
      }
    }
    doc.title =
      toc.find((heading) => heading.level === 1)?.title ||
      path.basename(doc.path, path.extname(doc.path));
    doc.toc = toc;
    doc.sections = sections
      .filter((section) => section.text.trim())
      .map((section) => ({ ...section, title: section.title || doc.title }));
    doc.html = sanitizeHtml(md.renderer.render(tokens, md.options, {}), {
      allowedTags: [
        ...sanitizeHtml.defaults.allowedTags,
        "img",
        "input",
        "button",
        "section",
        "mark",
        "label",
      ],
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        "*": ["class", "id"],
        a: ["href", "title"],
        img: ["src", "alt", "title"],
        input: ["id", "type", "data-section-search", "placeholder"],
        label: ["for"],
        button: ["type", "data-find-prev", "data-find-next", "aria-label"],
        span: ["class", "aria-live"],
      },
    });
    delete doc.source;
    delete doc.file;
  }
  return {
    data: {
      title: config.title,
      description: config.description,
      tabs: config.tabs.map(({ title, slug }) => ({ title, slug })),
      documents,
    },
    assets,
  };
}
