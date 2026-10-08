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
      try {
        const { payload } = await jwtVerify(token, keys, {
          issuer: access.teamDomain,
          audience: access.audiences,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "email"],
        });
        if (typeof payload.email !== "string" || !emails.has(payload.email.toLowerCase()))
          return denied();
      } catch {
        return denied();
      }
      const asset = await env.ASSETS.fetch(request);
      const response = new Response(asset.body, asset);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  };
}
