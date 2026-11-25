export function clampZoom(value) {
  return Math.min(8, Math.max(0.05, value));
}

export function fitZoom(width, height, viewportWidth, viewportHeight) {
  return clampZoom(Math.min((viewportWidth - 32) / width, (viewportHeight - 32) / height, 1));
}

export function openDiagram(source, trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "diagram-dialog";
  dialog.setAttribute("aria-label", "다이어그램 크게 보기");
  dialog.innerHTML = `<div class="diagram-toolbar"><strong>다이어그램</strong><button type="button" data-action="out" aria-label="축소">−</button><output aria-live="polite"></output><button type="button" data-action="in" aria-label="확대">+</button><button type="button" data-action="reset">100%</button><button type="button" data-action="fit" aria-pressed="false">화면 맞춤</button><button type="button" data-action="fit-width" aria-pressed="false">너비 맞춤</button><button type="button" data-action="fullscreen">전체화면</button><button type="button" data-action="close" aria-label="다이어그램 닫기">닫기</button></div><div class="diagram-viewport" tabindex="0" aria-label="다이어그램 이동 영역"><div class="diagram-canvas"></div></div><p class="diagram-viewer-status" role="status"></p>`;
  const svg = source.cloneNode(true);
  // Avoid duplicate SVG IDs while retaining markers, CSS selectors and accessibility refs.
  const suffix = `-viewer-${Date.now()}`;
  const elementsWithIds = [...svg.querySelectorAll("[id]")];
  if (svg.id) elementsWithIds.push(svg);
  const ids = new Set(elementsWithIds.map((node) => node.id));
  for (const node of elementsWithIds) node.id += suffix;
  for (const node of svg.querySelectorAll("[aria-labelledby], [aria-describedby]")) {
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, value.replace(/\S+/g, (id) => ids.has(id) ? id + suffix : id));
    }
  }
  const canvas = dialog.querySelector(".diagram-canvas");
  canvas.innerHTML = svg.outerHTML.replace(/#([\w-]+)/g, (reference, id) => ids.has(id) ? reference + suffix : reference);
  const image = canvas.querySelector("svg");
  const box = source.viewBox.baseVal;
  const width = box.width || source.getBoundingClientRect().width || 1200;
  const height = box.height || source.getBoundingClientRect().height || 800;
  const viewport = dialog.querySelector(".diagram-viewport");
  let ownsFullscreen = false;
  let zoom = 1;
  let mode;
  const fitButton = dialog.querySelector('[data-action="fit"]');
  const fitWidthButton = dialog.querySelector('[data-action="fit-width"]');
  function setMode(next) {
    mode = next;
    viewport.classList.toggle("is-fit-width", mode === "width");
    fitButton.setAttribute("aria-pressed", String(mode === "fit"));
    fitWidthButton.setAttribute("aria-pressed", String(mode === "width"));
  }
  let x = 0, y = 0;
  function paint() {
    image.style.width = `${width * zoom}px`;
    image.style.height = `${height * zoom}px`;
    image.style.maxWidth = "none";
    image.style.display = "block";
    canvas.style.transform = `translate(${x}px, ${y}px)`;
    dialog.querySelector("output").textContent = `${Math.round(zoom * 100)}%`;
  }
  function apply(value, px = viewport.clientWidth / 2, py = viewport.clientHeight / 2) {
    const next = clampZoom(value);
    const ratio = next / zoom;
    x = px - (px - x) * ratio;
    y = py - (py - y) * ratio;
    zoom = next;
    paint();
  }
  const fit = () => {
    zoom = fitZoom(width, height, viewport.clientWidth, viewport.clientHeight);
    x = (viewport.clientWidth - width * zoom) / 2;
    y = (viewport.clientHeight - height * zoom) / 2;
    paint();
  };
  const fitWidth = () => {
    zoom = Math.max(1, viewport.clientWidth - 32) / width;
    x = 0;
    y = 0;
    paint();
  };
  const observer = new ResizeObserver(() => {
    if (mode === "fit") fit();
    if (mode === "width") fitWidth();
  });
  viewport.addEventListener("wheel", (event) => {
    if (mode === "width") return;
    event.preventDefault();
    setMode("manual");
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
    apply(zoom * Math.exp(-delta * 0.002), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  let drag;
  viewport.addEventListener("pointerdown", (event) => {
    if (mode === "width" || event.button !== 0 || drag) return;
    event.preventDefault();
    setMode("manual");
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add("is-dragging");
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    x += event.clientX - drag.x;
    y += event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    paint();
  });
  const release = (event) => {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    viewport.classList.remove("is-dragging");
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) viewport.addEventListener(name, release);
  viewport.addEventListener("keydown", (event) => {
    const offset = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
    if (mode === "width" || !offset) return;
    event.preventDefault();
    setMode("manual");
    x += offset[0]; y += offset[1]; paint();
  });
  document.body.append(dialog);
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  dialog.showModal();
  setMode("width");
  fitWidth();
  observer.observe(viewport);
  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "close" || event.target === dialog) dialog.close();
    if (["in", "out", "reset"].includes(action)) {
      if (mode === "width") {
        x = 16;
        y = 16 - viewport.scrollTop;
        viewport.scrollTop = 0;
      }
      setMode("manual");
      apply(action === "reset" ? 1 : zoom * (action === "in" ? 1.25 : 0.8));
    }
    if (action === "fit") {
      viewport.scrollTop = 0;
      setMode("fit");
      fit();
    }
    if (action === "fit-width") {
      setMode("width");
      fitWidth();
      viewport.focus({ preventScroll: true });
    }
    if (action === "fullscreen") {
      try {
        if (ownsFullscreen && document.fullscreenElement) await document.exitFullscreen();
        else {
          await document.documentElement.requestFullscreen();
          ownsFullscreen = true;
          fullscreenChanged();
        }
      } catch { dialog.querySelector(".diagram-viewer-status").textContent = "이 브라우저에서는 전체화면 전환을 사용할 수 없습니다."; }
    }
  });
  const fullscreenChanged = () => {
    if (!document.fullscreenElement) ownsFullscreen = false;
    dialog.classList.toggle("is-fullscreen", ownsFullscreen);
    dialog.querySelector('[data-action="fullscreen"]').textContent = ownsFullscreen ? "전체화면 종료" : "전체화면";
  };
  document.addEventListener("fullscreenchange", fullscreenChanged);
  const navigate = () => dialog.close();
  window.addEventListener("hashchange", navigate);
  dialog.addEventListener("close", () => {
    if (ownsFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    observer.disconnect();
    window.removeEventListener("hashchange", navigate);
    document.removeEventListener("fullscreenchange", fullscreenChanged);
    document.body.style.overflow = previousOverflow;
    dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  }, { once: true });
}
