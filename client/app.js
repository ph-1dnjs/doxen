import { searchDocuments, matchRanges, matchesRow } from "./search.js";
import { attachComments } from "./comments.js";

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
      return node.parentElement.closest(".section-tools, pre, .diagram, script, style, [hidden]")
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

function attachTableSearches() {
  const article = $("#article");
  const labels = new Map();
  for (const section of article.querySelectorAll(".search-section")) {
    labels.set(section, section.querySelector(".section-tools label")?.textContent);
    section.querySelector(".section-tools")?.remove();
  }
  let heading = current.title;
  let index = 0;
  for (const node of article.querySelectorAll("h1, h2, h3, h4, h5, h6, table")) {
    if (node.tagName !== "TABLE") {
      heading = node.textContent;
      continue;
    }
    const table = node;
    const tools = el("div", undefined, "section-tools");
    const id = `table-search-${index++}`;
    const label = el(
      "label",
      labels.get(table.closest(".search-section")) || `${heading} 표 검색`,
    );
    label.htmlFor = id;
    const input = el("input");
    input.id = id;
    input.type = "search";
    input.dataset.tableSearch = "";
    input.placeholder = "표 안에서 검색";
    const rows = [...table.querySelectorAll("tbody tr")];
    input.oninput = () => {
      clearMarks(table);
      for (const row of rows)
        row.hidden = !matchesRow(
          [...row.cells].map((cell) => cell.textContent).join(" "),
          input.value,
        );
    };
    tools.append(label, input);
    table.before(tools);
  }
}

function renderNavigation(folderPath) {
  $(".sidebar .eyebrow").textContent = site.tabs.find(
    (tab) => tab.slug === activeTab,
  ).title;
  $("#tabs").replaceChildren();
  for (const tab of site.tabs) {
    const first = site.documents.find((doc) => doc.tab === tab.slug);
    const link = el("a", tab.title, tab.slug === activeTab ? "active" : "");
    link.href = first ? route(first.id) : route(`${tab.slug}/`);
    if (tab.slug === activeTab) link.setAttribute("aria-current", "page");
    $("#tabs").append(link);
  }
  $("#documents").replaceChildren();
  const folders = new Map();
  for (const doc of site.documents.filter((item) => item.tab === activeTab)) {
    let parent = $("#documents");
    let key = "";
    for (const part of doc.path.split("/").slice(0, -1)) {
      key += `${part}/`;
      if (!folders.has(key)) {
        const group = el("details", undefined, "folder-group");
        group.open = (current?.path || folderPath || "").startsWith(key);
        const summary = el("summary");
        const link = el("a", part, key === folderPath ? "selected" : "");
        link.href = route(`${activeTab}/${key}`);
        if (key === folderPath) link.setAttribute("aria-current", "page");
        summary.append(link);
        group.append(summary);
        const children = el("div", undefined, "folder-children");
        group.append(children);
        parent.append(group);
        folders.set(key, children);
      }
      parent = folders.get(key);
    }
    const link = el("a", doc.title, doc.id === current?.id ? "selected" : "");
    link.href = route(doc.id);
    if (doc.id === current?.id) link.setAttribute("aria-current", "page");
    parent.append(link);
  }
}

function renderBreadcrumb(parts = [], currentItem) {
  const tab = site.tabs.find((item) => item.slug === activeTab);
  const first = site.documents.find((doc) => doc.tab === activeTab);
  const items = [
    { title: tab.title, id: first?.id || `${activeTab}/` },
    ...parts.map((title, index) => ({
      title,
      id: `${activeTab}/${parts.slice(0, index + 1).join("/")}/`,
    })),
  ];
  if (currentItem) items.push(currentItem);
  const list = el("ol");
  for (const item of items) {
    const entry = el("li");
    const link = el("a", item.title);
    link.href = route(item.id);
    if (item === currentItem) link.setAttribute("aria-current", "page");
    entry.append(link);
    list.append(entry);
  }
  $("#breadcrumb").replaceChildren(list);
}

