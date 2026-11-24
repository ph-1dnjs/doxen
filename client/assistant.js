export function initAssistant(site) {
  if (site.assistant?.provider === "workers-ai-free")
    document.querySelector("#assistant-privacy").textContent = "검색한 문서 일부와 질문을 Cloudflare Workers AI로 전송합니다. 검색 모델과 문서 임베딩은 이 브라우저에 저장됩니다.";
  const panel = document.querySelector("#assistant-panel");
  const toggle = document.querySelector("#assistant-toggle");
  const messages = document.querySelector("#assistant-messages");
  const status = document.querySelector("#assistant-status");
  const form = document.querySelector("#assistant-form");
  const input = document.querySelector("#assistant-input");
  const submit = form.querySelector("button");
  const historyKey = `doxen-assistant:${location.pathname}`;
  let history = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(historyKey) || "[]");
    if (Array.isArray(saved)) history = saved.filter((item) => item && ["user", "bot"].includes(item.kind) && typeof item.text === "string").slice(-40);
  } catch { /* Storage may be disabled or contain invalid data. */ }
  const saveHistory = () => {
    try { sessionStorage.setItem(historyKey, JSON.stringify(history.slice(-40))); }
    catch { status.textContent = "브라우저 저장 공간을 사용할 수 없어 새로고침 후 대화가 사라질 수 있습니다."; }
  };
  let worker;
  const prepareWorker = () => {
    if (worker) return;
    worker = new Worker(new URL("./rag-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => { worker?.terminate(); worker = undefined; input.disabled = false; submit.disabled = false; status.textContent = ""; addMessage("모델을 실행하지 못했습니다. 브라우저를 확인해 주세요.", "bot"); };
    worker.postMessage({ type: "init", site });
  };
  const open = (value) => {
    panel.hidden = !value;
    toggle.setAttribute("aria-expanded", String(value));
    toggle.setAttribute("aria-label", value ? "문서 도우미 닫기" : "문서 도우미 열기");
    if (value) { prepareWorker(); input.focus(); } else toggle.focus();
  };
  toggle.onclick = () => open(panel.hidden);
  document.querySelector("#assistant-close").onclick = () => open(false);
  document.querySelector("#assistant-reset").onclick = () => {
    worker?.terminate(); worker = undefined;
    history = []; try { sessionStorage.removeItem(historyKey); } catch { /* Storage may be disabled. */ }
    messages.replaceChildren(); status.textContent = ""; input.disabled = false; submit.disabled = false; input.focus();
  };
  const message = (text, kind, sources = []) => {
    const element = document.createElement("div");
    element.className = `assistant-message ${kind}`;
    element.textContent = text;
    if (Array.isArray(sources) && sources.length) {
      const list = document.createElement("div"); list.className = "assistant-sources";
      sources.forEach((source, index) => {
        if (!source || typeof source.href !== "string" || !source.href.startsWith("#/") || typeof source.text !== "string") return;
        const a = document.createElement("a"); a.href = source.href;
        a.textContent = `[${source.number || index + 1}] ${String(source.title || "")} > ${String(source.heading || "")}${source.documentType ? ` · ${source.documentType}` : ""}${source.modified ? ` · 수정 ${source.modified.slice(0, 10)}` : ""}`;
        const excerpt = document.createElement("small"); excerpt.textContent = Array.isArray(source.evidence) ? source.evidence.join(" … ") : source.text.slice(0, 180);
        list.append(a, excerpt);
      });
      element.append(list);
    }
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  };
  for (const item of history) message(item.text, item.kind, item.sources);
  const addMessage = (text, kind, sources = []) => {
    message(text, kind, sources);
    history.push({ text, kind, ...(sources.length ? { sources: sources.map((source) => ({
      title: source.title, heading: source.heading, href: source.href, number: source.number, evidence: source.evidence, documentType: source.documentType, modified: source.modified, text: source.text.slice(0, 180),
    })) } : {}) });
    history = history.slice(-40);
    saveHistory();
  };
  function handleWorkerMessage({ data }) {
      if (data.type === "status") { status.textContent = data.message; return; }
      status.textContent = [data.semanticError ? "의미 검색 모델을 사용할 수 없어 키워드 검색을 사용했습니다." : "", data.timings ? Object.entries({ "질문 임베딩": data.timings.embeddingMs, "벡터 검색": data.timings.vectorMs, "키워드 검색": data.timings.keywordMs, "재정렬": data.timings.rerankMs, "문맥 확장": data.timings.contextMs, "답변 생성": data.timings.generationMs, "근거 검증": data.timings.verificationMs, "전체": data.timings.totalMs }).filter(([, ms]) => Number.isFinite(ms)).map(([label, ms]) => `${label} ${(ms / 1000).toFixed(1)}초`).join(" · ") : ""].filter(Boolean).join(" ");
      input.disabled = false; submit.disabled = false;
      if (data.type === "error") addMessage(data.message, "bot");
      if (data.type === "result") {
        addMessage(data.answer, "bot", data.sources);
      }
  }
  form.onsubmit = (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || input.disabled) return;
    addMessage(question, "user"); input.value = ""; input.disabled = true; submit.disabled = true;
    status.textContent = "인덱스가 준비 중이면 완료 후 질문을 처리합니다.";
    prepareWorker();
    worker.postMessage({ type: "ask", question });
  };
}
