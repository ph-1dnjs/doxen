import { createRemoteJWKSet, jwtVerify } from "jose";

export function accessWorker(access, keys = createRemoteJWKSet(
  new URL(`${access.teamDomain}/cdn-cgi/access/certs`),
)) {
  const emails = new Set(access.emails.map((email) => email.toLowerCase()));
  return {
    async fetch(request, env) {
      const denied = () => new Response("업무 사용자 인증이 필요합니다.", {
        status: 403,
        headers: { "Cache-Control": "private, no-store" },
      });
      const token = request.headers.get("cf-access-jwt-assertion");
      if (!token) return denied();
      let email;
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: access.teamDomain,
          audience: access.audiences,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "email"],
        });
        if (typeof payload.email !== "string" || !emails.has(payload.email.toLowerCase()))
          return denied();
        email = payload.email.toLowerCase();
      } catch {
        return denied();
      }
      const url = new URL(request.url);
      if (url.pathname === "/__doxen/comments") {
        const headers = { "Cache-Control": "private, no-store" };
        if (!env.COMMENTS_DB) return new Response("댓글 저장소가 설정되지 않았습니다.", { status: 503, headers });
        if (request.method === "GET") {
          const document = url.searchParams.get("document");
          if (!document || document.length > 500) return new Response("잘못된 문서", { status: 400, headers });
          const rows = await env.COMMENTS_DB.prepare("SELECT id, block, quote, body, author, created_at FROM comments WHERE document = ? ORDER BY created_at, id").bind(document).all();
          return Response.json(rows.results, { headers });
        }
        if (request.method === "POST") {
          if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json"))
            return new Response("잘못된 요청", { status: 403, headers });
          let data;
          try { data = await request.json(); } catch { return new Response("잘못된 요청", { status: 400, headers }); }
          if (![data?.document, data?.block, data?.quote, data?.body].every((value) => typeof value === "string") ||
              !data.document || data.document.length > 500 || !data.block || data.block.length > 10000 ||
              data.quote.length > 2000 || !data.body.trim() || data.body.length > 5000)
            return new Response("잘못된 댓글", { status: 400, headers });
          const row = { id: crypto.randomUUID(), block: data.block, quote: data.quote, body: data.body.trim(), author: email, created_at: new Date().toISOString() };
          await env.COMMENTS_DB.prepare("INSERT INTO comments (id, document, block, quote, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(row.id, data.document, row.block, row.quote, row.body, row.author, row.created_at).run();
          return Response.json(row, { status: 201, headers });
        }
        return new Response("허용되지 않는 요청", { status: 405, headers });
      }
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  };
}
