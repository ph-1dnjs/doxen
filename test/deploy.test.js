import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { accessWorker } from "../src/access-worker.js";
import { deploy, checkProject, validateDeployment } from "../src/deploy.js";
import { init } from "../src/init.js";
import { loadConfig } from "../src/config.js";
import { build } from "../src/build.js";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const settings = {
  project: "team-docs",
  access: {
    teamDomain: "https://team.cloudflareaccess.com",
    audiences: ["a".repeat(64)],
    emails: ["member@example.com"],
  },
};

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
  await assert.rejects(deploy(config), /wrangler@4/);
  const wrangler = path.join(root, "node_modules", "wrangler");
  await mkdir(path.join(wrangler, "bin"), { recursive: true });
  await writeFile(path.join(wrangler, "package.json"), JSON.stringify({ name: "wrangler" }));
  await writeFile(path.join(wrangler, "bin", "wrangler.js"), `
    const fs = require('node:fs');
    const path = require('node:path');
    const args = process.argv.slice(2);
    const out = args[2];
    if (!fs.existsSync(path.join(out, '_worker.js'))) process.exit(2);
    fs.writeFileSync(path.join(${JSON.stringify(root)}, 'invocation.json'), JSON.stringify({args, cwd: process.cwd()}));
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
  await assert.rejects(readFile(path.join(invocation.cwd, "wrangler.json")), { code: "ENOENT" });
  await writeFile(path.join(wrangler, "bin", "wrangler.js"), "process.exit(9);");
  await assert.rejects(deploy(config), /종료 코드 9/);
});
