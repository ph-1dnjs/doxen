import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("examples/.docs-dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (!url.pathname.startsWith("/manuals/")) {
      res.writeHead(404);
      return res.end();
    }
    const file = path.resolve(
      root,
      url.pathname.slice("/manuals/".length) || "index.html",
    );
    if (!file.startsWith(`${root}${path.sep}`)) {
      res.writeHead(404);
      return res.end();
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(4187, "127.0.0.1");
