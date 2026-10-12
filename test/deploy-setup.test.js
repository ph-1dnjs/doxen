import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, chmod, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { init } from "../src/init.js";
import { loadConfig } from "../src/config.js";
import { build } from "../src/build.js";
import { prepareDeployment, parseEmails } from "../src/deploy-setup.js";
import { saveToken, readToken, readDeploymentState } from "../src/deploy-state.js";
import { cloudflare } from "../src/cloudflare.js";

const account = "b".repeat(32);
const env = { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: "private-test-token" };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "doxen-setup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await init(root);
  return loadConfig(root);
}
function fakeCloud() {
  const calls = [];
  const apps = new Map();
  let project = null;
  let organization = null;
  let providers = [];
  let failPreview = false;
  const api = {
    async get(route) {
      calls.push(["GET", route]);
      if (route === `/accounts/${account}`) return { id: account, name: "Team" };
      if (route.endsWith("/pages/projects/team-docs")) return project;
      if (route.endsWith("/access/organizations")) return organization;
      const id = route.split("/").at(-1);
      if (apps.has(id)) return apps.get(id);
      throw new Error(`Unexpected GET ${route}`);
    },
    async list(route) {
      calls.push(["LIST", route]);
      if (route === "/accounts") return [{ id: account, name: "Team" }];
      if (route.endsWith("/identity_providers")) return providers;
      if (route.endsWith("/policies")) return apps.get(route.split("/").at(-2)).policies;
      throw new Error(`Unexpected LIST ${route}`);
    },
    async send(route, method, body) {
      calls.push([method, route, body]);
      if (method === "PUT" && route.includes("/policies/")) {
        const app = apps.get(route.split("/").at(-3));
        assert.equal(app.policies[0].id, route.split("/").at(-1));
        app.policies[0] = { ...body, id: app.policies[0].id };
        return app.policies[0];
      }
      if (route.endsWith("/pages/projects")) {
        assert.equal(body.deployment_configs.production.fail_open, false);
        assert.equal(body.deployment_configs.preview.fail_open, false);
        return project = { ...body, subdomain: "team-docs-allocated.pages.dev" };
      }
      if (route.endsWith("/access/organizations")) return organization = { auth_domain: "team.cloudflareaccess.com" };
      if (route.endsWith("/identity_providers")) {
        const provider = { ...body, id: randomUUID() };
        providers.push(provider);
        return provider;
      }
      if (route.endsWith("/access/apps")) {
        if (failPreview && body.domain.startsWith("*")) throw new Error("network unavailable");
        const app = { ...body, id: randomUUID(), aud: (apps.size ? "c" : "a").repeat(64) };
        app.policies = app.policies.map((policy) => ({ ...policy, id: randomUUID() }));
        apps.set(app.id, app);
        return app;
      }
      throw new Error(`Unexpected ${method} ${route}`);
    },
  };
  return { api, calls, apps, setFailPreview: (value) => failPreview = value,
    setProviders: (value) => providers = value,
    setOrganization: (value) => organization = value,
    setProject: (value) => project = value };
}
function prompts({ confirmed = true, store = false } = {}) {
  const messages = [];
  return {
    messages,
    async input(options) {
      messages.push(options.message);
      const value = options.message.startsWith("사이트") ? "team-docs" : "Member@Example.com, member@example.com";
      assert.equal(await options.validate(value), true);
      return value;
    },
    async select(options) { messages.push(options.message); return options.choices[0].value; },
    async confirm(options) { messages.push(options.message); return options.message.includes("토큰") ? store : confirmed; },
    async password(options) { messages.push(options.message); assert.equal(options.mask, "*"); return env.CLOUDFLARE_API_TOKEN; },
  };
}
const silent = () => {};

test("first deploy creates protection before producing a deployable config, then repeats without prompts or writes", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const prompt = prompts();
  const before = await readFile(config.file, "utf8");
  const prepared = await prepareDeployment(config, { env, prompt, apiFactory: () => cloud.api, log: silent });
  assert.deepEqual(prepared.config.deploy.access.emails, ["member@example.com"]);
  assert.equal(prepared.config.deploy.access.audiences.length, 2);
  const stateText = await readFile(path.join(config.root, ".doxen-deploy.json"), "utf8");
  assert.doesNotMatch(stateText, /private-test-token/);
  assert.equal(await readFile(config.file, "utf8"), before);
  assert.deepEqual([...cloud.apps.values()].map((app) => app.domain), ["team-docs-allocated.pages.dev", "*.team-docs-allocated.pages.dev"]);
  const loaded = await loadConfig(config.root);
  assert.deepEqual(loaded.deploy, prepared.config.deploy);
  const out = await build(loaded);
  assert.match(await readFile(path.join(out, "_worker.js"), "utf8"), /cf-access-jwt-assertion/);
  assert.doesNotMatch(await readFile(path.join(out, "site.json"), "utf8"), /member@example.com|private-test-token/);
  cloud.calls.length = 0;
  await prepareDeployment(loaded, { env, prompt: new Proxy({}, { get: () => assert.fail("unexpected prompt") }), apiFactory: () => cloud.api, log: silent });
  assert(cloud.calls.every(([method]) => ["GET", "LIST"].includes(method)));
});

