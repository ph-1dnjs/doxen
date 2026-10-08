import { searchDocuments, matchRanges } from "./search.js";

const $ = (selector) => document.querySelector(selector);
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const route = (id, anchor = "") =>
  `#/${encodeURIComponent(id)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}`;
let site;
let current;
let activeTab;
let pendingQuery = "";
const dialog = $("#search-dialog");

function clearMarks(root) {
  for (const mark of root.querySelectorAll("mark[data-hit]"))
    mark.replaceWith(document.createTextNode(mark.textContent));
  root.normalize();
}

function highlight(root, query) {
  clearMarks(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement.closest(".section-tools, script, style")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  const hits = [];
  for (const node of nodes) {
    const ranges = matchRanges(node.textContent, query);
    if (!ranges.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const [start, end] of ranges) {
      fragment.append(
        document.createTextNode(node.textContent.slice(offset, start)),
      );
      const mark = el("mark", node.textContent.slice(start, end));
      mark.dataset.hit = "";
      fragment.append(mark);
      hits.push(mark);
      offset = end;
    }
    fragment.append(document.createTextNode(node.textContent.slice(offset)));
    node.replaceWith(fragment);
  }
  return hits;
}

let finders = [];
function attachFinder(input, root, count, prev, next) {
  let hits = [];
  let index = -1;
  const state = {
    input,
    reset() {
      hits = [];
      index = -1;
      count.textContent = "";
      prev.disabled = next.disabled = true;
    },
  };
  finders.push(state);
  const update = () => {
    count.textContent = input.value
      ? `${index < 0 ? 0 : index + 1} / ${hits.length}`
      : "";
    prev.disabled = next.disabled = !hits.length;
  };
  const move = (direction) => {
    if (!hits.length) return;
    hits[index]?.classList.remove("active-hit");
    index = (index + direction + hits.length) % hits.length;
    hits[index].classList.add("active-hit");
    hits[index].scrollIntoView({ block: "center", behavior: "smooth" });
    update();
  };
  input.oninput = () => {
    for (const finder of finders)
      if (finder !== state) {
        finder.input.value = "";
        finder.reset();
      }
    clearMarks($("#article"));
    hits = highlight(root, input.value);
    index = -1;
    if (hits.length) move(1);
    else update();
  };
  input.onkeydown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      move(event.shiftKey ? -1 : 1);
    }
  };
  prev.onclick = () => move(-1);
  next.onclick = () => move(1);
  state.reset();
}

function renderNavigation() {
  $("#tabs").replaceChildren();
  for (const tab of site.tabs) {
    const first = site.documents.find((doc) => doc.tab === tab.slug);
    const link = el("a", tab.title, tab.slug === activeTab ? "active" : "");
    link.href = first ? route(first.id) : route(`${tab.slug}/`);
    if (tab.slug === activeTab) link.setAttribute("aria-current", "page");
    $("#tabs").append(link);
  }
  $("#documents").replaceChildren();
  let lastFolder;
  for (const doc of site.documents.filter((item) => item.tab === activeTab)) {
    const folder = doc.path.includes("/")
      ? doc.path.slice(0, doc.path.lastIndexOf("/"))
      : "";
    if (folder && folder !== lastFolder)
      $("#documents").append(
        el("div", folder.replaceAll("/", " / "), "folder"),
      );
    lastFolder = folder;
    const link = el("a", doc.title, doc.id === current?.id ? "selected" : "");
    link.href = route(doc.id);
    if (doc.id === current?.id) link.setAttribute("aria-current", "page");
    $("#documents").append(link);
  }
}

