import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { build } from "./build.js";

export function validateDeployment(deploy) {
  if (!deploy || typeof deploy !== "object")
    throw new Error("deploy 설정이 필요합니다. README의 비공개 배포 설정을 확인하세요.");
  if (typeof deploy.project !== "string" || !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(deploy.project))
    throw new Error("deploy.project에 Cloudflare Pages 프로젝트 이름을 설정하세요.");
  const access = deploy.access;
  if (!access || typeof access.teamDomain !== "string" ||
      !/^https:\/\/[a-z0-9][a-z0-9-]*\.cloudflareaccess\.com$/.test(access.teamDomain))
    throw new Error("deploy.access.teamDomain은 https://팀이름.cloudflareaccess.com 형식이어야 합니다.");
  if (!Array.isArray(access.audiences) || !access.audiences.length ||
      access.audiences.some((value) => typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)))
    throw new Error("deploy.access.audiences에 Access 애플리케이션의 AUD를 설정하세요.");
  if (!Array.isArray(access.emails) || !access.emails.length ||
      access.emails.some((value) => typeof value !== "string" || !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(value)))
    throw new Error("deploy.access.emails에 허용할 이메일 주소를 하나 이상 설정하세요.");
  return {
    project: deploy.project,
    access: { teamDomain: access.teamDomain, audiences: access.audiences, emails: access.emails },
  };
}

export async function protectedFiles(deploy) {
  const { access } = validateDeployment(deploy);
  const result = await bundle({
    stdin: {
      contents: `import { accessWorker } from './access-worker.js';\nexport default accessWorker(${JSON.stringify(access)});`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
  });
  return new Map([
    ["/_worker.js", Buffer.from(result.outputFiles[0].contents)],
    ["/_routes.json", Buffer.from(JSON.stringify({ version: 1, include: ["/*"], exclude: [] }))],
  ]);
}

export async function checkProject(deploy, env = process.env, fetcher = fetch) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  const token = env.CLOUDFLARE_API_TOKEN;
  if (!account || !/^[a-f0-9]{32}$/i.test(account) || !token)
    throw new Error("CLOUDFLARE_ACCOUNT_ID와 CLOUDFLARE_API_TOKEN 환경 변수를 설정하세요. 토큰에는 해당 계정의 Cloudflare Pages Edit 권한이 필요합니다.");
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${deploy.project}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) throw new Error(`Pages 프로젝트 확인 실패 (HTTP ${response.status}). 계정, 토큰, 기존 프로젝트 이름을 확인하세요.`);
  const data = await response.json();
  if (!data.success || !data.result?.production_branch)
    throw new Error("Pages 프로젝트 정보를 확인할 수 없습니다.");
  for (const name of ["production", "preview"]) {
    if (data.result.deployment_configs?.[name]?.fail_open !== false)
      throw new Error(`Pages ${name}의 Functions 설정을 Fail closed로 변경한 후 다시 배포하세요. 인증 없이 정적 파일을 제공하는 Fail open 설정에서는 배포하지 않습니다.`);
  }
  return data.result;
}

export function resolveWrangler(root) {
  let packageFile;
  try {
    packageFile = createRequire(path.join(root, "package.json")).resolve("wrangler/package.json");
  } catch {
    packageFile = createRequire(import.meta.url).resolve("wrangler/package.json");
  }
  return path.join(path.dirname(packageFile), "bin", "wrangler.js");
}

export async function deploy(config, options) {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw new Error("자동 배포에는 Node.js 22 이상이 필요합니다. Node.js를 업데이트한 뒤 다시 실행하세요.");
  const { prepareDeployment } = await import("./deploy-setup.js");
  const prepared = await prepareDeployment(config, options);
  config = prepared.config;
  const settings = validateDeployment(config.deploy);
  const wrangler = resolveWrangler(config.root);
  const project = await checkProject(settings, prepared.env);
  const out = await build(config);
  // Isolate Wrangler from unrelated project config, functions and redirects.
  const temporary = await mkdtemp(path.join(tmpdir(), "doxen-deploy-"));
  try {
    await writeFile(path.join(temporary, "wrangler.json"), JSON.stringify({
      name: settings.project,
      pages_build_output_dir: out,
      compatibility_date: "2026-10-08",
    }));
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [wrangler, "pages", "deploy", out,
        "--project-name", settings.project, "--branch", project.production_branch], {
        cwd: temporary, stdio: "inherit", shell: false, env: prepared.env,
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? resolve() :
        reject(new Error(`배포 실패: ${signal || `종료 코드 ${code}`}`)));
    });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log(`배포 완료: https://${project.subdomain || `${settings.project}.pages.dev`} (허용 계정으로 접근을 확인하세요.)`);
}
