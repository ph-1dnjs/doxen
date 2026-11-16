import { mountApiReference } from "./viewer.js";

export function renderApiReference(doc, anchor) {
  if (!doc.apiReference) return false;
  const host = document.createElement("div");
  host.className = "api-reference-view";
  const root = host.attachShadow({ mode: "open" });
  document.querySelector("#article").replaceChildren(host);
  mountApiReference(root, anchor, doc.id);
  window.scrollTo(0, 0);
  return true;
}