function render() {
  let id, anchor;
  try {
    [id, anchor] = location.hash.slice(2).split("/").map(decodeURIComponent);
  } catch {
    id = "invalid";
  }
  current = id
    ? site.documents.find((doc) => doc.id === id)
    : site.documents[0];
  activeTab =
    current?.tab ||
    site.tabs.find((tab) => id?.startsWith(`${tab.slug}/`))?.slug ||
    site.tabs[0].slug;
  renderNavigation();
  $("#toc").replaceChildren();
  $("#pagination").replaceChildren();
  $("#page-search").value = "";
  finders = [];
  if (!current) {
    $("#article").replaceChildren(
      el(
        "h1",
        id?.endsWith("/") || !id
          ? "아직 문서가 없습니다"
          : "문서를 찾을 수 없습니다",
      ),
      el(
        "p",
        "설정된 폴더에 Markdown 파일을 추가하거나 왼쪽 목록에서 문서를 선택하세요.",
      ),
    );
    $(".document-tools").hidden = true;
    $("#breadcrumb").textContent = site.tabs.find(
      (tab) => tab.slug === activeTab,
    ).title;
    return;
  }
  $(".document-tools").hidden = false;
  document.title = `${current.title} · ${site.title}`;
  $("#breadcrumb").textContent =
    `${site.tabs.find((tab) => tab.slug === current.tab).title} / ${current.path}`;
  $("#article").innerHTML = current.html;
  if (!$("#article h1")) $("#article").prepend(el("h1", current.title));
  for (const heading of current.toc) {
    const link = el("a", heading.title);
    link.href = route(current.id, heading.anchor);
    link.style.paddingLeft = `${Math.max(0, heading.level - 2) * 12}px`;
    $("#toc").append(link);
  }
  const siblings = site.documents.filter((doc) => doc.tab === activeTab);
  const index = siblings.indexOf(current);
  for (const [label, doc] of [
    ["← 이전 문서", siblings[index - 1]],
    ["다음 문서 →", siblings[index + 1]],
  ]) {
    if (!doc) {
      $("#pagination").append(el("span"));
      continue;
    }
    const link = el("a");
    link.href = route(doc.id);
    link.append(el("small", label), el("strong", doc.title));
    $("#pagination").append(link);
  }
  attachFinder(
    $("#page-search"),
    $("#article"),
    $("#page-count"),
    $("#page-prev"),
    $("#page-next"),
  );
  for (const section of document.querySelectorAll(".search-section"))
    attachFinder(
      section.querySelector("[data-section-search]"),
      section.querySelector(".section-content"),
      section.querySelector(".match-count"),
      section.querySelector("[data-find-prev]"),
      section.querySelector("[data-find-next]"),
    );
  if (pendingQuery) {
    $("#page-search").value = pendingQuery;
    $("#page-search").oninput();
    pendingQuery = "";
  }
  if (anchor) {
    const heading = [...$("#article").querySelectorAll("[id]")].find(
      (node) => node.id === anchor,
    );
    requestAnimationFrame(() => heading?.scrollIntoView({ block: "start" }));
  } else window.scrollTo(0, 0);
}

function renderResults() {
  const query = $("#global-search").value;
  const results = searchDocuments(site.documents, query);
  $("#search-count").textContent = query.trim()
    ? results.length
      ? `${results.length}개 결과${results.length === 80 ? " (최대 80개 표시)" : ""}`
      : "일치하는 내용이 없습니다."
    : "한국어와 영문으로 모든 탭의 내용을 검색합니다.";
  $("#results").replaceChildren();
  for (const { doc, section } of results) {
    const link = el("a", undefined, "result");
    link.href = route(doc.id, section.anchor);
    const title = el("strong", section.title);
    const ranges = matchRanges(section.text, query);
    const start = Math.max(0, (ranges[0]?.[0] || 0) - 45);
    const snippet = el(
      "p",
      `${start ? "…" : ""}${section.text.slice(start, start + 180)}${section.text.length > start + 180 ? "…" : ""}`,
    );
    link.append(
      el(
        "small",
        `${site.tabs.find((tab) => tab.slug === doc.tab).title} / ${doc.title}`,
      ),
      title,
      snippet,
    );
    highlight(title, query);
    highlight(snippet, query);
    link.onclick = () => {
      pendingQuery = query;
      dialog.close();
      if (location.hash === link.hash) render();
    };
    $("#results").append(link);
  }
}

const openSearch = () => {
  if (!site) return;
  dialog.showModal();
  $("#global-search").focus();
  renderResults();
};
$("#open-search").onclick = openSearch;
$("#close-search").onclick = () => dialog.close();
$("#global-search").oninput = renderResults;
$("#global-search").onkeydown = (event) => {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    $("#results a")?.focus();
  } else if (event.key === "Enter") $("#results a")?.click();
};
$("#results").onkeydown = (event) => {
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const links = [...$("#results").children];
  links[
    (links.indexOf(document.activeElement) +
      (event.key === "ArrowDown" ? 1 : -1) +
      links.length) %
      links.length
  ]?.focus();
};
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (!dialog.open) openSearch();
  }
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});
window.addEventListener("hashchange", () => {
  if (site) render();
});
$(".skip-link").onclick = (event) => {
  event.preventDefault();
  $("#content").focus();
  $("#content").scrollIntoView();
};
try {
  const response = await fetch("./site.json");
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  site = await response.json();
  $("#site-title").textContent = site.title;
  render();
} catch (error) {
  $("#article").replaceChildren(
    el("h1", "문서를 불러오지 못했습니다"),
    el("p", `정적 HTTP 서버에서 사이트를 열어주세요. ${error.message}`),
  );
}