function renderFolder(folderPath) {
  const title = folderPath.split("/").at(-2);
  document.title = `${title} · ${site.title}`;
  renderBreadcrumb(folderPath.split("/").slice(0, -2), {
    title,
    id: `${activeTab}/${folderPath}`,
  });
  const cards = el("nav", undefined, "folder-cards");
  cards.setAttribute("aria-label", "하위 폴더 및 문서");
  const children = new Map();
  for (const doc of site.documents.filter(
    (item) => item.tab === activeTab && item.path.startsWith(folderPath),
  )) {
    const relative = doc.path.slice(folderPath.length);
    const nested = relative.includes("/");
    const name = relative.split("/")[0];
    const id = nested ? `${activeTab}/${folderPath}${name}/` : doc.id;
    if (!children.has(id)) children.set(id, nested ? name : doc.title);
  }
  for (const [id, name] of children) {
    const link = el("a", name);
    link.href = route(id);
    cards.append(link);
  }
  $("#article").replaceChildren(el("h1", title), cards);
  pendingQuery = "";
  window.scrollTo(0, 0);
}

const columnLetter = (index) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
const ROW_HEAD = 46;
const COL_HEAD = 26;

function prepareSheet(sheet) {
  const source = Array.isArray(sheet.data) ? sheet.data : [];
  const columns = Math.max(1, ...source.map((row) => row.length));
  const rows = (source.length ? source : [[]]).map((row) =>
    Array.from({ length: columns }, (_, c) => row[c] ?? null),
  );
  const widths = Array.from({ length: columns }, (_, c) => {
    let longest = 0;
    for (const row of rows.slice(0, 200)) {
      for (const line of String(row[c] ?? "").split("\n")) {
        let width = 0;
        for (const char of line) width += /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/.test(char) ? 14 : 8;
        longest = Math.max(longest, width);
      }
    }
    return Math.min(340, Math.max(72, longest + 24));
  });
  return { name: String(sheet.sheet ?? ""), rows, widths };
}

