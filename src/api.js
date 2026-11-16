import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";
import { operations, resolve } from "../client/api-reference/model.js";

const markdown = new MarkdownIt({ html: true, linkify: true });

function searchText(spec, value, seen = new Set()) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  if (value.$ref && seen.has(value.$ref)) return "";
  const next = new Set(seen);
  if (value.$ref) next.add(value.$ref);
  const resolved = resolve(spec, value);
  return Object.entries(resolved).filter(([key]) => !["example", "examples", "default", "x-doc-description"].includes(key)).map(([key, child]) => `${key} ${searchText(spec, child, next)}`).join(" ");
}

function includeApiSearch(files, spec, documentId) {
  const site = JSON.parse(files.get("/site.json").toString());
  const doc = site.documents.find((item) => item.id === documentId);
  if (!doc) return;
  doc.sections.push(...operations(spec).map((op) => ({
    anchor: op.key,
    title: `${op.group} · ${op.summary || op.key}`,
    text: `${op.key} ${op.operationId || ""} ${op.tags?.join(" ") || ""} ${sanitizeHtml(markdown.render(op.description || ""), { allowedTags: [], allowedAttributes: {} })} ${searchText(spec, { parameters: [...(op.item.parameters || []), ...(op.parameters || [])], requestBody: op.requestBody, responses: op.responses })}`,
  })));
  files.set("/site.json", Buffer.from(JSON.stringify(site)));
}

function presentDescriptions(value) {
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) presentDescriptions(child);
  if (typeof value.description === "string") {
    value["x-doc-description"] = sanitizeHtml(markdown.render(value.description), {
      allowedTags: [...sanitizeHtml.defaults.allowedTags, "details", "summary"],
      allowedAttributes: { a: ["href", "title"], code: ["class"], div: ["class"] },
    });
  }
}

export async function extendSiteFiles(files, config) {
  if (!config.api) return;
  const client = fileURLToPath(new URL("../client/api-reference/", import.meta.url));
  const site = JSON.parse(files.get("/site.json").toString());
  const doc = site.documents.find((item) => item.id === config.api.document);
  if (!doc) throw new Error(`API 문서를 찾을 수 없습니다: ${config.api.document}`);
  doc.apiReference = true;
  files.set("/site.json", Buffer.from(JSON.stringify(site)));
  for (const name of ["index.html", "viewer.js", "standalone.js", "model.js", "viewer.css", "page.js", "page.css"]) {
    files.set(`/api-reference/${name}`, await readFile(path.join(client, name)));
  }
  files.set("/index.html", Buffer.from(files.get("/index.html").toString().replace("</head>", '<link rel="stylesheet" href="./api-reference/page.css" /></head>')));
  const metadata = await readFile(config.api.metadata).catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return Buffer.from(JSON.stringify({ available: true, status: "ready" }));
  });
  if (JSON.parse(metadata).available !== false) {
    const spec = await readFile(config.api.spec).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (!spec) {
      files.set("/api-reference/spec-metadata.json", Buffer.from(JSON.stringify({ available: false, status: "not-generated" })));
      return;
    }
    const parsed = JSON.parse(spec);
    if (!/^3\./.test(parsed.openapi) || !parsed.paths || !parsed.info) {
      throw new Error("api/openapi.json에 유효한 OpenAPI 3 명세가 필요합니다.");
    }
    files.set("/api-reference/openapi.json", spec);
    includeApiSearch(files, parsed, config.api.document);
    presentDescriptions(parsed);
    files.set("/api-reference/documentation.json", Buffer.from(JSON.stringify(parsed)));
  }
  files.set("/api-reference/spec-metadata.json", metadata);
}
