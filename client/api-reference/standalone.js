import { mountApiReference } from "./viewer.js";

mountApiReference(document.body, new URLSearchParams(location.search).get("operation") || "");
