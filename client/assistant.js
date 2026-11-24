export function initAssistant(site) {
  if (site.assistant?.provider === "workers-ai-free")
    document.querySelector("#assistant-privacy").textContent = "검색한 문서 일부와 질문을 Cloudflare Workers AI로 전송합니다. 검색 모델은 이 기기에 다운로드됩니다.";
  const panel = document.querySelector("#assistant-panel");
  const toggle = document.querySelector("#assistant-toggle");
  const messages = document.querySelector("#assistant-messages");
  const status = document.querySelector("#assistant-status");
  const form = document.querySelector("#assistant-form");
  const input = document.querySelector("#assistant-input");
  const submit = form.querySelector("button");
  let worker;
  const open = (value) => {
    panel.hidden = !value;
    toggle.setAttribute("aria-expanded", String(value));
    toggle.setAttribute("aria-label", value ? "문서 도우미 닫기" : "문서 도우미 열기");
    if (value) input.focus(); else toggle.focus();
  };
  toggle.onclick = () => open(panel.hidden);
  document.querySelector("#assistant-close").onclick = () => open(false);
  document.querySelector("#assistant-reset").onclick = () => {
    worker?.terminate(); worker = undefined;
    messages.replaceChildren(); status.textContent = ""; input.disabled = false; submit.disabled = false; input.focus();
  };
  const message = (text, kind) => {
    const element = document.createElement("div");
    element.className = `assistant-message ${kind}`;
    element.textContent = text;
    messages.append(element);
    messages.scrollTop = messages.scrollHeight;
    return element;
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question || input.disabled) return;
    message(question, "user"); input.value = ""; input.disabled = true; submit.disabled = true;
    status.textContent = "문서를 검색하고 있습니다.";
    if (!worker) worker = new Worker(new URL("./rag-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "status") { status.textContent = data.message; return; }
      status.textContent = data.semanticError ? "의미 검색 모델을 사용할 수 없어 키워드 검색을 사용했습니다." : "";
      input.disabled = false; submit.disabled = false;
      if (data.type === "error") message(data.message, "bot");
      if (data.type === "result") {
        const result = message(data.answer, "bot");
        if (data.sources.length) {
          const list = document.createElement("div"); list.className = "assistant-sources";
          data.sources.forEach((source, index) => {
            const a = document.createElement("a"); a.href = source.href;
            a.textContent = `[${index + 1}] ${source.title} · ${source.heading}`;
            const excerpt = document.createElement("small"); excerpt.textContent = source.text.slice(0, 180);
            list.append(a, excerpt);
          });
          result.append(list); messages.scrollTop = messages.scrollHeight;
        }
      }
    };
    worker.onerror = () => { worker?.terminate(); worker = undefined; input.disabled = false; submit.disabled = false; status.textContent = ""; message("모델을 실행하지 못했습니다. 브라우저를 확인해 주세요.", "bot"); };
    worker.postMessage({ type: "ask", question, site });
  };
}
