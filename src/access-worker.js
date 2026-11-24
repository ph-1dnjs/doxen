import { createRemoteJWKSet, jwtVerify } from "jose";
import { answerSystemPrompt, verifyAnswer, verificationPrompt, parseVerification } from "../client/rag.js";

export function accessWorker(access, keys = createRemoteJWKSet(
  new URL(`${access.teamDomain}/cdn-cgi/access/certs`),
), workersAiFree = false) {
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
      if (url.pathname === "/__doxen/assistant") {
        const headers = { "Cache-Control": "private, no-store" };
        if (!workersAiFree || !env.AI) return new Response("문서 도우미 서버가 설정되지 않았습니다.", { status: 503, headers });
        if (request.method !== "POST" || request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json"))
          return new Response("잘못된 요청", { status: 403, headers });
        let data;
        try {
          const body = await request.text();
          if (body.length > 16000) return new Response("요청이 너무 깁니다.", { status: 413, headers });
          data = JSON.parse(body);
        } catch { return new Response("잘못된 요청", { status: 400, headers }); }
        if (typeof data?.question !== "string" || !data.question.trim() || data.question.length > 500 ||
            !Array.isArray(data.sources) || !data.sources.length || data.sources.length > 8 ||
            !data.sources.every((source) => Number.isSafeInteger(source?.index) && source.index >= 0 && typeof source.text === "string" && source.text.length <= 1100))
          return new Response("잘못된 요청", { status: 400, headers });
        const selected = await Promise.all(data.sources.map(async (source) => {
          const asset = await env.ASSETS.fetch(new Request(new URL(`/__doxen-chunks/${source.index}.json`, url)));
          return asset.ok ? asset.json() : null;
        }));
        if (data.sources.some((source, i) => !selected[i] || selected[i].text !== source.text)) return new Response("문서가 변경되었습니다. 새로고침해 주세요.", { status: 409, headers });
        const context = selected.map((chunk, i) => `[${i + 1}] ${chunk.title} / ${chunk.heading} (${chunk.documentType}, 수정일 ${chunk.modified || "미상"})\n${chunk.text}`).join("\n\n");
        try {
          const generationStarted = performance.now();
          const result = await env.AI.run("@cf/openai/gpt-oss-20b", { messages: [
            { role: "system", content: answerSystemPrompt },
            { role: "user", content: `참고 자료:\n${context}\n\n질문: ${data.question}` },
          ], max_tokens: 768 });
          const answer = typeof result?.response === "string" ? result.response.trim() : "";
          const generationMs = performance.now() - generationStarted;
          const verificationStarted = performance.now();
          const checked = await verifyAnswer(answer, selected, async (claim, source) => {
            const result = await env.AI.run("@cf/openai/gpt-oss-20b", { messages: [
              { role: "system", content: verificationPrompt },
              { role: "user", content: `주장: ${claim}\n문서 근거: ${source.text}` },
            ], max_tokens: 350 });
            return parseVerification(result?.response || "");
          });
          if (!checked) return new Response("문서에서 답변의 근거를 확인하지 못했습니다.", { status: 502, headers });
          return Response.json({ answer: checked.answer, evidence: checked.sources.map(({ number, evidence }) => ({ number, evidence })), timings: { generationMs, verificationMs: performance.now() - verificationStarted } }, { headers });
        } catch (error) {
          const code = Number(error?.code) || Number(String(error?.message || "").match(/\b3036\b/)?.[0]);
          if (code === 3036) return new Response("오늘의 무료 사용량을 모두 사용했습니다. 내일 오전 9시 이후 다시 시도해 주세요.", { status: 429, headers });
          return new Response("AI 답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.", { status: 503, headers });
        }
      }
      if (url.pathname === "/__doxen/comments") {
        const headers = { "Cache-Control": "private, no-store" };
        if (!env.COMMENTS_DB) return new Response("댓글 저장소가 설정되지 않았습니다.", { status: 503, headers });
        const ensureAvatars = async () => {
          await env.COMMENTS_DB.prepare("INSERT OR IGNORE INTO comment_avatars (email) SELECT value FROM json_each(?) AS e WHERE NOT EXISTS (SELECT 1 FROM comment_avatars a WHERE a.email = e.value) ORDER BY CAST(e.key AS INTEGER)").bind(JSON.stringify([...emails])).run();
          await env.COMMENTS_DB.prepare("INSERT OR IGNORE INTO comment_avatars (email) SELECT lower(c.author) FROM comments c WHERE NOT EXISTS (SELECT 1 FROM comment_avatars a WHERE a.email = lower(c.author)) GROUP BY lower(c.author) ORDER BY min(c.created_at), min(c.id)").run();
        };
        if (request.method === "GET") {
          const document = url.searchParams.get("document");
          if (!document || document.length > 500) return new Response("잘못된 문서", { status: 400, headers });
          await ensureAvatars();
          const me = await env.COMMENTS_DB.prepare("SELECT position - 1 AS avatar_index FROM comment_avatars WHERE email = ?").bind(email).first();
          headers["X-Doxen-Viewer"] = encodeURIComponent(email);
          headers["X-Doxen-Avatar-Index"] = String(me.avatar_index);
          const rows = await env.COMMENTS_DB.prepare("SELECT c.id, c.block, c.quote, c.body, c.author, c.created_at, a.position - 1 AS avatar_index, CASE WHEN r.block IS NULL THEN 0 ELSE 1 END AS resolved FROM comments c LEFT JOIN comment_avatars a ON a.email = lower(c.author) LEFT JOIN comment_resolutions r ON r.document = c.document AND r.block = c.block WHERE c.document = ? ORDER BY c.created_at, c.id").bind(document).all();
          return Response.json(rows.results.map((row) => ({ ...row, mine: row.author?.toLowerCase() === email })), { headers });
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
          await ensureAvatars();
          const avatar = await env.COMMENTS_DB.prepare("SELECT position - 1 AS avatar_index FROM comment_avatars WHERE email = ?").bind(email).first();
          const row = { avatar_index: avatar.avatar_index, id: crypto.randomUUID(), block: data.block, quote: data.quote, body: data.body.trim(), author: email, created_at: new Date().toISOString(), mine: true, resolved: 0 };
          await env.COMMENTS_DB.prepare("INSERT INTO comments (id, document, block, quote, body, author, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(row.id, data.document, row.block, row.quote, row.body, row.author, row.created_at).run();
          return Response.json(row, { status: 201, headers });
        }
        if (request.method === "DELETE" || request.method === "PATCH" || request.method === "PUT") {
          if (request.headers.get("origin") !== url.origin || !request.headers.get("content-type")?.startsWith("application/json"))
            return new Response("잘못된 요청", { status: 403, headers });
          let data;
          try { data = await request.json(); } catch { return new Response("잘못된 요청", { status: 400, headers }); }
          if (request.method === "PUT") {
            if (typeof data?.id !== "string" || !data.id || data.id.length > 100 || typeof data.body !== "string" || !data.body.trim() || data.body.length > 5000)
              return new Response("잘못된 댓글", { status: 400, headers });
            const updated = await env.COMMENTS_DB.prepare("UPDATE comments SET body = ? WHERE id = ? AND author = ? RETURNING id").bind(data.body.trim(), data.id, email).first();
            return new Response(null, { status: updated ? 204 : 404, headers });
          }
          if (request.method === "DELETE") {
            if (typeof data?.id !== "string" || !data.id || data.id.length > 100) return new Response("잘못된 댓글", { status: 400, headers });
            const deleted = await env.COMMENTS_DB.prepare("DELETE FROM comments WHERE id = ? AND author = ? RETURNING document, block").bind(data.id, email).first();
            if (!deleted) return new Response(null, { status: 404, headers });
            await env.COMMENTS_DB.prepare("DELETE FROM comment_resolutions WHERE document = ? AND block = ? AND NOT EXISTS (SELECT 1 FROM comments WHERE document = ? AND block = ?)").bind(deleted.document, deleted.block, deleted.document, deleted.block).run();
            return new Response(null, { status: 204, headers });
          }
          if (typeof data?.document !== "string" || !data.document || data.document.length > 500 || typeof data.block !== "string" || !data.block || data.block.length > 10000 || typeof data.resolved !== "boolean")
            return new Response("잘못된 요청", { status: 400, headers });
          if (data.resolved) await env.COMMENTS_DB.prepare("INSERT INTO comment_resolutions (document, block) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM comments WHERE document = ? AND block = ?) ON CONFLICT DO NOTHING").bind(data.document, data.block, data.document, data.block).run();
          else await env.COMMENTS_DB.prepare("DELETE FROM comment_resolutions WHERE document = ? AND block = ?").bind(data.document, data.block).run();
          return new Response(null, { status: 204, headers });
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
