import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { accessWorker } from "../src/access-worker.js";
import { resolveWrangler, deploy, checkProject, validateDeployment } from "../src/deploy.js";
import { init } from "../src/init.js";
import { loadConfig } from "../src/config.js";
import { build } from "../src/build.js";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setupAssistant } from "../src/assistant-setup.js";
import { readDeploymentState } from "../src/deploy-state.js";

const settings = {
  project: "team-docs",
  access: {
    teamDomain: "https://team.cloudflareaccess.com",
    audiences: ["a".repeat(64)],
    emails: ["member@example.com"],
  },
};

test("Workers AI setup requires a ready deployment and explicit Free confirmation", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-assistant-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await init(root);
  const config = await loadConfig(root);
  await assert.rejects(setupAssistant(config, { prompt: { confirm: async () => true }, log: () => {} }), /먼저/);
  const state = { version: 1, configFile: path.basename(config.file), accountId: "b".repeat(32), project: "team-docs", emails: ["member@example.com"], apps: {}, ready: true };
  const ready = { ...config, deploymentState: state };
  await assert.rejects(setupAssistant(ready, { prompt: { confirm: async () => false }, log: () => {} }), /설정하지/);
  assert.equal(await readDeploymentState(root, config.file), null);
  await setupAssistant(ready, { prompt: { confirm: async () => true }, log: () => {} });
  assert.equal((await readDeploymentState(root, config.file)).workersAiFree, true);
});

test("Workers AI endpoint requires Access and handles free quota exhaustion", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "assistant", alg: "RS256" }] });
  const worker = accessWorker(settings.access, keys, true);
  const token = await new SignJWT({ email: "member@example.com" }).setProtectedHeader({ alg: "RS256", kid: "assistant" })
    .setIssuer(settings.access.teamDomain).setAudience(settings.access.audiences).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const site = { documents: [{ id: "guide/start", title: "시작", sections: [{ title: "설치", text: "npm install", anchor: "install" }] }] };
  let calls = 0;
  const env = { ASSETS: { fetch: async () => Response.json(site) }, AI: { run: async () => { calls++; return { response: "설치하세요 [1]" }; } } };
  const headers = { "content-type": "application/json", origin: "https://team-docs.pages.dev", "cf-access-jwt-assertion": token };
  const url = "https://team-docs.pages.dev/__doxen/assistant";
  const body = JSON.stringify({ question: "설치 방법", sources: [{ index: 0, text: "npm install" }] });
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: { ...headers, "cf-access-jwt-assertion": "invalid" }, body }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body }), env)).status, 403);
  assert.equal(calls, 0);
  const response = await worker.fetch(new Request(url, { method: "POST", headers, body }), env);
  assert.deepEqual(await response.json(), { answer: "설치하세요 [1]" });
  assert.equal(calls, 1);
  const stale = JSON.stringify({ question: "설치", sources: [{ index: 0, text: "old content" }] });
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers, body: stale }), env)).status, 409);
  env.AI.run = async () => { throw Object.assign(new Error("quota"), { code: 3036 }); };
  const limited = await worker.fetch(new Request(url, { method: "POST", headers, body }), env);
  assert.equal(limited.status, 429);
  assert.match(await limited.text(), /무료 사용량/);
});

test("deployment rejects absent and unsafe access configuration", () => {
  for (const value of [undefined, {}, { ...settings, access: {} },
    { ...settings, project: "../bad" },
    { ...settings, access: { ...settings.access, emails: [] } },
    { ...settings, access: { ...settings.access, emails: ["*@example.com"] } },
    { ...settings, access: { ...settings.access, audiences: [] } },
    { ...settings, access: { ...settings.access, teamDomain: "https://attacker.com" } },
  ]) assert.throws(() => validateDeployment(value));
  assert.deepEqual(validateDeployment(settings), settings);
});

