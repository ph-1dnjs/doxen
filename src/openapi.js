import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function syncOpenApi(config, values = {}) {
  if (!config.api) throw new Error("docs.config에 api 설정을 추가하세요.");
  const sourceUrl = (values.url || process.env.OPENAPI_URL || "").trim();
  let raw;
  if (values.file) {
    raw = await readFile(values.file, "utf8");
  } else {
    if (!sourceUrl) throw new Error("OPENAPI_URL 환경 변수를 설정하거나 --url 옵션으로 명세 주소를 지정하세요.");
    const url = new URL(sourceUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      throw new Error("인증 정보가 포함되지 않은 HTTP(S) 명세 주소를 지정하세요.");
    }
    const headers = { Accept: "application/json" };
    const user = process.env.OPENAPI_BASIC_USER;
    const password = process.env.OPENAPI_BASIC_PASSWORD;
    if (user || password) {
      if (!user || !password) throw new Error("문서 인증 계정과 비밀번호를 모두 설정하세요.");
      headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    }
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response;
      let failure;
      try {
        response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(30000) });
        if (response.ok) {
          raw = await response.text();
          break;
        }
      } catch {
        failure = "네트워크 오류 또는 응답 시간 초과";
      }
      if (!failure) {
        failure = `HTTP ${response.status}`;
        await response.body?.cancel();
        if (![408, 429].includes(response.status) && response.status < 500) {
          throw new Error(`OpenAPI 다운로드 실패: ${failure}. 명세 주소와 인증 설정을 확인하세요.`);
        }
      }
      if (attempt === maxAttempts) {
        throw new Error(`OpenAPI 다운로드 실패: ${failure}. ${maxAttempts}회 시도 후 중단합니다. 기존 명세를 유지합니다.`);
      }
      const waitMs = attempt * 5000;
      console.warn(`OpenAPI 다운로드 실패: ${failure}. ${waitMs / 1000}초 후 재시도합니다 (${attempt + 1}/${maxAttempts}).`);
      await delay(waitMs);
    }
  }
  const spec = JSON.parse(raw);
  if (!/^3\./.test(spec.openapi) || !spec.info || !spec.paths || !Object.keys(spec.paths).length) {
    throw new Error("HTTP 경로가 포함된 OpenAPI 3 JSON 파일이 필요합니다. 기존 명세를 유지합니다.");
  }
  const metadata = {
    available: true,
    status: "ready",
    source: values.file ? "file" : "server",
    sourceUrl: values.file ? null : new URL(sourceUrl).origin + new URL(sourceUrl).pathname,
    importedAt: new Date().toISOString(),
    revision: process.env.OPENAPI_REVISION || null,
    note: values.file ? "파일에서 가져온 명세. 생성 환경과 코드 버전은 제공자가 확인한다." : "개발 서버에서 가져온 명세. 로컬 브랜치와 배포 버전은 다를 수 있다.",
  };
  const specPath = config.api.spec;
  const metaPath = config.api.metadata;
  const specTmp = specPath + ".tmp";
  const metaTmp = metaPath + ".tmp";
  try {
    await writeFile(specTmp, JSON.stringify(spec, null, 2) + "\n");
    await writeFile(metaTmp, JSON.stringify(metadata, null, 2) + "\n");
    await rename(specTmp, specPath);
    await rename(metaTmp, metaPath);
  } finally {
    await rm(specTmp, { force: true });
    await rm(metaTmp, { force: true });
  }
  console.log(`OpenAPI 갱신: ${Object.keys(spec.paths).length}개 경로`);

}