function spreadsheetViewer(doc, rawSheets) {
  const sheets = (rawSheets.length ? rawSheets : [{ sheet: "Sheet1", data: [] }]).map(prepareSheet);
  const selection = sheets.map((sheet) => ({ r: sheet.rows.length > 1 ? 1 : 0, c: 0 }));
  const state = { sheet: 0, wrap: false, full: false, query: "", matches: [], matchIndex: -1, expanded: null };
  const button = (text, className, title) => {
    const node = el("button", text, className);
    node.type = "button";
    if (title) node.title = title;
    return node;
  };

  const viewer = el("div", undefined, "sheet-viewer");
  const toolbar = el("div", undefined, "sheet-toolbar");
  const finder = el("label", undefined, "sheet-find");
  const findInput = el("input");
  findInput.type = "search";
  findInput.placeholder = "시트에서 찾기 (Enter: 다음)";
  findInput.setAttribute("aria-label", "시트에서 찾기");
  const matchLabel = el("span", "", "sheet-find-count");
  matchLabel.setAttribute("aria-live", "polite");
  finder.append(el("span", undefined, "sheet-find-icon"), findInput, matchLabel);
  const wrapButton = button("텍스트 줄바꿈", "sheet-button");
  wrapButton.setAttribute("aria-pressed", "false");
  const fullButton = button(undefined, "sheet-full-button", "펼치기");
  fullButton.setAttribute("aria-label", "펼치기");
  fullButton.setAttribute("aria-pressed", "false");
  fullButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7"/></svg>';
  const download = el("a", "다운로드", "sheet-download");
  download.href = doc.spreadsheet.file;
  download.download = doc.title;
  download.setAttribute("aria-label", "엑셀 파일 다운로드");
  toolbar.append(fullButton, finder, el("span", undefined, "sheet-spacer"), wrapButton, download);

  const formula = el("div", undefined, "sheet-formula");
  const nameBox = el("div", "", "sheet-name-box");
  const formulaValue = el("div", "", "sheet-formula-value");
  formula.append(nameBox, el("div", "fx", "sheet-fx"), formulaValue);

  const grid = el("div", undefined, "sheet-grid spreadsheet-table");
  grid.tabIndex = 0;
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", `${doc.title} 시트`);

  const footer = el("div", undefined, "sheet-footer");
  const arrows = el("div", undefined, "sheet-arrows");
  const prev = button("‹", "sheet-arrow", "이전 시트 (Ctrl+PgUp)");
  const next = button("›", "sheet-arrow", "다음 시트 (Ctrl+PgDn)");
  prev.setAttribute("aria-label", "이전 시트");
  next.setAttribute("aria-label", "다음 시트");
  arrows.append(prev, next);
  const tabs = el("div", undefined, "sheet-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "시트 선택");
  const status = el("div", undefined, "sheet-status");
  const statusMessage = el("span", "");
  statusMessage.setAttribute("aria-live", "polite");
  const dims = el("span", "");
  status.append(statusMessage, dims);
  footer.append(arrows, tabs, status);
  viewer.append(toolbar, formula, grid, footer);

  const tabButtons = sheets.map((sheet, i) => {
    const tab = button(undefined, "sheet-tab");
    tab.setAttribute("role", "tab");
    tab.append(el("span", sheet.name), el("span", String(Math.max(0, sheet.rows.length - 1)), "sheet-tab-count"));
    tab.onclick = () => goSheet(i);
    tabs.append(tab);
    return tab;
  });

  let cells = [];
  let colHeads = [];
  let rowHeads = [];
  let cols = [];
  let table;

  const cellValue = (r, c) => {
    const value = sheets[state.sheet].rows[r]?.[c];
    return value == null ? "" : String(value);
  };

  function updateFormula() {
    const { r, c } = selection[state.sheet];
    nameBox.textContent = `${columnLetter(c)}${r + 1}`;
    formulaValue.textContent = cellValue(r, c) || " ";
  }

  function scrollToCell({ r, c }) {
    const cell = cells[r]?.[c];
    if (!cell) return;
    const top = COL_HEAD + (r > 0 ? cells[0][0].offsetHeight : 0);
    if (cell.offsetLeft - ROW_HEAD < grid.scrollLeft) grid.scrollLeft = cell.offsetLeft - ROW_HEAD;
    else if (cell.offsetLeft + cell.offsetWidth > grid.scrollLeft + grid.clientWidth)
      grid.scrollLeft = cell.offsetLeft + cell.offsetWidth - grid.clientWidth;
    if (r === 0) return;
    if (cell.offsetTop - top < grid.scrollTop) grid.scrollTop = cell.offsetTop - top;
    else if (cell.offsetTop + cell.offsetHeight > grid.scrollTop + grid.clientHeight)
      grid.scrollTop = cell.offsetTop + cell.offsetHeight - grid.clientHeight;
  }

  function mark(on) {
    const { r, c } = selection[state.sheet];
    cells[r]?.[c]?.classList.toggle("is-selected", on);
    cells[r]?.[c]?.setAttribute("aria-selected", String(on));
    colHeads[c]?.classList.toggle("is-active", on);
    rowHeads[r]?.classList.toggle("is-active", on);
  }

  function select(r, c, { scroll = true } = {}) {
    mark(false);
    if (state.expanded) {
      cells[state.expanded.r]?.[state.expanded.c]?.classList.remove("is-expanded");
      state.expanded = null;
    }
    selection[state.sheet] = { r, c };
    mark(true);
    statusMessage.textContent = "";
    updateFormula();
    if (scroll) scrollToCell({ r, c });
  }

  function paintMatches() {
    for (const row of cells) for (const cell of row) cell.classList.remove("is-match", "is-current-match");
    const query = state.query.trim().toLocaleLowerCase();
    state.matches = [];
    if (query) {
      for (const [r, row] of sheets[state.sheet].rows.entries())
        for (const [c, value] of row.entries())
          if (String(value ?? "").toLocaleLowerCase().includes(query)) {
            state.matches.push({ r, c });
            cells[r][c].classList.add("is-match");
          }
    }
    const current = state.matches[state.matchIndex];
    if (current) cells[current.r][current.c].classList.add("is-current-match");
    matchLabel.textContent = query
      ? state.matches.length
        ? `${state.matchIndex >= 0 ? state.matchIndex + 1 : 0}/${state.matches.length}`
        : "0건"
      : "";
  }

  function buildGrid() {
    const sheet = sheets[state.sheet];
    table = el("table");
    const colgroup = el("colgroup");
    colgroup.append(Object.assign(el("col"), { style: `width:${ROW_HEAD}px` }));
    cols = sheet.widths.map((width) => {
      const col = el("col");
      col.style.width = `${width}px`;
      colgroup.append(col);
      return col;
    });
    const head = el("thead");
    const headRow = el("tr");
    headRow.append(el("th", "", "sheet-corner"));
    colHeads = sheet.widths.map((_, c) => {
      const th = el("th", columnLetter(c), "sheet-col-head");
      th.scope = "col";
      const handle = el("span", undefined, "sheet-resize");
      handle.setAttribute("aria-hidden", "true");
      handle.onpointerdown = (event) => startResize(event, c);
      th.append(handle);
      headRow.append(th);
      return th;
    });
    head.append(headRow);
    const body = el("tbody");
    rowHeads = [];
    cells = sheet.rows.map((row, r) => {
      const tr = el("tr");
      const number = el("th", String(r + 1), "sheet-row-head");
      number.scope = "row";
      rowHeads.push(number);
      tr.append(number);
      const rowCells = row.map((value, c) => {
        const td = el("td");
        td.dataset.cell = `${r}-${c}`;
        td.setAttribute("role", "gridcell");
        if (typeof value === "number") td.classList.add("is-number");
        td.append(el("div", value == null ? "" : String(value)));
        tr.append(td);
        return td;
      });
      if (r === 0) tr.classList.add("sheet-header-row");
      body.append(tr);
      return rowCells;
    });
    table.append(colgroup, head, body);
    updateWidth();
    grid.replaceChildren(table);
    grid.scrollTop = 0;
    grid.scrollLeft = 0;
    mark(true);
    updateFormula();
    paintMatches();
    dims.textContent = `${Math.max(0, sheet.rows.length - 1)}행 × ${sheet.widths.length}열`;
    for (const [i, tab] of tabButtons.entries()) {
      tab.classList.toggle("is-active", i === state.sheet);
      tab.setAttribute("aria-selected", String(i === state.sheet));
    }
    tabButtons[state.sheet]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function updateWidth() {
    table.style.width = `${ROW_HEAD + sheets[state.sheet].widths.reduce((a, b) => a + b, 0)}px`;
  }

  function startResize(event, c) {
    event.preventDefault();
    event.stopPropagation();
    const widths = sheets[state.sheet].widths;
    const x0 = event.clientX;
    const w0 = widths[c];
    const move = (moveEvent) => {
      widths[c] = Math.max(40, Math.round(w0 + moveEvent.clientX - x0));
      cols[c].style.width = `${widths[c]}px`;
      updateWidth();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      viewer.classList.remove("is-resizing");
    };
    viewer.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function goSheet(index) {
    state.sheet = (index + sheets.length) % sheets.length;
    state.matchIndex = -1;
    state.expanded = null;
    statusMessage.textContent = "";
    buildGrid();
  }

  function setFull(full) {
    state.full = full;
    viewer.classList.toggle("is-full", full);
    document.body.classList.toggle("sheet-fullscreen", full);
    const label = full ? "좁히기" : "펼치기";
    fullButton.title = label;
    fullButton.setAttribute("aria-label", label);
    fullButton.querySelector("path").setAttribute("d", full
      ? "M14 4v6h6M14 10l7-7M10 20v-6H4M10 14l-7 7"
      : "M14 3h7v7M21 3l-7 7M10 21H3v-7M3 21l7-7");
    fullButton.setAttribute("aria-pressed", String(full));
  }

  grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest("td[data-cell]");
    if (!cell) return;
    const [r, c] = cell.dataset.cell.split("-").map(Number);
    select(r, c, { scroll: false });
    setTimeout(() => grid.focus({ preventScroll: true }));
  });
  grid.addEventListener("dblclick", (event) => {
    const cell = event.target.closest("td[data-cell]");
    if (!cell) return;
    const [r, c] = cell.dataset.cell.split("-").map(Number);
    const same = state.expanded?.r === r && state.expanded?.c === c;
    if (state.expanded) cells[state.expanded.r][state.expanded.c].classList.remove("is-expanded");
    state.expanded = same ? null : { r, c };
    cell.classList.toggle("is-expanded", !same);
  });
  grid.addEventListener("keydown", (event) => {
    const rows = sheets[state.sheet].rows;
    const { r, c } = selection[state.sheet];
    const lastRow = rows.length - 1;
    const lastCol = rows[0].length - 1;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && (event.key === "PageUp" || event.key === "PageDown")) {
      event.preventDefault();
      goSheet(state.sheet + (event.key === "PageUp" ? -1 : 1));
      return;
    }
    if (mod && event.key.toLowerCase() === "c" && !getSelection()?.toString()) {
      event.preventDefault();
      navigator.clipboard?.writeText(cellValue(r, c)).then(
        () => (statusMessage.textContent = `${columnLetter(c)}${r + 1} 복사됨`),
        () => (statusMessage.textContent = "복사하지 못했습니다"),
      );
      return;
    }
    if (event.key === "Escape" && state.full) {
      event.preventDefault();
      setFull(false);
      return;
    }
    const move = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Enter: [event.shiftKey ? -1 : 1, 0],
      Tab: [0, event.shiftKey ? -1 : 1],
    }[event.key];
    const clamp = (value, max) => Math.min(max, Math.max(0, value));
    if (move) {
      event.preventDefault();
      const nr = mod && move[0] ? (move[0] > 0 ? lastRow : 0) : clamp(r + move[0], lastRow);
      const nc = mod && move[1] ? (move[1] > 0 ? lastCol : 0) : clamp(c + move[1], lastCol);
      select(nr, nc);
    } else if (event.key === "Home") {
      event.preventDefault();
      select(mod ? 0 : r, 0);
    } else if (event.key === "End") {
      event.preventDefault();
      select(mod ? lastRow : r, lastCol);
    }
  });
  findInput.addEventListener("input", () => {
    state.query = findInput.value;
    state.matchIndex = -1;
    paintMatches();
  });
  findInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.full) return setFull(false);
    if (event.key !== "Enter" || !state.matches.length) return;
    event.preventDefault();
    const count = state.matches.length;
    state.matchIndex = (state.matchIndex + (event.shiftKey ? -1 : 1) + count) % count;
    paintMatches();
    const { r, c } = state.matches[state.matchIndex];
    select(r, c);
  });
  wrapButton.onclick = () => {
    state.wrap = !state.wrap;
    viewer.classList.toggle("is-wrapped", state.wrap);
    wrapButton.setAttribute("aria-pressed", String(state.wrap));
  };
  fullButton.onclick = () => setFull(!state.full);
  prev.onclick = () => goSheet(state.sheet - 1);
  next.onclick = () => goSheet(state.sheet + 1);

  buildGrid();
  return viewer;
}