test("every asset requires a signed, unexpired token for the configured audience and email", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const worker = accessWorker(settings.access, keys);
  const claims = {
    iss: settings.access.teamDomain, aud: settings.access.audiences,
    email: "member@example.com", iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const sign = (payload, key = privateKey) => new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test" }).sign(key);
  let reads = 0;
  const env = { ASSETS: { fetch: async () => { reads++; return new Response("confidential"); } } };
  const otherKey = await generateKeyPair("RS256");
  for (const token of [null, "bad.jwt.value", await sign({ ...claims, exp: 1 }),
    await sign({ ...claims, aud: ["wrong"] }), await sign({ ...claims, iss: "https://attacker.com" }),
    await sign({ ...claims, email: "outsider@example.com" }), await sign({ ...claims, exp: undefined }),
    await sign({ ...claims, nbf: claims.exp + 100 }), await sign(claims, otherKey.privateKey),
  ]) {
    for (const url of ["/", "/site.json", "/assets/private.pdf", "/app.js"]) {
      const response = await worker.fetch(new Request(`https://team-docs.pages.dev${url}`, {
        headers: token ? { "cf-access-jwt-assertion": token } : {},
      }), env);
      assert.equal(response.status, 403);
      assert.match(response.headers.get("cache-control"), /no-store/);
      assert.doesNotMatch(await response.text(), /confidential/);
    }
  }
  assert.equal(reads, 0);
  const response = await worker.fetch(new Request("https://team-docs.pages.dev/site.json", {
    headers: { "cf-access-jwt-assertion": await sign({ ...claims, email: "Member@Example.com" }) },
  }), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "confidential");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(reads, 1);
  const unavailable = accessWorker(settings.access, async () => { throw new Error("JWKS unavailable"); });
  assert.equal((await unavailable.fetch(new Request("https://team-docs.pages.dev", {
    headers: { "cf-access-jwt-assertion": await sign(claims) },
  }), env)).status, 403);
  assert.equal(reads, 1);
});

test("deployment requires credentials and both environments to fail closed", async () => {
  const env = { CLOUDFLARE_ACCOUNT_ID: "b".repeat(32), CLOUDFLARE_API_TOKEN: "test" };
  await assert.rejects(checkProject(settings, {}), /환경 변수/);
  for (const failOpen of [true, undefined, null]) {
    await assert.rejects(checkProject(settings, env, async () => Response.json({
      success: true, result: { production_branch: "main", deployment_configs: {
        production: { fail_open: false }, preview: { fail_open: failOpen },
      } },
    })), /Fail closed/);
  }
  await assert.rejects(checkProject(settings, env, async () => new Response("denied", { status: 403 })), /HTTP 403/);
  const result = await checkProject(settings, env, async (url, options) => {
    assert.match(url, /pages\/projects\/team-docs$/);
    assert.equal(options.headers.Authorization, "Bearer test");
    return Response.json({ success: true, result: { production_branch: "release", deployment_configs: {
      production: { fail_open: false }, preview: { fail_open: false },
    } } });
  });
  assert.equal(result.production_branch, "release");
});

