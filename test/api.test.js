import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { siteFiles } from "../src/build.js";
import { syncOpenApi } from "../src/openapi.js";
import { clampZoom, fitZoom } from "../client/diagram-viewer.js";

const spec = { openapi: "3.0.3", info: { title: "테스트", version: "1" }, paths: { "/members": { get: { summary: "회원 조회", description: "```mermaid\nflowchart LR\n A-->B\n```\n<script>alert(1)</script>", responses: { 200: { description: "성공" } } } } } };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "reference"));
  await writeFile(path.join(root, "reference/index.md"), "# API");
  await writeFile(path.join(root, "docs.config.ts"), `export default {title:'API',tabs:[{title:'참조',slug:'reference',dir:'./reference'}],api:{document:'reference/index',spec:'reference/spec.json',metadata:'reference/meta.json'}}`);
  return { root, config: await loadConfig(root) };
}

test("API config supports custom document and paths, sync imports a file and indexes API operations", async (t) => {
  const { root, config } = await fixture(t);
  const input = path.join(root, "input.json");
  await writeFile(input, JSON.stringify(spec));
  await syncOpenApi(config, { file: input });
  const files = await siteFiles(config);
  const doc = JSON.parse(files.get("/site.json")).documents[0];
  assert.equal(doc.apiReference, true);
  assert.ok(doc.sections.some((section) => section.anchor === "GET /members" && section.title.includes("회원 조회")));
  assert.deepEqual(JSON.parse(files.get("/api-reference/openapi.json")), spec);
  const description = JSON.parse(files.get("/api-reference/documentation.json")).paths['/members'].get['x-doc-description'];
  assert.match(description, /language-mermaid/);
  assert.doesNotMatch(description, /<script/);
  assert.ok(files.has('/api-reference/viewer.js'));
});

test("API without generated spec shows empty state; invalid spec fails without replacing files", async (t) => {
  const { root, config } = await fixture(t);
  let files = await siteFiles(config);
  assert.equal(JSON.parse(files.get('/api-reference/spec-metadata.json')).available, false);
  assert.match(files.get('/index.html').toString(), /api-reference\/page.css/);
  await writeFile(config.api.spec, JSON.stringify(spec));
  files = await siteFiles(config);
  assert.ok(files.has('/api-reference/documentation.json'));
  const before = await readFile(config.api.spec, 'utf8');
  const invalid = path.join(root, 'invalid.json');
  await writeFile(invalid, '{"openapi":"2.0"}');
  await assert.rejects(syncOpenApi(config, {file:invalid}), /OpenAPI 3/);
  assert.equal(await readFile(config.api.spec, 'utf8'), before);
  await assert.rejects(syncOpenApi(config, {url:'https://user:password@example.com/api'}), /인증 정보/);
  await writeFile(config.api.spec, '{broken');
  await assert.rejects(siteFiles(config), SyntaxError);
});

test("API config rejects paths outside root including symlinks", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, 'docs.config.ts');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('reference/spec.json', '../outside.json'));
  await assert.rejects(loadConfig(root), /하위 경로/);
  await symlink(tmpdir(), path.join(root, 'outside'));
  await writeFile(file, original.replace('reference/spec.json', 'outside/spec.json'));
  await assert.rejects(loadConfig(root), /하위 경로/);
});

test("diagram fitting preserves aspect ratio and zoom stays within limits", () => {
  assert.equal(fitZoom(2000,1000,1032,832),0.5);
  assert.equal(fitZoom(100,100,1032,832),1);
  assert.equal(clampZoom(0),0.05);
  assert.equal(clampZoom(100),8);
});

test("API sync downloads JSON and stops on non-retryable HTTP errors without replacing the spec", async (t) => {
  const { config } = await fixture(t);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify(spec), {status:200});
  });
  await syncOpenApi(config, {url:'https://example.com/v3/api-docs'});
  assert.equal(JSON.parse(await readFile(config.api.metadata)).source, 'server');
  const before = await readFile(config.api.spec, 'utf8');
  globalThis.fetch.mock.mockImplementation(async () => new Response('', {status:401}));
  await assert.rejects(syncOpenApi(config, {url:'https://example.com/v3/api-docs'}), /HTTP 401/);
  assert.equal(await readFile(config.api.spec, 'utf8'), before);
});