function renderModified(doc) {
  if (!doc.modified?.date) return;
  const date = new Date(doc.modified.date);
  if (Number.isNaN(date.getTime())) return;
  const label = `최종 수정 ${date.toLocaleDateString("ko-KR")}${doc.modified.author ? ` · ${doc.modified.author}` : ""}`;
  $("#article h1").after(el("p", label, "document-modified"));
}

async function renderSpreadsheet(doc) {
  const article = $("#article");
  const content = el("p", "엑셀 파일을 불러오는 중입니다.", "sheet-message");
  article.replaceChildren(el("h1", doc.title), content);
  renderModified(doc);
  try {
    const response = await fetch(doc.spreadsheet.data);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sheets = await response.json();
    if (current !== doc) return;
    content.replaceWith(
      spreadsheetViewer(doc, sheets),
      el(
        "p",
        "방향키로 셀 이동 · 더블클릭 또는 줄바꿈으로 전체 내용 보기 · 열 경계 드래그로 너비 조절 · Ctrl+C 셀 복사",
        "sheet-hint",
      ),
    );
  } catch {
    if (current === doc) content.textContent = "엑셀 파일을 불러오지 못했습니다.";
  }
}

function render() {
  document.body.classList.remove('has-comments', 'comment-card-open');
  $('#article').commentLaneObserver?.disconnect();
  $('#article').commentDismissController?.abort();
  $('.compact-toc').hidden = true;
  $('#compact-toc-links').hidden = true;
  $('#compact-toc-toggle').setAttribute('aria-expanded', 'false');
  let id, anchor, commentId;
  try {
    [id, anchor, commentId] = location.hash.slice(2).split("/").map(decodeURIComponent);
    if (anchor !== 'comment') commentId = undefined;
    if (commentId) anchor = undefined;
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
  const folderPath = !current && id?.startsWith(`${activeTab}/`) && id.endsWith("/")
    ? id.slice(activeTab.length + 1)
    : null;
  const isFolder = folderPath && site.documents.some(
    (doc) => doc.tab === activeTab && doc.path.startsWith(folderPath),
  );
  $("#article").dataset.commentDocument = "";
  document.body.classList.toggle("is-spreadsheet", Boolean(current?.spreadsheet));
  document.body.classList.remove("sheet-fullscreen");
  renderNavigation(isFolder ? folderPath : null);
  $("#toc").replaceChildren();
  $("#pagination").replaceChildren();
  $(".toc").hidden = !current;
  $("#pagination").hidden = !current;
  if (isFolder) {
    renderFolder(folderPath);
    return;
  }
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
    renderBreadcrumb();
    return;
  }
  document.title = `${current.title} · ${site.title}`;
  renderBreadcrumb(current.path.split("/").slice(0, -1), {
    title: current.path.split("/").at(-1).replace(/\.md$/i, ""),
    id: current.id,
  });
  if (current.spreadsheet) {
    $(".toc").hidden = true;
    $("#pagination").hidden = true;
    renderSpreadsheet(current);
    window.scrollTo(0, 0);
    return;
  }
  $("#article").dataset.commentDocument = current.id;
  $("#article").innerHTML = current.html;
  if (!$("#article h1")) $("#article").prepend(el("h1", current.title));
  renderModified(current);
  for (const heading of $("#article").querySelectorAll("h2, h3, h4, h5, h6")) {
    if (/^version\s*:\s*\S+/i.test(heading.textContent.trim()))
      heading.classList.add("document-version");
  }
  // Existing containers with a leading heading also display the search below it.
  for (const section of document.querySelectorAll(".search-section")) {
    const heading =
      section.querySelector(".section-content")?.firstElementChild;
    if (heading && /^H[2-6]$/.test(heading.tagName)) section.before(heading);
  }
  for (const heading of current.toc.filter((item) => item.level > 1)) {
    const link = el("a", heading.title);
    link.href = route(current.id, heading.anchor);
    link.style.paddingLeft = `${Math.max(0, heading.level - 2) * 12}px`;
    $("#toc").append(link);
  }
  $('#compact-toc-links').replaceChildren(...[...$('#toc').children].map((link) => link.cloneNode(true)));
  requestAnimationFrame(updateTocFades);
  $('.compact-toc').hidden = !$('#toc').children.length;
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
  attachTableSearches();
  attachComments($("#article"), current.id, commentId);
  const diagrams = [...$("#article").querySelectorAll("pre > code")].filter(
    (code) => code.classList.contains("language-mermaid") ||
      (!code.className && /^\s*sequenceDiagram\b/.test(code.textContent)),
  );
  if (diagrams.length) {
    import("./diagrams.js").then(({ renderDiagrams }) => renderDiagrams(diagrams)).catch(() => {
      // Keep the original code readable if the renderer cannot be loaded.
    });
  }
  if (pendingQuery) {
    highlight($("#article"), pendingQuery);
    pendingQuery = "";
  }
  if (anchor) {
    const heading = [...$("#article").querySelectorAll("[id]")].find(
      (node) => node.id === anchor,
    );
    requestAnimationFrame(() => heading?.scrollIntoView({ block: "start" }));
  } else window.scrollTo(0, 0);
}