test("cancel has no remote mutation or state file", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  await assert.rejects(prepareDeployment(config, { env, prompt: prompts({ confirmed: false }), apiFactory: () => cloud.api, log: silent }), /취소/);
  assert(cloud.calls.every(([method]) => ["GET", "LIST"].includes(method)));
  assert.equal(await readDeploymentState(config.root, config.file), null);
});

test("interrupted setup blocks ordinary builds and resumes recorded resources", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  cloud.setFailPreview(true);
  const options = { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent };
  await assert.rejects(prepareDeployment(config, options), /network unavailable/);
  const pending = await loadConfig(config.root);
  assert.equal(pending.deploymentState.ready, false);
  assert.equal(pending.deploy, undefined);
  await assert.rejects(build(pending), /아직 완료/);
  cloud.setFailPreview(false);
  await prepareDeployment(pending, options);
  assert.equal(cloud.apps.size, 2);
  assert.equal(cloud.calls.filter(([method, route]) => method === "POST" && route.endsWith("/pages/projects")).length, 1);
});

test("existing company IdP is reused without changing account login settings", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  cloud.setOrganization({ auth_domain: "team.cloudflareaccess.com" });
  const provider = { id: randomUUID(), name: "Company SSO", type: "oidc" };
  cloud.setProviders([provider]);
  const prompt = { ...prompts(), select: async () => provider.id };
  await prepareDeployment(config, { env, prompt, apiFactory: () => cloud.api, log: silent });
  for (const app of cloud.apps.values()) assert.deepEqual(app.allowed_idps, [provider.id]);
  assert(!cloud.calls.some(([method, route]) => method === "POST" && /organizations|identity_providers/.test(route)));
});

test("Cloudflare's default login does not prevent choosing email OTP for external readers", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  cloud.setOrganization({ auth_domain: "team.cloudflareaccess.com" });
  const provider = { id: randomUUID(), name: "", type: "cloudflare" };
  cloud.setProviders([provider]);
  const prompt = { ...prompts(), select: async ({ choices }) => {
    assert.match(choices[0].name, /이메일 일회용 코드/);
    assert.match(choices[1].name, /Cloudflare 계정 필요/);
    return choices[0].value;
  } };
  const prepared = await prepareDeployment(config, { env, prompt, apiFactory: () => cloud.api, log: silent });
  const created = cloud.calls.find(([method, route]) => method === "POST" && route.endsWith("/identity_providers"));
  assert.equal(created[2].type, "onetimepin");
  assert.notEqual(prepared.config.deploymentState.providerId, provider.id);
  for (const app of cloud.apps.values())
    assert.deepEqual(app.allowed_idps, [prepared.config.deploymentState.providerId]);
  assert(!cloud.calls.some(([method]) => ["PUT", "PATCH", "DELETE"].includes(method)));
});

test("changed policy, wrong account and a same-name project stop deployment", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const options = { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent };
  await prepareDeployment(config, options);
  const loaded = await loadConfig(config.root);
  const app = [...cloud.apps.values()][0];
  app.policies.push({ decision: "bypass", include: [{ everyone: {} }] });
  await assert.rejects(prepareDeployment(loaded, options), /허용 이메일 정책/);
  await assert.rejects(prepareDeployment(loaded, { ...options, env: { ...env, CLOUDFLARE_ACCOUNT_ID: "d".repeat(32) } }), /계정이/);
  const other = await fixture(t);
  const collisionPrompt = { ...prompts(), input: async ({ message }) => message.startsWith("사이트") ? "team-docs" : "member@example.com" };
  cloud.calls.length = 0;
  await assert.rejects(prepareDeployment(other, { ...options, prompt: collisionPrompt }), /이미 있습니다/);
  assert(!cloud.calls.some(([method]) => method === "POST"));
});

test("token input is masked, optional local storage is private and reusable", async (t) => {
  const config = await fixture(t);
  const credentialDir = path.join(config.root, "local-credentials");
  const cloud = fakeCloud();
  const log = [];
  await prepareDeployment(config, { env: {}, prompt: prompts({ store: true }), credentialDir, apiFactory: () => cloud.api, log: (line) => log.push(line) });
  assert(!log.join("\n").includes(env.CLOUDFLARE_API_TOKEN));
  if (process.platform !== "win32") {
    assert.equal(await readToken(account, credentialDir), env.CLOUDFLARE_API_TOKEN);
    assert.equal((await stat(path.join(credentialDir, `${account}.json`))).mode & 0o777, 0o600);
    await prepareDeployment(await loadConfig(config.root), { env: {}, credentialDir, apiFactory: () => cloud.api, log: silent });
    await chmod(path.join(credentialDir, `${account}.json`), 0o644);
    await assert.rejects(readToken(account, credentialDir), /접근 권한/);
  }
});

