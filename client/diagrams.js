import mermaid from "mermaid";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  theme: "default",
  fontFamily: '"Noto Sans KR Variable", sans-serif',
});

let diagramId = 0;

export async function renderDiagrams(blocks) {
  await document.fonts.ready;
  for (const code of blocks) {
    if (!code.isConnected) continue;
    const source = code.textContent;
    const pre = code.parentElement;
    const figure = document.createElement("figure");
    figure.className = "diagram";
    figure.setAttribute("aria-label", "문서 다이어그램");
    try {
      const { svg } = await mermaid.render(`diagram-${++diagramId}`, source);
      if (!pre.isConnected) continue;
      figure.innerHTML = svg;
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
