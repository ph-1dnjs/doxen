import { readFile, writeFile, mkdir, rename, rm, lstat, chmod } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export const credentialsDirectory = path.join(homedir(), ".config", "doxen", "accounts");
export const statePath = (root) => path.join(root, ".doxen-deploy.json");

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`${file} 파일을 읽을 수 없습니다. 내용을 확인하세요.`);
  }
}

export async function readDeploymentState(root, file) {
  const state = await readJson(statePath(root));
  if (!state) return null;
  if (state.version !== 1 || state.configFile !== path.basename(file) ||
      !/^[a-f0-9]{32}$/i.test(state.accountId) || typeof state.ready !== "boolean" ||
      typeof state.project !== "string" || !/^[a-z0-9][a-z0-9-]{0,57}[a-z0-9]$/.test(state.project) ||
      !Array.isArray(state.emails) || !state.emails.length ||
      state.emails.some((email) => typeof email !== "string" || !/^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/.test(email)) ||
      !state.apps || typeof state.apps !== "object" || Array.isArray(state.apps))
    throw new Error(".doxen-deploy.json이 현재 문서 설정과 맞지 않습니다. 배포 상태 파일을 확인하세요.");
  return state;
}

async function atomicJson(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

export async function saveDeploymentState(root, state) {
  await atomicJson(statePath(root), state);
}

function credentialPath(account, directory) {
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("Cloudflare 계정 ID가 올바르지 않습니다.");
  return path.join(directory, `${account}.json`);
}

export async function readToken(account, directory = credentialsDirectory) {
  const file = credentialPath(account, directory);
  const info = await lstat(file).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077)))
    throw new Error("저장된 배포 토큰 파일의 접근 권한이 안전하지 않습니다. 소유자만 읽을 수 있도록 변경하세요.");
  const saved = await readJson(file);
  return typeof saved?.token === "string" ? saved.token : null;
}

export async function saveToken(account, token, directory = credentialsDirectory) {
  const file = credentialPath(account, directory);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("토큰 저장 경로는 일반 디렉터리여야 합니다.");
  await chmod(directory, 0o700);
  await atomicJson(file, { token });
}

export function deploymentFromState(state) {
  if (!state?.ready) return undefined;
  return {
    project: state.project,
    access: { teamDomain: state.teamDomain, audiences: Object.values(state.apps).map((app) => app.aud), emails: state.emails },
  };
}