test("saved settings cannot be silently mixed with manual config or another config file", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const prepared = await prepareDeployment(config, { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent });
  await assert.rejects(readDeploymentState(config.root, "other.config.ts"), /맞지 않습니다/);
  await writeFile(config.file, `export default ${JSON.stringify({ title: "Test", tabs: [{title:"Guide",slug:"guide",dir:"./docs"}], deploy: prepared.config.deploy })}`);
  await assert.rejects(loadConfig(config.root), /함께 있습니다/);
});

test("Cloudflare API handles pagination, missing resources and redacts error bodies", async () => {
  const api = cloudflare("secret", async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer secret");
    const page = new URL(url).searchParams.get("page");
    return Response.json({ success: true, result: page === "1" ? Array.from({length: 50}, (_, id) => ({ id })) : [{ id: 50 }], result_info: { total_pages: 2 } });
  });
  assert.equal((await api.list("/accounts")).length, 51);
  const missing = cloudflare("secret", async () => new Response("", { status: 404 }));
  assert.equal(await missing.get("/missing", { missing: true }), null);
  await assert.rejects(missing.get("/missing"), /HTTP 404/);
  const denied = cloudflare("secret", async () => Response.json({ success: false, errors: [{ message: "secret" }] }, { status: 403 }));
  await assert.rejects(denied.get("/accounts"), (error) => error.status === 403 && !error.message.includes("secret"));
});

test("email input normalizes duplicates and local tokens validate the account path", async () => {
  assert.deepEqual(parseEmails("A@example.com, a@example.com; b@example.com"), ["a@example.com", "b@example.com"]);
  await assert.rejects(saveToken("../escape", "token"), /계정 ID/);
});


test("legacy explicit config and environment credentials need no new account permissions", async () => {
  const config = { deploy: { project: "existing" } };
  const prepared = await prepareDeployment(config, { env, apiFactory: () => assert.fail("unexpected account API") });
  assert.equal(prepared.config, config);
  assert.equal(prepared.env, env);
});

test("an expired saved token can be replaced without editing files", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const credentialDir = path.join(config.root, "credentials");
  await prepareDeployment(config, { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent });
  await saveToken(account, "expired", credentialDir);
  const loaded = await loadConfig(config.root);
  const prompt = prompts({ store: true });
  const prepared = await prepareDeployment(loaded, {
    env: {}, credentialDir, prompt, log: silent,
    apiFactory: (token) => token === "expired" ? { get: async () => { const error = new Error("expired"); error.status = 401; throw error; } } : cloud.api,
  });
  assert.equal(prepared.env.CLOUDFLARE_API_TOKEN, env.CLOUDFLARE_API_TOKEN);
  assert(prompt.messages.includes("새 API 토큰"));
});


test("JSON email additions and removals synchronize both policies and are idempotent", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const options = { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent };
  await prepareDeployment(config, options);
  const loaded = await loadConfig(config.root);
  for (const emails of [["member@example.com", "new@example.com"], ["new@example.com"]]) {
    loaded.deploymentState.emails = emails;
    cloud.calls.length = 0;
    const result = await prepareDeployment(loaded, options);
    assert.deepEqual(result.config.deploy.access.emails, emails);
    assert.equal(cloud.calls.filter(([method]) => method === "PUT").length, 2);
    for (const app of cloud.apps.values())
      assert.deepEqual(app.policies[0].include, emails.map((email) => ({ email: { email } })));
    cloud.calls.length = 0;
    await prepareDeployment(loaded, options);
    assert(!cloud.calls.some(([method]) => method === "PUT"));
  }
});

test("sync checks both apps before writing and refuses custom conditions or empty emails", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const options = { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent };
  await prepareDeployment(config, options);
  const loaded = await loadConfig(config.root);
  loaded.deploymentState.emails.push("new@example.com");
  const preview = [...cloud.apps.values()][1];
  preview.policies[0].require = [{ email_domain: { domain: "example.com" } }];
  cloud.calls.length = 0;
  await assert.rejects(prepareDeployment(loaded, options), /별도 조건/);
  assert(!cloud.calls.some(([method]) => method === "PUT"));
  loaded.deploymentState.emails = [];
  await assert.rejects(prepareDeployment(loaded, options), /하나 이상/);
  assert(!cloud.calls.some(([method]) => method === "PUT"));
});

test("partial email sync failure stops deployment and next attempt repairs the remaining policy", async (t) => {
  const config = await fixture(t);
  const cloud = fakeCloud();
  const options = { env, prompt: prompts(), apiFactory: () => cloud.api, log: silent };
  await prepareDeployment(config, options);
  const loaded = await loadConfig(config.root);
  loaded.deploymentState.emails.push("new@example.com");
  const send = cloud.api.send;
  let writes = 0;
  cloud.api.send = async (...args) => {
    if (args[1] === "PUT" && ++writes === 2) throw new Error("sync unavailable");
    return send(...args);
  };
  await assert.rejects(prepareDeployment(loaded, options), /sync unavailable/);
  cloud.api.send = send;
  cloud.calls.length = 0;
  await prepareDeployment(loaded, options);
  assert.equal(cloud.calls.filter(([method]) => method === "PUT").length, 1);
});