let searchTab = null;

function renderResults() {
  const query = $("#global-search").value;
  const results = searchDocuments(searchTab ? site.documents.filter((doc) => doc.tab === searchTab.slug) : site.documents, query);
  $("#clear-search").hidden = !query;
  const suggestions = $("#search-suggestions");
  suggestions.replaceChildren();
  suggestions.hidden = true;
  if (!searchTab && /^#[^ ]*$/.test(query)) {
    const tabs = site.tabs.filter((tab) => tab.title.toLocaleLowerCase().includes(query.slice(1).toLocaleLowerCase()));
    if (tabs.length) {
      suggestions.hidden = false;
      suggestions.append(el("p", "탭으로 범위 지정"));
      for (const tab of tabs) {
        const button = el("button", undefined, "search-suggestion");
        button.type = "button";
        button.append(el("span", `# ${tab.title}`), el("small", `문서 ${site.documents.filter((doc) => doc.tab === tab.slug).length}개`));
        button.onclick = () => selectSearchTab(tab);
        suggestions.append(button);
      }
    }
  }
  $("#search-count").hidden = !suggestions.hidden;
  $("#search-count").textContent = query.trim()
    ? results.length
      ? `${searchTab ? `${searchTab.title} 탭에서 ` : ""}${results.length}개 결과${results.length === 80 ? " (최대 80개 표시)" : ""}`
      : "일치하는 내용이 없습니다."
    : searchTab ? `${searchTab.title} 탭에서 검색합니다.` : "한국어와 영문으로 모든 탭의 내용을 검색합니다.";
  $("#results").replaceChildren();
  if (query.trim() && !results.length && suggestions.hidden) {
    const empty = el("div", undefined, "search-empty");
    empty.append(el("strong", searchTab ? `‘${searchTab.title}’에 ‘${query}’ 결과가 없어요` : `‘${query}’ 검색 결과가 없어요`));
    if (searchTab) {
      const otherCount = searchDocuments(site.documents, query).length;
      empty.append(el("p", `전체 탭에서 ${otherCount}개를 찾았습니다.`));
      const button = el("button", "모든 탭에서 검색");
      button.type = "button";
      button.onclick = clearSearchTab;
      empty.append(button);
    }
    $("#results").append(empty);
  }
  for (const { doc, section } of suggestions.hidden ? results : []) {
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

function selectSearchTab(tab) {
  searchTab = tab;
  $("#global-search").value = "";
  $("#search-tag-label").textContent = `# ${tab.title}`;
  $("#search-tag").hidden = false;
  renderResults();
  $("#global-search").focus();
}
function clearSearchTab() {
  searchTab = null;
  $("#search-tag").hidden = true;
  renderResults();
  $("#global-search").focus();
}
function positionSearch() {
  const rect = $("#content").getBoundingClientRect();
  dialog.style.left = `${rect.left}px`;
  dialog.style.width = `${rect.width}px`;
}
const openSearch = () => {
  if (!site) return;
  positionSearch();
  dialog.showModal();
  $("#global-search").focus();
  renderResults();
};
const closeCompactToc = () => {
  $('#compact-toc-links').hidden = true;
  $('#compact-toc-toggle').setAttribute('aria-expanded', 'false');
};
$('#compact-toc-toggle').onclick = () => {
  const links = $('#compact-toc-links');
  links.hidden = !links.hidden;
  $('#compact-toc-toggle').setAttribute('aria-expanded', String(!links.hidden));
};
$('#compact-toc-links').onclick = (event) => {
  if (event.target.closest('a')) closeCompactToc();
};
document.addEventListener('click', (event) => {
  if (!event.target.closest('.compact-toc')) closeCompactToc();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#compact-toc-links').hidden) {
    closeCompactToc();
    $('#compact-toc-toggle').focus();
  }
});
$("#open-search").onclick = openSearch;
$("#close-search").onclick = () => dialog.close();
$("#clear-search-tag").onclick = clearSearchTab;
$("#clear-search").onclick = () => { $("#global-search").value = ""; renderResults(); $("#global-search").focus(); };
window.addEventListener("resize", () => { if (dialog.open) positionSearch(); });
$("#global-search").oninput = (event) => {
  const input = event.target;
  if (!searchTab && !event.isComposing) {
    const tab = site.tabs.find((item) => input.value.startsWith(`#${item.title} `));
    if (tab) {
      searchTab = tab;
      input.value = input.value.slice(tab.title.length + 2);
      $("#search-tag-label").textContent = `# ${tab.title}`;
      $("#search-tag").hidden = false;
    }
  }
  renderResults();
};
$("#global-search").onkeydown = (event) => {
  if (event.key === "Backspace" && !event.isComposing && searchTab && !event.target.value && event.target.selectionStart === 0) {
    clearSearchTab();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    $("#search-suggestions:not([hidden]) button, #results a")?.focus();
  } else if (event.key === "Enter") $("#search-suggestions:not([hidden]) button, #results a")?.click();
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
const updateTocFades = () => {
  const toc = $('#toc');
  const frame = $('.toc-frame');
  frame.classList.toggle('has-above', toc.scrollTop > 1);
  frame.classList.toggle('has-below', toc.scrollTop + toc.clientHeight < toc.scrollHeight - 1);
};
$('#toc').addEventListener('scroll', updateTocFades);
new ResizeObserver(updateTocFades).observe($('.toc-frame'));
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
