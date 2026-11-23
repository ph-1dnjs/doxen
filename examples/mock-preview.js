import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { dev } from '../src/dev.js';

// 이 서버는 예제 미리보기에서만 사용하며 댓글을 메모리에 보관합니다.
const running = await dev(process.cwd(), 'examples/docs.config.ts', 0);
const document = 'guide/01-introduction';
const intro = JSON.stringify(['Doxen은 저장소에 있는 Markdown을 팀의 문서 사이트로 연결합니다. 익숙한 Git 흐름은 그대로, 필요한 지식은 더 빠르게 찾으세요.', 0]);
const install = JSON.stringify(['기존 프로젝트에 개발 의존성으로 설치하고 문서 폴더를 연결합니다.', 0]);
const table = JSON.stringify(['검색 버튼 또는 ⌘ / Ctrl K', 0]);
const missing = JSON.stringify(['수정되어 위치를 찾을 수 없는 예전 문단', 0]);
const now = Date.now();
let comments = [
  { id: 'mock-1', document, block: intro, quote: '익숙한 Git 흐름은 그대로', body: '이 문구가 서비스의 장점을 잘 보여주네요.', author: 'jiwoo@example.com', created_at: new Date(now - 86400000).toISOString(), mine: false, resolved: false },
  { id: 'mock-2', document, block: intro, quote: '', body: '검색 안내 문서 링크도 함께 확인해 주세요.', author: 'me@example.com', created_at: new Date(now - 7200000).toISOString(), mine: true, resolved: false },
  { id: 'mock-3', document, block: install, quote: '', body: '설치 명령을 확인했습니다. 해결로 표시해 둘게요.', author: 'me@example.com', created_at: new Date(now - 3600000).toISOString(), mine: true, resolved: true },
  { id: 'mock-4', document, block: table, quote: '⌘ / Ctrl K', body: 'Windows 단축키도 함께 표시하면 좋겠어요.', author: 'taeho@example.com', created_at: new Date(now - 1800000).toISOString(), mine: false, resolved: false },
  { id: 'mock-5', document, block: missing, quote: '', body: '본문이 변경되어 위치를 찾지 못한 댓글입니다.', author: 'me@example.com', created_at: new Date(now - 600000).toISOString(), mine: true, resolved: false },
];
const avatarIndexes = new Map([['jiwoo@example.com', 0], ['me@example.com', 1], ['taeho@example.com', 2]]);
for (const item of comments) item.avatar_index = avatarIndexes.get(item.author);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4173');
  if (url.pathname !== '/__doxen/comments') {
    const proxy = http.request({ hostname: '127.0.0.1', port: running.server.address().port, path: req.url, method: req.method, headers: req.headers }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    proxy.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(proxy);
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET') { res.setHeader('X-Doxen-Viewer', 'me%40example.com'); res.setHeader('X-Doxen-Avatar-Index', '1'); return res.end(JSON.stringify(comments.filter((item) => item.document === url.searchParams.get('document')))); }
  if (req.headers.origin !== 'http://127.0.0.1:4173' || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403); return res.end('{}'); }
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 30000) { res.writeHead(413); return res.end('{}'); } }
  let data;
  try { data = JSON.parse(raw); } catch { res.writeHead(400); return res.end('{}'); }
  const item = comments.find((entry) => entry.id === data.id);
  if (req.method === 'POST' && typeof data.document === 'string' && typeof data.block === 'string' && typeof data.quote === 'string' && typeof data.body === 'string' && data.body.trim() && data.body.length <= 5000) {
    const created = { id: randomUUID(), document: data.document, block: data.block, quote: data.quote, body: data.body.trim(), author: 'me@example.com', avatar_index: 1, created_at: new Date().toISOString(), mine: true, resolved: comments.some((entry) => entry.document === data.document && entry.block === data.block && entry.resolved) };
    comments.push(created); res.writeHead(201); return res.end(JSON.stringify(created));
  }
  if (req.method === 'PUT' && item?.mine && typeof data.body === 'string' && data.body.trim() && data.body.length <= 5000) { item.body = data.body.trim(); res.writeHead(204); return res.end(); }
  if (req.method === 'DELETE' && item?.mine) { comments = comments.filter((entry) => entry !== item); res.writeHead(204); return res.end(); }
  if (req.method === 'PATCH' && typeof data.document === 'string' && typeof data.block === 'string' && typeof data.resolved === 'boolean') {
    for (const entry of comments) if (entry.document === data.document && entry.block === data.block) entry.resolved = data.resolved;
    res.writeHead(204); return res.end();
  }
  res.writeHead(400); res.end('{}');
});
server.listen(4173, '127.0.0.1', () => console.log('댓글 Mock 미리보기 → http://127.0.0.1:4173 (서버 종료 시 초기화)'));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await running.close(); process.exit(0); });
