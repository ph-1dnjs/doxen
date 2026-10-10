export function cloudflare(token, fetcher = fetch) {
  async function request(route, { method = "GET", body, missing = false } = {}) {
    let response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4${route}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("Cloudflare 연결에 실패했습니다. 네트워크를 확인한 뒤 같은 명령을 다시 실행하세요.");
    }
    if (missing && response.status === 404) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      const hint = response.status === 401 || response.status === 403
        ? "토큰의 유효 기간과 계정 권한을 확인하세요."
        : "Cloudflare 대시보드에서 계정의 Zero Trust 시작 설정과 프로젝트 상태를 확인하세요.";
      // Do not echo API bodies: they can contain credentials or submitted values.
      const error = new Error(`Cloudflare 요청 실패 (HTTP ${response.status}, ${method} ${route.split("?")[0]}). ${hint}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }
  return {
    async get(route, options) { return (await request(route, options))?.result ?? null; },
    async send(route, method, body) { return (await request(route, { method, body })).result; },
    async list(route) {
      const result = [];
      for (let page = 1; ; page++) {
        const data = await request(`${route}?page=${page}&per_page=50`);
        if (!Array.isArray(data.result)) throw new Error("Cloudflare 목록 응답을 확인할 수 없습니다.");
        result.push(...data.result);
        if (data.result.length < 50 || page >= data.result_info?.total_pages) return result;
      }
    },
  };
}
