import { openDiagram } from "./diagram-viewer.js";
import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "default",
  fontFamily: '"Noto Sans KR Variable", sans-serif',
  themeCSS: "foreignObject .nodeLabel { word-break: keep-all; overflow-wrap: normal; }",
});

let diagramId = 0;

export async function renderDiagrams(blocks, { buttonOnly = false } = {}) {
  await document.fonts.ready;
  for (const code of blocks) {
    if (!code.isConnected) continue;
    const source = code.textContent;
    if (buttonOnly) {
      const details = code.closest("details");
      const title = details?.querySelector("summary")?.textContent.trim() || "다이어그램 보기";
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `⛶ ${title}`;
      button.style.cssText = "padding:10px 14px;margin:12px 0;cursor:pointer;border:1px solid #cbd5e1;border-radius:8px;background:white;color:#172033";
      let cached;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          if (!cached) {
            const { svg } = await mermaid.render(`diagram-${++diagramId}`, source);
            const template = document.createElement("template");
            template.innerHTML = svg;
            cached = template.content.querySelector("svg");
          }
          openDiagram(cached, button);
        } catch { button.textContent = "다이어그램 문법을 확인해주세요."; }
        finally { button.disabled = false; }
      });
      if (details) details.replaceWith(button);
      else code.parentElement.replaceWith(button);
      continue;
    }
    const pre = code.parentElement;
    const figure = document.createElement("figure");
    figure.className = "diagram";
    figure.setAttribute("aria-label", "문서 다이어그램");
    try {
      const { svg } = await mermaid.render(`diagram-${++diagramId}`, source);
      if (!pre.isConnected) continue;
      figure.innerHTML = svg;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "diagram-expand";
      button.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg>';
      button.setAttribute("aria-label", "다이어그램 크게 보기");
      button.title = "다이어그램 크게 보기";
      button.addEventListener("click", () => openDiagram(figure.querySelector(":scope > svg"), button));
      figure.prepend(button);
      pre.replaceWith(figure);
    } catch {
      if (!pre.isConnected) continue;
      const message = document.createElement("p");
      message.className = "diagram-error";
      message.textContent = "다이어그램 문법을 확인해주세요. 원본 코드를 표시합니다.";
      pre.before(message);
    }
  }
}
