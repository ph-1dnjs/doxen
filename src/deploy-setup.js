import path from "node:path";
import { cloudflare } from "./cloudflare.js";
import { readToken, saveToken, saveDeploymentState, deploymentFromState, credentialsDirectory } from "./deploy-state.js";
import { validateDeployment } from "./deploy.js";

const tokenUrl = "https://dash.cloudflare.com/profile/api-tokens";
const accountPattern = /^[a-f0-9]{32}$/i;
const projectPattern = /^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/;
export const parseEmails = (text) => [...new Set(text.split(/[\s,;]+/).filter(Boolean).map((email) => email.toLowerCase()))];
const validEmails = (emails) => emails.length > 0 && emails.every((email) => typeof email === "string" && /^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email));

export async function terminalPrompts() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("최초 배포 설정은 터미널에서 npx doxen deploy로 진행하세요. CI에서는 저장된 배포 설정과 CLOUDFLARE_API_TOKEN을 사용하세요.");
  return import("@inquirer/prompts");
}

// Only new resources or IDs recorded by this setup are used. Never adopt a same-name project.
export async function provision(config, state, api, log = console.log) {
  const base = `/accounts/${state.accountId}`;
  const persist = () => saveDeploymentState(config.root, state);
  const pages = `${base}/pages/projects/${state.project}`;
  let project = await api.get(pages, { missing: true });
  if (project && !state.projectCreated)
    throw new Error(`동일한 Pages 프로젝트가 이미 있습니다: ${state.project}. 기존 사이트를 덮어쓰지 않습니다. 대시보드에서 확인한 뒤 새 이름으로 .doxen-deploy.json의 project를 변경하세요.`);
  if (!project && state.projectCreated)
    throw new Error("설정 중 만든 Pages 프로젝트가 삭제되었습니다. 대시보드와 .doxen-deploy.json을 확인하세요.");
  if (!project) {
    log("배포 공간을 준비합니다. 문서는 아직 업로드하지 않습니다.");
    project = await api.send(`${base}/pages/projects`, "POST", {
      name: state.project, production_branch: "main",
      deployment_configs: { production: { fail_open: false }, preview: { fail_open: false } },
    });
    state.projectCreated = true;
    await persist();
  }
  // Use Cloudflare's actual allocated subdomain, not a guessed project name.
  if (typeof project.subdomain !== "string" || !/^[a-z0-9-]+\.pages\.dev$/.test(project.subdomain))
    throw new Error("Cloudflare 배포 주소를 확인할 수 없습니다. 문서를 업로드하지 않습니다.");
  state.hostname = project.subdomain;
  await persist();
  if (project.deployment_configs?.production?.fail_open !== false || project.deployment_configs?.preview?.fail_open !== false)
    await api.send(pages, "PATCH", { deployment_configs: { production: { fail_open: false }, preview: { fail_open: false } } });

  let organization = await api.get(`${base}/access/organizations`, { missing: true });
  if (!organization) organization = await api.send(`${base}/access/organizations`, "POST", { name: "Doxen" });
  state.teamDomain = `https://${organization.auth_domain}`;
  if (!/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(state.teamDomain))
    throw new Error("Zero Trust 팀 주소를 확인할 수 없습니다. Cloudflare One 시작 설정을 확인하세요.");
  const providers = await api.list(`${base}/access/identity_providers`);
  let provider = providers.find((item) => item.id === state.providerId);
  if (!provider && state.providerId) throw new Error("선택한 로그인 방법이 삭제되었습니다. Cloudflare One에서 확인하세요.");
  if (!provider) {
    provider = providers.find((item) => item.type === "onetimepin");
    if (!provider && providers.length)
      throw new Error("기존 회사 로그인 설정이 발견되었습니다. npx doxen deploy를 다시 실행해 사용할 로그인 방법을 선택하세요.");
    if (!provider) provider = await api.send(`${base}/access/identity_providers`, "POST", { name: "Doxen 이메일 인증", type: "onetimepin", config: {} });
    state.providerId = provider.id;
    await persist();
  }
  log("운영·미리보기 주소에 허용 사용자 인증을 적용합니다.");
  for (const [kind, domain] of [["production", state.hostname], ["preview", `*.${state.hostname}`]]) {
    if (state.apps[kind]) continue;
    const app = await api.send(`${base}/access/apps`, "POST", {
      name: `Doxen ${state.project} ${kind}`, type: "self_hosted", domain,
      session_duration: "24h", allowed_idps: [state.providerId],
      auto_redirect_to_identity: true, app_launcher_visible: false,
      policies: [{ name: "Doxen 열람자", decision: "allow", include: state.emails.map((email) => ({ email: { email } })) }],
    });
    if (!app.id || !app.aud) throw new Error("Access 애플리케이션 응답이 불완전합니다. 대시보드에서 생성 결과를 확인하세요.");
    state.apps[kind] = { id: app.id, aud: app.aud };
    await persist();
  }
  await verifySetup(state, api, { syncEmails: true, log });
  state.ready = true;
  await persist();
  return validateDeployment(deploymentFromState(state));
}

