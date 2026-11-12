// Copy src/templates/comment-report.yml into the consuming repository to run this report.
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { loadConfig, inside } from './config.js';
import { collectSite } from './content.js';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_D1_DATABASE_ID: database,
  CLOUDFLARE_API_TOKEN: cloudflareToken, GITHUB_TOKEN: githubToken,
  GITHUB_REPOSITORY: repository, GITHUB_SHA: commit, DOXEN_SITE_URL: siteUrl, REPORT_DATE } = process.env;
if (!account || !database || !cloudflareToken || !githubToken || !repository || !commit || !siteUrl)
  throw new Error('댓글 보고서에 필요한 Cloudflare 및 GitHub 환경 변수가 없습니다.');
if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('GITHUB_SHA가 올바르지 않습니다.');
let site;
try { site = new URL(siteUrl); } catch { throw new Error('DOXEN_SITE_URL은 사이트의 HTTP(S) 주소여야 합니다.'); }
if (!['http:', 'https:'].includes(site.protocol) || site.username || site.password || site.search || site.hash)
  throw new Error('DOXEN_SITE_URL은 쿼리나 인증 정보가 없는 사이트 주소여야 합니다.');
const date = REPORT_DATE || new Date(Date.now() + 9 * 3600000 - 86400000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)
  throw new Error('REPORT_DATE는 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.');
const start = new Date(`${date}T00:00:00+09:00`);
const end = new Date(start.getTime() + 86400000);
const cloudflare = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database)}/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${cloudflareToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ sql: 'SELECT id, document, quote, body, author, created_at FROM comments WHERE created_at >= ? AND created_at < ? ORDER BY created_at, id', params: [start.toISOString(), end.toISOString()] }),
});
if (!cloudflare.ok) throw new Error(`D1 조회 실패: HTTP ${cloudflare.status}`);
const result = await cloudflare.json();
if (!result.success || !result.result?.[0]?.success) throw new Error('D1 조회에 실패했습니다.');
const comments = result.result[0].results;
if (!comments.length) { console.log(`${date}: 등록할 댓글이 없습니다.`); process.exit(0); }
const github = `https://api.github.com/repos/${repository}/issues`;
const headers = { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const marker = `<!-- doxen-comment-report:${date} -->`;
for (let page = 1; ; page++) {
  const response = await fetch(`${github}?state=all&per_page=100&page=${page}`, { headers });
  if (!response.ok) throw new Error(`GitHub 이슈 조회 실패: HTTP ${response.status}`);
  const issues = await response.json();
  if (issues.some((issue) => !issue.pull_request && issue.body?.includes(marker))) {
    console.log(`${date}: 이미 보고서 이슈가 있습니다.`); process.exit(0);
  }
  if (issues.length < 100) break;
}
const workspace = await realpath(process.env.GITHUB_WORKSPACE || process.cwd());
const config = await loadConfig(workspace, process.env.DOXEN_CONFIG || undefined);
const { data } = await collectSite(config);
const paths = new Map(data.documents.filter((doc) => !doc.spreadsheet).map((doc) => {
  const tab = config.tabs.find((item) => item.slug === doc.tab);
  const file = path.resolve(tab.dir, doc.path);
  return [doc.id, inside(workspace, file) ? path.relative(workspace, file).split(path.sep).join('/') : null];
}));
const encodedPath = (value) => value.split('/').map(encodeURIComponent).join('/');
const safeLink = (value) => value.replace(/[()<>\s]/g, (char) => encodeURIComponent(char));
const fileLink = (document) => {
  const file = paths.get(document);
  if (!file) return ['- 문서 링크: 현재 문서 경로를 찾을 수 없습니다.'];
  return [
    `- 원본 파일: [${safe(file).replace(/[\\\[\]]/g, '\\$&')}](<https://github.com/${repository}/blob/${commit}/${encodedPath(file)}>)`,
  ];
};
const commentLink = (item) => {
  if (!paths.get(item.document)) return [];
  const documentUrl = new URL(site);
  documentUrl.hash = `/${encodeURIComponent(item.document)}/comment/${encodeURIComponent(item.id)}`;
  return [`- 배포 사이트: [댓글 위치 보기](<${safeLink(documentUrl.href)}>)`];
};
const safe = (value) => String(value).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]).replace(/@/g, '&#64;');
const grouped = new Map();
for (const item of comments) {
  if (!grouped.has(item.document)) grouped.set(item.document, []);
  grouped.get(item.document).push(item);
}
const body = [marker, `## ${date} 문서 댓글`, '', `총 ${comments.length}개 · 한국 시간 기준`, '', ...[...grouped].flatMap(([document, items]) => [
  `### ${safe(document)} · 댓글 ${items.length}개`, ...fileLink(document), '',
  ...items.flatMap((item, index) => [
    `#### 댓글 ${index + 1}`, ...commentLink(item), `- 작성자: ${safe(item.author)}`, `- 작성 시각: ${safe(item.created_at)}`,
    ...(item.quote ? ['', '**선택한 문구**', `<pre>${safe(item.quote)}</pre>`] : []),
    '', '**댓글**', `<pre>${safe(item.body)}</pre>`, '',
  ]), '---', '',
]), '## 후속 작업', '- [ ] 댓글 검토 및 처리'].join('\n');
const created = await fetch(github, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `[문서 댓글] ${date} 일일 보고`, body }) });
if (!created.ok) throw new Error(`GitHub 이슈 생성 실패: HTTP ${created.status}`);
console.log(`${date}: 댓글 ${comments.length}개를 이슈로 등록했습니다.`);
