import { resolve, operations, parameters, schema, mediaExample } from "./model.js";

export async function mountApiReference(root, anchor = "", documentId = "api/README") {
const document = root;
const base = new URL("./", import.meta.url);
root.innerHTML = `<link rel="stylesheet" href="${new URL("viewer.css", base).href}">
<div class="spec-status" id="spec-status" role="status">API 명세를 불러오는 중입니다.</div>
<div class="docs-layout" id="docs-layout" hidden>
<aside class="navigation" aria-label="API 기능 목록"><nav id="groups"></nav><a class="download" href="${new URL("openapi.json", base).href}" download>OpenAPI 명세 다운로드 ↗</a></aside>
<main id="content" tabindex="-1"></main>
<aside class="page-toc" aria-label="현재 페이지 API 목차"><span>이 페이지의 API</span><nav id="toc"></nav></aside></div>`;
let selection = anchor.startsWith("group:") ? { group: anchor.slice(6) } : { operation: anchor };
function reveal(element) {
  if (element) element.scrollIntoView({ block: "start" });
  else window.scrollTo(0, 0);
}

const status = document.querySelector("#spec-status");
const content = document.querySelector("#content");
const groupNav = document.querySelector("#groups");
const toc = document.querySelector("#toc");
const escape = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const description = (value) => value?.["x-doc-description"] || (value?.description ? `<p>${escape(value.description)}</p>` : "");
const badge = (method) => `<span class="method ${method}">${method.toUpperCase()}</span>`;
const json = (value) => JSON.stringify(value, null, 2) ?? "null";
const token = (kind, value) => `<span class="syntax-${kind}">${escape(value)}</span>`;

function highlightJson(value) {
  const pattern = /"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b|[{}\[\],:]/g;
  let html = "";
  let end = 0;
  for (const match of value.matchAll(pattern)) {
    html += escape(value.slice(end, match.index));
    const text = match[0];
    const kind = text.startsWith('"')
      ? /^\s*:/.test(value.slice(match.index + text.length)) ? "key" : "string"
      : /^[{}\[\],:]$/.test(text) ? "punctuation"
      : /^(true|false|null)$/.test(text) ? "literal" : "number";
    html += token(kind, text);
    end = match.index + text.length;
  }
  return html + escape(value.slice(end));
}

function highlightSample(raw) {
  const value = String(raw);
  const first = value.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE) (.+) (HTTP\/\d(?:\.\d)?)$/m);
  if (!first || first.index !== 0) return /^[\s]*[\[{"\d-]|^(true|false|null)$/.test(value) ? highlightJson(value) : escape(value);
  const [header, ...body] = value.split("\n\n");
  const lines = header.split("\n");
  lines[0] = `${token("method", first[1])} ${escape(first[2])} ${token("protocol", first[3])}`;
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(":");
    lines[i] = colon < 0 ? escape(lines[i]) : `${token("key", lines[i].slice(0, colon))}${token("punctuation", ":")}${token("string", lines[i].slice(colon + 1))}`;
  }
  const payload = body.join("\n\n");
  return lines.join("\n") + (body.length ? `\n\n${/^\s*[\[{]/.test(payload) ? highlightJson(payload) : escape(payload)}` : "");
}

const code = (value) => `<pre tabindex="0"><code>${highlightSample(value)}</code></pre>`;
const time = (value) => value && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "미확인";
let spec, all, groups;

function typeLabel(raw, depth = 0) {
  if (depth > 6) return "object";
  const value = schema(spec, raw);
  if (value.oneOf || value.anyOf) return (value.oneOf || value.anyOf).map((variant) => typeLabel(variant, depth + 1)).join(" | ");
  if (value.type === "array" || value.items) return `${typeLabel(value.items, depth + 1)}[]`;
  return `${Array.isArray(value.type) ? value.type.join(" | ") : value.type || (value.properties ? "object" : "미지정")}${value.format ? ` · ${value.format}` : ""}`;
}

function fields(raw, depth = 0, seen = new Set(), mode = "response") {
  if (!raw) return "";
  if (depth > 6 || (raw.$ref && seen.has(raw.$ref))) return '<p class="muted">참조 모델이 반복됩니다. 전체 정의는 OpenAPI 명세에서 확인하세요.</p>';
  const next = new Set(seen);
  if (raw.$ref) next.add(raw.$ref);
  const value = schema(spec, raw);
  const variants = value.oneOf || value.anyOf;
  if (variants) return variants.map((variant, i) => `<details class="model"><summary>${value.oneOf ? "oneOf" : "anyOf"} · ${i + 1}번째 모델</summary>${fields(variant, depth + 1, next, mode)}</details>`).join("");
  if (value.items) return fields(value.items, depth + 1, next, mode);
  if (!value.properties) return `<div class="field"><code>${escape(typeLabel(raw))}</code>${description(value)}${value.enum ? `<p>허용 값: ${value.enum.map((v) => `<code>${escape(json(v))}</code>`).join(" ")}</p>` : ""}${value.additionalProperties ? '<p class="muted">추가 키를 허용하는 객체입니다.</p>' : ""}</div>`;
  return Object.entries(value.properties).filter(([, prop]) => !resolve(spec, prop)[mode === "request" ? "readOnly" : "writeOnly"]).map(([name, prop]) => {
    const item = schema(spec, prop);
    const nested = item.properties || item.items || item.oneOf || item.anyOf;
    const constraints = [item.enum && `허용 값: ${item.enum.map((v) => json(v)).join(", ")}`, item.default !== undefined && `기본값: ${json(item.default)}`, item.nullable && "null 허용", item.minLength !== undefined && `최소 길이: ${item.minLength}`, item.maxLength !== undefined && `최대 길이: ${item.maxLength}`, item.minimum !== undefined && `최솟값: ${item.minimum}`, item.maximum !== undefined && `최댓값: ${item.maximum}`, item.pattern && `패턴: ${item.pattern}`].filter(Boolean);
    return `<div class="field"><div class="field-heading"><code>${escape(name)}</code><span class="field-type">${escape(typeLabel(prop))}</span><span class="${value.required?.includes(name) ? "required" : "muted"}">${value.required?.includes(name) ? "필수" : "선택"}</span>${item.deprecated ? '<span class="deprecated">사용 중단 예정</span>' : ""}</div>${description(item)}${constraints.map((c) => `<div class="constraint">${escape(c)}</div>`).join("")}${nested ? `<details class="model"><summary>모델 펼치기</summary>${fields(prop, depth + 1, next, mode)}</details>` : ""}</div>`;
  }).join("");
}

function security(op) {
  const requirements = op.security ?? spec.security ?? [];
  if (!requirements.length) return '<p class="muted">명세에 인증 요구사항이 없습니다.</p>';
  return requirements.map((requirement) => {
    if (!Object.keys(requirement).length) return '<p class="muted">인증 없이 접근할 수 있는 대안이 있습니다.</p>';
    return `<div class="security-option">${Object.entries(requirement).map(([name, scopes]) => {
      const value = resolve(spec, spec.components?.securitySchemes?.[name]);
      return `<div><code>${escape(name)}</code> <span class="muted">${escape(value.type || "")}${value.scheme ? ` · ${escape(value.scheme)}` : ""}${value.in ? ` · ${escape(value.in)}: ${escape(value.name)}` : ""}</span>${description(value)}${scopes.length ? `<p>필요 scope: ${scopes.map(escape).join(", ")}</p>` : ""}</div>`;
    }).join('<span class="muted">그리고</span>')}</div>`;
  }).join('<p class="muted">또는</p>');
}

function parameterFields(op) {
  const params = parameters(spec, op);
  return ["path", "query", "header", "cookie"].map((location) => {
    const selected = params.filter((p) => p.in === location);
    if (!selected.length) return "";
    return `<h3>${({ path: "경로", query: "쿼리", header: "헤더", cookie: "쿠키" })[location]} 파라미터</h3>${selected.map((p) => `<div class="field"><div class="field-heading"><code>${escape(p.name)}</code><span class="field-type">${escape(typeLabel(p.schema))}</span><span class="${p.required || p.in === "path" ? "required" : "muted"}">${p.required || p.in === "path" ? "필수" : "선택"}</span></div>${description(p)}${p.schema?.enum ? `<p>허용 값: ${p.schema.enum.map((v) => `<code>${escape(json(v))}</code>`).join(" ")}</p>` : ""}</div>`).join("")}`;
  }).join("");
}

function mediaSelector(entries, kind) {
  return entries.length > 1 ? `<label class="media-label">형식 <select data-media="${kind}">${entries.map(([type]) => `<option>${escape(type)}</option>`).join("")}</select></label>` : `<span class="muted">${escape(entries[0]?.[0] || "")}</span>`;
}

function requestPanel(op, body) {
  const entries = Object.entries(body.content || {});
  return `<div class="request-content">${entries.map(([type, media], i) => `<div data-media-panel="request" data-type="${escape(type)}" ${i ? "hidden" : ""}><h3>요청 본문 ${body.required ? '<span class="required">필수</span>' : '<span class="muted">선택</span>'}</h3>${description(body)}${fields(media.schema, 0, new Set(), "request")}</div>`).join("")}</div>`;
}

function requestSample(op, type, media) {
  const server = op.servers?.[0] || op.item.servers?.[0] || spec.servers?.[0];
  let base = server?.url || "";
  base = base.replace(/\{([^}]+)\}/g, (whole, key) => server.variables?.[key]?.default ?? whole).replace(/\/$/, "");
  let path = op.path;
  const query = [];
  const headers = [];
  const cookies = [];
  for (const parameter of parameters(spec, op)) {
    const value = parameter.example ?? parameter.schema?.example ?? parameter.schema?.default ?? `<${parameter.name}>`;
    if (parameter.in === "path") path = path.replace(`{${parameter.name}}`, String(value));
    if (parameter.in === "query") query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(value))}`);
    if (parameter.in === "header") headers.push(`${parameter.name}: ${value}`);
    if (parameter.in === "cookie") cookies.push(`${parameter.name}=${value}`);
  }
  const requirement = (op.security ?? spec.security ?? [])[0] || {};
  for (const name of Object.keys(requirement)) {
    const auth = resolve(spec, spec.components?.securitySchemes?.[name]);
    if (auth.type === "http") headers.push(`Authorization: ${auth.scheme === "basic" ? "Basic <BASE64_CREDENTIALS>" : "Bearer <TOKEN>"}`);
    if (auth.type === "oauth2" || auth.type === "openIdConnect") headers.push("Authorization: Bearer <TOKEN>");
    if (auth.type === "apiKey") {
      if (auth.in === "header") headers.push(`${auth.name}: <API_KEY>`);
      if (auth.in === "query") query.push(`${encodeURIComponent(auth.name)}=<API_KEY>`);
      if (auth.in === "cookie") cookies.push(`${auth.name}=<API_KEY>`);
    }
  }
  if (cookies.length) headers.push(`Cookie: ${cookies.join("; ")}`);
  if (type) headers.push(`Content-Type: ${type}`);
  const target = `${base}${path}${query.length ? `?${query.join("&")}` : ""}`;
  let first;
  try { const url = new URL(target); first = `${op.method.toUpperCase()} ${url.pathname}${url.search} HTTP/1.1\nHost: ${url.host}`; }
  catch { first = `${op.method.toUpperCase()} ${target} HTTP/1.1`; }
  const body = media ? mediaExample(spec, media, "request") : undefined;
  return `${first}${headers.length ? `\n${headers.join("\n")}` : ""}${media ? `\n\n${type.includes("json") ? json(body) : typeof body === "string" ? body : json(body)}` : ""}`;
}

function responses(op) {
  const entries = Object.entries(op.responses || {}).map(([code, value]) => [code, resolve(spec, value)]);
  if (!entries.length) return '<p class="muted">응답이 정의되지 않았습니다.</p>';
  return `<h3>응답</h3><div class="response-tabs" role="group" aria-label="응답 코드">${entries.map(([code], i) => `<button type="button" class="${i ? "" : "selected"}" data-response="${escape(code)}" aria-pressed="${!i}">${escape(code)}</button>`).join("")}</div>${entries.map(([code, response], i) => `<div data-response-panel="${escape(code)}" ${i ? "hidden" : ""}>${description(response)}${Object.entries(response.headers || {}).length ? `<h4>응답 헤더</h4>${Object.entries(response.headers).map(([name, raw]) => { const header = resolve(spec, raw); return `<div class="field"><code>${escape(name)}</code> <span class="muted">${escape(typeLabel(header.schema))}</span>${description(header)}</div>`; }).join("")}` : ""}${Object.entries(response.content || {}).map(([type, media]) => `<h4>${escape(type)}</h4>${fields(media.schema)}`).join("") || '<p class="muted">응답 본문이 없습니다.</p>'}</div>`).join("")}`;
}

function sampleCard(title, sample, extra = "") {
  return `<div class="sample-card"><div class="sample-heading"><span>${title}</span>${extra}<button type="button" data-copy aria-label="예시 복사">복사</button></div>${code(sample)}</div>`;
}

function operationPage(op, index) {
  const body = resolve(spec, op.requestBody);
  const requestEntries = Object.entries(body.content || {});
  const responseEntries = Object.entries(op.responses || {});
  return `<section class="operation" id="operation-${index}" data-operation="${escape(op.key)}"><div class="operation-title"><h2>${escape(op.summary || op.key)}</h2>${op.deprecated ? '<span class="deprecated">사용 중단 예정</span>' : ""}<a class="permalink" href="#/${encodeURIComponent(documentId)}/${encodeURIComponent(op.key)}" data-api-anchor="${escape(op.key)}" aria-label="이 API 링크">#</a></div><div class="endpoint">${badge(op.method)}<code>${escape(op.path)}</code></div><div class="operation-columns"><div class="operation-document">${description(op)}<h3>인증</h3>${security(op)}${parameterFields(op)}${requestPanel(op, body)}${responses(op)}</div><aside class="samples" aria-label="요청 및 응답 예시">${requestEntries.length ? mediaSelector(requestEntries, "request") : ""}${(requestEntries.length ? requestEntries : [["", null]]).map(([type, media], i) => `<div data-request-sample="${escape(type)}" ${i ? "hidden" : ""}>${sampleCard(`${badge(op.method)} 요청 예시`, requestSample(op, type, media))}</div>`).join("")}${responseEntries.map(([code, raw], i) => {
    const response = resolve(spec, raw);
    const media = Object.entries(response.content || {});
    return `<div data-response-sample="${escape(code)}" ${i ? "hidden" : ""}>${media.length ? media.map(([type, value]) => sampleCard(`<span class="response-code">${escape(code)}</span> 응답 예시`, type.includes("json") ? json(mediaExample(spec, value)) : typeof mediaExample(spec, value) === "string" ? mediaExample(spec, value) : json(mediaExample(spec, value)), `<span class="sample-type">${escape(type)}</span>`)).join("") : sampleCard(`${escape(code)} 응답`, "응답 본문 없음")}</div>`;
  }).join("")}</aside></div></section>`;
}

function route() {
  const requested = selection.operation;
  const op = all.find((item) => item.key === requested || item.operationId === requested);
  return { group: selection.group || op?.group || groups[0], requested, op };
}

function render() {
  const current = route();
  const matches = all;
  const visibleGroups = groups.filter((group) => matches.some((op) => op.group === group));
  const selected = visibleGroups.includes(current.group) ? current.group : visibleGroups[0];
  groupNav.innerHTML = visibleGroups.map((group) => `<a href="#/${encodeURIComponent(documentId)}/${encodeURIComponent(`group:${group}`)}" data-api-anchor="${escape(`group:${group}`)}" class="group-link ${group === selected ? "active" : ""}" ${group === selected ? 'aria-current="page"' : ""}><span>${escape(group)}</span><span class="count">${matches.filter((op) => op.group === group).length}</span></a>`).join("") || '<p class="empty">검색 결과가 없습니다.</p>';
  const visible = matches.filter((op) => op.group === selected);
  const tag = (spec.tags || []).find((tag) => tag.name === selected);
  content.innerHTML = `<header class="group-header"><div class="eyebrow">API Reference${spec.info?.version ? ` · ${escape(spec.info.version)}` : ""}</div><h1>${escape(selected || "검색 결과 없음")}</h1>${description(tag)}<p class="muted">${visible.length}개 API</p>${current.requested && !current.op ? `<p class="route-warning">현재 명세에 ${escape(current.requested)} 경로가 없습니다.</p>` : ""}</header>${visible.map(operationPage).join("") || '<p class="empty">다른 기능명이나 경로로 검색해보세요.</p>'}`;
  const blocks = [...content.querySelectorAll("pre > code, div.mermaid")].filter((code) => code.classList.contains("mermaid") || code.classList.contains("language-mermaid") || code.textContent.trimStart().startsWith("sequenceDiagram"));
  if (blocks.length) import("../diagrams.js").then(({ renderDiagrams }) => renderDiagrams(blocks, { buttonOnly: true })).catch(() => {});
  toc.innerHTML = visible.map((op, index) => `<a href="#/${encodeURIComponent(documentId)}/${encodeURIComponent(op.key)}" data-api-anchor="${escape(op.key)}" data-scroll="operation-${index}">${badge(op.method)}<span>${escape(op.summary || op.path)}</span></a>`).join("");
  const index = visible.findIndex((op) => op === current.op);
  reveal(index >= 0 ? document.querySelector(`#operation-${index}`) : null);
}