export async function verifySetup(state, api, { syncEmails = false, log = console.log } = {}) {
  if (!Array.isArray(state.emails) || !validEmails(state.emails))
    throw new Error("emails에 허용할 이메일을 하나 이상 입력하세요.");
  const desired = [...new Set(state.emails.map((email) => email.toLowerCase()))];
  const updates = [];
  const base = `/accounts/${state.accountId}`;
  for (const [kind, domain] of [["production", state.hostname], ["preview", `*.${state.hostname}`]]) {
    const saved = state.apps[kind];
    if (!saved || !/^[\da-f-]{36}$/i.test(saved.id)) throw new Error("저장된 Access 설정이 불완전합니다.");
    const route = `${base}/access/apps/${saved.id}`;
    const app = await api.get(route);
    if (app?.type !== "self_hosted" || app.domain !== domain || app.aud !== saved.aud ||
        app.allowed_idps?.length !== 1 || app.allowed_idps[0] !== state.providerId ||
        app.options_preflight_bypass === true)
      throw new Error("Cloudflare의 접근 설정이 저장된 설정과 다릅니다. 배포를 중단합니다.");
    const policies = await api.list(`${route}/policies`);
    const policy = policies[0];
    const actual = policy?.include?.map((rule) => Object.keys(rule).length === 1 ? rule.email?.email?.toLowerCase() : undefined);
    if (policies.length !== 1 || policy.decision !== "allow" || !actual ||
        !validEmails(actual))
      throw new Error("허용 이메일 정책이 변경되었거나 확인되지 않았습니다. Doxen의 단일 이메일 Allow 정책만 자동 관리합니다.");
    const same = actual.length === desired.length && new Set(actual).size === desired.length &&
      actual.every((email) => desired.includes(email));
    if (same) continue;
    if (!syncEmails)
      throw new Error("허용 이메일 정책이 아직 로컬 emails와 일치하지 않습니다. 같은 배포 명령으로 다시 시도하세요.");
    // Do not replace reusable policies or discard manually added security conditions.
    if (policy.name !== "Doxen 열람자" || !/^[\da-f-]{36}$/i.test(policy.id) ||
        policy.reusable === true || policy.app_count > 1 || policy.require?.length ||
        policy.exclude?.length || policy.approval_required || policy.approval_groups?.length ||
        policy.purpose_justification_required || policy.connection_rules)
      throw new Error("허용 이메일 정책에 별도 조건이 설정되어 자동 수정할 수 없습니다. 기존 보안 설정을 확인하세요.");
    const body = {
      name: policy.name, decision: "allow",
      include: desired.map((email) => ({ email: { email } })),
    };
    for (const key of ["precedence", "session_duration", "isolation_required", "mfa_config"])
      if (policy[key] !== undefined) body[key] = policy[key];
    updates.push({ route: `${route}/policies/${policy.id}`, body });
  }
  // Validate both applications before changing either. Retrying repairs a partial update.
  for (const update of updates) {
    log("JSON의 허용 이메일 목록을 Cloudflare 정책에 반영합니다.");
    await api.send(update.route, "PUT", update.body);
  }
  if (updates.length) await verifySetup(state, api);

}

