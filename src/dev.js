import http from "node:http";
import path from "node:path";
import { watch } from "chokidar";
import { loadConfig } from "./config.js";
import { siteFiles } from "./build.js";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

export async function dev(cwd, configPath, port = 4173) {
  let config = await loadConfig(cwd, configPath);
  let files = await siteFiles(config, true);
  let currentError = "";
  const clients = new Set();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/__events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (currentError && (pathname === "/" || pathname === "/index.html")) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(
        `문서 빌드 오류. 파일을 수정한 뒤 새로고침하세요.\n\n${currentError}`,
      );
    }
    const key = pathname === "/" ? "/index.html" : pathname;
    const body = files.get(key);
    res.writeHead(body ? 200 : 404, {
      "Content-Type": types[path.extname(key)] || "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body || "Not found");
  });
  const watcher = watch(config.root, {
    ignoreInitial: true,
    ignored: (file) =>
      path
        .relative(config.root, file)
        .split(path.sep)
        .some((part) => part === "node_modules" || part.startsWith(".")),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
  });
  let timer;
  let queue = Promise.resolve();
  watcher.on("all", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      queue = queue.then(async () => {
        try {
          config = await loadConfig(cwd, configPath);
          files = await siteFiles(config, true);
          currentError = "";
          console.log("문서를 갱신했습니다.");
        } catch (error) {
          currentError = error.message;
          console.error(currentError);
        }
        for (const client of clients)
          client.write("event: reload\ndata: changed\n\n");
      });
    }, 100);
  });
  watcher.on("error", (error) =>
    console.error(`파일 감시 오류: ${error.message}`),
  );
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch (error) {
    await watcher.close();
    throw error;
  }
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": heartbeat\n\n");
  }, 20000);
  console.log(`Safibook → http://127.0.0.1:${server.address().port}`);
  return {
    server,
    async close() {
      clearTimeout(timer);
      clearInterval(heartbeat);
      await watcher.close();
      await queue;
      for (const client of clients) client.end();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