test("protected build bundles its worker and routes all paths, without exposing emails in site data", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-deploy-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await init(root);
  const file = path.join(root, "docs.config.ts");
  await writeFile(file, `export default ${JSON.stringify({ title: "Team", tabs: [{ title: "Guide", slug: "guide", dir: "./docs" }], deploy: settings })}`);
  const config = await loadConfig(root);
  const out = await build(config);
  assert.deepEqual(JSON.parse(await readFile(path.join(out, "_routes.json"))), { version: 1, include: ["/*"], exclude: [] });
  const workerSource = await readFile(path.join(out, "_worker.js"), "utf8");
  assert.doesNotMatch(workerSource, /from ["']jose["']/);
  const worker = (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`)).default;
  assert.equal((await worker.fetch(new Request("https://team-docs.pages.dev/site.json"), {
    ASSETS: { fetch: () => assert.fail("unauthenticated read") },
  })).status, 403);
  const site = await readFile(path.join(out, "site.json"), "utf8");
  assert.doesNotMatch(site, /member@example.com|cloudflareaccess/);
  const pkg = JSON.parse(await readFile(path.join(root, "package.json")));
  assert.equal(pkg.scripts["docs:deploy"], "doxen deploy");
  await assert.rejects(build({ ...config, deploy: { ...settings, access: {} } }));
  assert.equal(await readFile(path.join(out, "site.json"), "utf8"), site);
});


test("deploy builds before invoking local Wrangler and propagates upload failures", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-upload-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await init(root);
  const config = { ...await loadConfig(root), deploy: settings };
  assert.match(await readFile(resolveWrangler(config.root), "utf8"), /node/);
  await assert.rejects(deploy(config, { env: {}, credentialDir: path.join(root, "credentials") }), /최초 배포 설정/);
  const wrangler = path.join(root, "node_modules", "wrangler");
  await mkdir(path.join(wrangler, "bin"), { recursive: true });
  await writeFile(path.join(wrangler, "package.json"), JSON.stringify({ name: "wrangler" }));
  await writeFile(path.join(wrangler, "bin", "wrangler.js"), `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    const out = args[2];
    if (!fs.existsSync(path.join(out, '_worker.js'))) process.exit(2);
    fs.writeFileSync(path.join(${JSON.stringify(root)}, 'invocation.json'), JSON.stringify({args, cwd: process.cwd(), config: JSON.parse(fs.readFileSync('wrangler.json', 'utf8'))}));
  `);
  const saved = { account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN };
  t.after(() => {
    for (const [key, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: saved.account, CLOUDFLARE_API_TOKEN: saved.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  process.env.CLOUDFLARE_ACCOUNT_ID = "b".repeat(32);
  process.env.CLOUDFLARE_API_TOKEN = "test";
  t.mock.method(globalThis, "fetch", async () => Response.json({ success: true, result: {
    production_branch: "release", deployment_configs: {
      production: { fail_open: false }, preview: { fail_open: false },
    },
  } }));
  await deploy(config);
  const invocation = JSON.parse(await readFile(path.join(root, "invocation.json")));
  assert.deepEqual(invocation.args, ["pages", "deploy", path.join(config.root, ".docs-dist"), "--project-name", "team-docs", "--branch", "release"]);
  assert.equal(invocation.config.ai, undefined);
  await deploy({ ...config, deploy: { ...settings, workersAiFree: true } });
  const enabled = JSON.parse(await readFile(path.join(root, "invocation.json")));
  assert.deepEqual(enabled.config.ai, { binding: "AI" });
  const site = JSON.parse(await readFile(path.join(config.root, ".docs-dist", "site.json")));
  assert.deepEqual(site.assistant, { provider: "workers-ai-free" });
  await assert.rejects(readFile(path.join(invocation.cwd, "wrangler.json")), { code: "ENOENT" });
  await writeFile(path.join(wrangler, "bin", "wrangler.js"), "process.exit(9);");
  await assert.rejects(deploy(config), /종료 코드 9/);
});

test("comments require Access authentication and use the authenticated author", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "comments", alg: "RS256" }] });
  const worker = accessWorker(settings.access, keys);
  const token = await new SignJWT({ email: "Member@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "comments" }).setIssuer(settings.access.teamDomain)
    .setAudience(settings.access.audiences).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  let inserted;
  const env = { COMMENTS_DB: { prepare: (sql) => ({
    run: async () => ({}),
    bind: (...values) => ({
      run: async () => { if (sql.startsWith("INSERT INTO comments")) inserted = values; },
      first: async () => ({ avatar_index: 0 }), all: async () => ({ results: [{ body: "hello" }] }),
    }),
  }) } };
  const url = "https://team-docs.pages.dev/__doxen/comments";
  assert.equal((await worker.fetch(new Request(url), env)).status, 403);
  const headers = { "cf-access-jwt-assertion": token, "content-type": "application/json", origin: "https://team-docs.pages.dev" };
  const data = { document: "guide/a", block: "paragraph", quote: "part", body: "hello", author: "forged@example.com" };
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: JSON.stringify(data) }), env)).status, 403);
  const created = await worker.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify(data) }), env);
  assert.equal(created.status, 201);
  assert.equal((await created.json()).author, "member@example.com");
  assert.equal(inserted[5], "member@example.com");
  assert.equal((await worker.fetch(new Request(`${url}?document=guide%2Fa`, { headers }), env)).status, 200);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers, body: JSON.stringify({ ...data, body: " " }) }), env)).status, 400);
  const statements = [];
  const mutationEnv = { COMMENTS_DB: { prepare: (sql) => ({ bind: (...values) => ({
    first: async () => { statements.push({ sql, values }); return (sql.startsWith("UPDATE") ? values[1] === "own" && values[2] === "member@example.com" : values[1] === "member@example.com" && values[0] === "own") ? { document: "guide/a", block: "paragraph" } : null; },
    run: async () => { statements.push({ sql, values }); return { meta: { changes: 1 } }; },
  }) }) } };
  const mutate = (method, body, extraHeaders = {}) => worker.fetch(new Request(url, { method, headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) }), mutationEnv);
  assert.equal((await mutate("PUT", { id: "other", body: "변경" })).status, 404);
  assert.equal((await mutate("PUT", { id: "own", body: "  변경  " })).status, 204);
  assert.deepEqual(statements.at(-1).values, ["변경", "own", "member@example.com"]);
  assert.equal((await mutate("PUT", { id: "own", body: "  " })).status, 400);
  assert.equal((await mutate("PUT", { id: "own", body: "x".repeat(5001) })).status, 400);
  statements.length = 0;
  assert.equal((await mutate("DELETE", { id: "other" })).status, 404);
  assert.equal(statements[0].values[1], "member@example.com");
  assert.equal((await mutate("DELETE", { id: "own" })).status, 204);
  assert.match(statements.at(-1).sql, /NOT EXISTS/);
  assert.equal((await mutate("PATCH", { document: "guide/a", block: "paragraph", resolved: true })).status, 204);
  assert.match(statements.at(-1).sql, /INSERT INTO comment_resolutions/);
  assert.equal((await mutate("PATCH", { document: "guide/a", block: "paragraph", resolved: false })).status, 204);
  assert.equal((await mutate("PATCH", { document: "guide/a", block: "paragraph", resolved: "true" })).status, 400);
  assert.equal((await mutate("DELETE", { id: "own" }, { origin: "https://evil.example" })).status, 403);
});


test("comment avatar positions follow access order and survive removals", async (t) => {
  const sqlite = await import("node:sqlite").catch(() => null);
  if (!sqlite) return t.skip("node:sqlite가 제공되지 않는 Node 버전입니다.");
  const { DatabaseSync } = sqlite;
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(new URL("../src/comments.sql", import.meta.url), "utf8"));
  const adapter = { prepare(sql) {
    const statement = db.prepare(sql);
    const wrap = (...values) => ({
      run: async () => statement.run(...values),
      first: async () => statement.get(...values) || null,
      all: async () => ({ results: statement.all(...values) }),
    });
    return { ...wrap(), bind: (...values) => wrap(...values) };
  } };
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "avatars", alg: "RS256" }] });
  const token = await new SignJWT({ email: "a@example.com" }).setProtectedHeader({ alg: "RS256", kid: "avatars" }).setIssuer(settings.access.teamDomain).setAudience(settings.access.audiences).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const read = async (emails) => {
    const worker = accessWorker({ ...settings.access, emails }, keys);
    const response = await worker.fetch(new Request("https://team-docs.pages.dev/__doxen/comments?document=guide", { headers: { "cf-access-jwt-assertion": token } }), { COMMENTS_DB: adapter });
    assert.equal(response.status, 200);
    return response;
  };
  db.prepare("INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?, ?)").run("1", "guide", "block", "", "기존 댓글", "old@example.com", "2026-01-01");
  const first = await read(["a@example.com", "b@example.com", "c@example.com"]);
  assert.equal(first.headers.get("X-Doxen-Avatar-Index"), "0");
  assert.equal((await first.json())[0].avatar_index, 3);
  await read(["a@example.com", "c@example.com", "d@example.com"]);
  await read(["a@example.com", "d@example.com", "c@example.com"]);
  assert.deepEqual(db.prepare("SELECT email, position - 1 AS idx FROM comment_avatars ORDER BY position").all().map((row) => ({ ...row })), [
    { email: "a@example.com", idx: 0 }, { email: "b@example.com", idx: 1 }, { email: "c@example.com", idx: 2 },
    { email: "old@example.com", idx: 3 }, { email: "d@example.com", idx: 4 },
  ]);
  db.close();
});