export async function prepareDeployment(config, {
  env = process.env, prompt, apiFactory = cloudflare, credentialDir = credentialsDirectory, log = console.log,
} = {}) {
  let state = config.deploymentState;
  let account = env.CLOUDFLARE_ACCOUNT_ID || state?.accountId;
  if (account && !accountPattern.test(account)) throw new Error("Cloudflare 계정 ID가 올바르지 않습니다.");
  if (state && account !== state.accountId) throw new Error("환경 변수의 계정이 저장된 배포 계정과 다릅니다.");
  if (config.deploy && !state && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN)
    return { config, env };
  let token = env.CLOUDFLARE_API_TOKEN || (account ? await readToken(account, credentialDir) : null);
  let entered = false;
  const ui = async () => prompt ||= await terminalPrompts();
  if (!token) {
    const ask = await ui();
    log(`Cloudflare 연결: ${tokenUrl}\n로그인 후 Create Token → Create Custom Token을 선택하세요.\n배포할 계정 하나에 다음 권한을 부여하세요:\n• Account Settings: Read\n• Cloudflare Pages: Edit\n• Access: Apps and Policies: Edit\n• Access: Organizations, Identity Providers, and Groups: Edit\n토큰은 채팅이나 문서 파일에 붙여넣지 말고 아래에 입력하세요.`);
    token = (await ask.password({ message: "발급한 API 토큰", mask: "*", validate: (value) => !!value.trim() || "토큰을 입력하세요." })).trim();
    entered = true;
  }
  let api = apiFactory(token);
  if (!account) {
    const accounts = await api.list("/accounts");
    if (!accounts.length) throw new Error("접근 가능한 계정이 없습니다. 토큰의 Account Settings Read와 계정 범위를 확인하세요.");
    account = accounts.length === 1 ? accounts[0].id : await (await ui()).select({
      message: "문서를 배포할 계정", choices: accounts.map((item) => ({ name: item.name, value: item.id })),
    });
  }
  if (!accountPattern.test(account)) throw new Error("Cloudflare 계정 응답이 올바르지 않습니다.");
  try {
    await api.get(`/accounts/${account}`);
  } catch (error) {
    if (env.CLOUDFLARE_API_TOKEN || entered || ![401, 403].includes(error.status)) throw error;
    log("저장된 토큰이 만료되었거나 권한이 변경되었습니다. 새 토큰을 입력하세요.");
    token = (await (await ui()).password({ message: "새 API 토큰", mask: "*", validate: (value) => !!value.trim() || "토큰을 입력하세요." })).trim();
    api = apiFactory(token);
    await api.get(`/accounts/${account}`);
    entered = true;
  }
  if (entered && process.platform !== "win32" && await (await ui()).confirm({
    message: "다음 배포를 위해 토큰을 이 컴퓨터에 저장할까요? (사용자 전용 파일, 평문 저장)", default: false,
  })) await saveToken(account, token, credentialDir);
  const credentials = { ...env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token };
  if (config.deploy && !state) return { config, env: credentials };
  if (state?.ready) {
    await verifySetup(state, api, { syncEmails: true, log });
    return { config: { ...config, deploy: validateDeployment(deploymentFromState(state)) }, env: credentials };
  }
  const ask = await ui();
  if (!state) {
    log("처음 배포할 사이트와 열람할 사람을 지정합니다.");
    const project = await ask.input({ message: "사이트 이름 (영문 소문자·숫자·하이픈, 2~59자)",
      validate: async (value) => {
        if (!projectPattern.test(value)) return "영문 소문자·숫자·하이픈으로 2~59자를 입력하세요. 처음과 끝은 영문 또는 숫자여야 합니다.";
        return await api.get(`/accounts/${account}/pages/projects/${value}`, { missing: true })
          ? "이미 사용 중인 사이트 이름입니다. 다른 이름을 입력하세요." : true;
      } });
    const emails = parseEmails(await ask.input({ message: "열람할 업무 이메일 (본인 포함, 여러 명은 쉼표로 구분)",
      validate: (value) => validEmails(parseEmails(value)) || "허용할 이메일 주소를 입력하세요. 와일드카드는 사용할 수 없습니다." }));
    state = { version: 1, configFile: path.basename(config.file), accountId: account, project, emails, apps: {}, ready: false };
  }
  // Read before mutation so an existing company login is preserved.
  const organization = await api.get(`/accounts/${account}/access/organizations`, { missing: true });
  const providers = organization ? await api.list(`/accounts/${account}/access/identity_providers`) : [];
  if (!state.providerId && providers.length) state.providerId = await ask.select({
    message: "열람자가 사용할 로그인 방법", choices: providers.map((item) => ({ name: item.name, value: item.id })),
  });
  log(`계정: ${account}\n사이트: ${state.project}\n열람자: ${state.emails.join(", ")}\n로그인: ${state.providerId ? "선택한 기존 로그인" : "이메일 일회용 코드 (계정에 로그인 방법 추가)"}\n문서 폴더: ${config.tabs.map((tab) => tab.dir).join(", ")}`);
  if (!await ask.confirm({ message: "이 설정으로 접근 제한을 준비하고 문서를 배포할까요?", default: true }))
    throw new Error("배포를 취소했습니다. 문서는 업로드하지 않았습니다.");
  await saveDeploymentState(config.root, state);
  const settings = await provision(config, state, api, log);
  return { config: { ...config, deploymentState: state, deploy: settings }, env: credentials };
}