content.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.hasAttribute("data-copy")) {
    try {
      await navigator.clipboard.writeText(button.closest(".sample-card").querySelector("code").textContent);
      button.textContent = "복사됨";
      setTimeout(() => { button.textContent = "복사"; }, 1600);
    } catch { button.textContent = "텍스트를 선택해 복사하세요"; }
  }
  if (button.dataset.response) {
    const section = button.closest(".operation");
    const selected = button.dataset.response;
    for (const tab of section.querySelectorAll("[data-response]")) {
      tab.classList.toggle("selected", tab.dataset.response === selected);
      tab.setAttribute("aria-pressed", String(tab.dataset.response === selected));
    }
    for (const panel of section.querySelectorAll("[data-response-panel]")) panel.hidden = panel.dataset.responsePanel !== selected;
    for (const panel of section.querySelectorAll("[data-response-sample]")) panel.hidden = panel.dataset.responseSample !== selected;
  }
});
content.addEventListener("change", (event) => {
  if (!event.target.dataset.media) return;
  const section = event.target.closest(".operation");
  for (const panel of section.querySelectorAll('[data-media-panel="request"]')) panel.hidden = panel.dataset.type !== event.target.value;
  for (const sample of section.querySelectorAll("[data-request-sample]")) sample.hidden = sample.dataset.requestSample !== event.target.value;
});
root.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-api-anchor]");
  if (!link) return;
  event.preventDefault();
  const anchor = link.dataset.apiAnchor;
  selection = anchor.startsWith("group:") ? { group: anchor.slice(6) } : { operation: anchor };
  history.replaceState(null, "", `#/${encodeURIComponent(documentId)}/${encodeURIComponent(anchor)}`);
  render();
});

try {
  const metadataResponse = await fetch(new URL("spec-metadata.json", base));
  if (!metadataResponse.ok) throw new Error("API 명세 상태를 불러오지 못했습니다.");
  const metadata = await metadataResponse.json();
  if (metadata.available === false) throw new Error(metadata.status === "not-generated" ? "아직 가져온 API 명세가 없습니다." : `명세 다운로드 실패 · ${time(metadata.failedAt)} KST. 다음 배포에서 다시 가져옵니다.`);
  const response = await fetch(new URL("documentation.json", base));
  if (!response.ok) throw new Error("API 명세 파일을 불러오지 못했습니다.");
  spec = await response.json();
  all = operations(spec);
  if (!all.length) throw new Error("표시할 API 경로가 없습니다.");
  groups = [...new Set([...(spec.tags || []).map((tag) => tag.name), ...all.map((op) => op.group)])].filter((group) => all.some((op) => op.group === group));
  status.hidden = true;
  document.querySelector("#docs-layout").hidden = false;
  render();
} catch (error) {
  status.classList.add("spec-status-failed");
  status.setAttribute("role", "alert");
  status.textContent = `API 명세를 표시하지 못했습니다. ${error.message}`;
}

}
