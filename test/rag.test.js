import { test } from "node:test";
import assert from "node:assert/strict";
import { chunksForSite, rankChunks, selectCandidates, expandContext, citedSources, verifyAnswer } from "../client/rag.js";

test("RAG includes home and document sections with working encoded anchors", () => {
  const site = { home: { id: "__home", title: "홈", sections: [{ title: "소개", anchor: "", text: "홈 본문" }] }, documents: [
    { id: "가이드/설치", title: "설치", sections: [{ title: "시작 하기", anchor: "시작-하기", text: "설치 안내" }] },
    { id: "sheet", spreadsheet: {}, sections: [] },
  ] };
  const chunks = chunksForSite(site);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].href, "#/%EA%B0%80%EC%9D%B4%EB%93%9C%2F%EC%84%A4%EC%B9%98/%EC%8B%9C%EC%9E%91-%ED%95%98%EA%B8%B0");
});

test("retrieval narrows a large corpus and matches Korean spacing variants", () => {
  const chunks = Array.from({ length: 4436 }, (_, i) => ({ title: `문서 ${i}`, heading: "일반 안내", text: "관계없는 내용" }));
  chunks[3123] = { title: "본인 인증 정책", heading: "인증 번호 발송", text: "문자 발송 제한과 재전송 정책" };
  const candidates = selectCandidates(chunks, "본인인증 인증번호 발송 케이스 정책");
  assert.ok(candidates.length <= 24);
  assert.equal(candidates[0], chunks[3123]);
  assert.deepEqual(selectCandidates(chunks, ""), []);
});

test("hybrid retrieval combines semantic and lexical matches and handles no result", () => {
  const chunks = [{ title: "계정", heading: "접근", text: "열람자 추가" }, { title: "설정", heading: "배포", text: "배포 명령" }];
  assert.equal(rankChunks(chunks, "새 팀원 권한", [[1, 0], [0, 1]], [1, 0])[0], chunks[0]);
  assert.equal(rankChunks(chunks, "배포", null, null)[0], chunks[1]);
  assert.deepEqual(rankChunks(chunks, "관련없음", null, null), []);
});


test("context expansion preserves anchors, adds parent and adjacent pieces, and deduplicates", () => {
  const chunks = chunksForSite({ documents: [{ id: "policy", title: "정책", toc: [
    { anchor: "parent", level: 1 }, { anchor: "child", level: 2 },
  ], sections: [
    { anchor: "parent", title: "공통", text: "공통 조건" },
    { anchor: "child", title: "발송", text: "가".repeat(1500) },
  ] }] });
  const expanded = expandContext(chunks, [chunks[1], chunks[1]]);
  assert.deepEqual(expanded, [chunks[1], chunks[0], chunks[2]]);
  assert.equal(expanded[1].href, "#/policy/parent");
});

test("citations retain original numbers and reject nonexistent references", () => {
  const sources = [{ title: "첫 문서" }, { title: "둘째 문서" }];
  assert.deepEqual(citedSources("답변 [2]", sources), [{ title: "둘째 문서", number: 2 }]);
  assert.equal(citedSources("답변 [3]", sources), null);
  assert.equal(citedSources("근거 없는 답변", sources), null);
});


test("claim verification rejects invented numbers, unquoted evidence and missing citations", async () => {
  const sources = [{ text: "비밀번호 변경 주기는 90일입니다." }];
  const verify = async () => ({ supported: true, evidence: "변경 주기는 90일입니다." });
  const checked = await verifyAnswer("변경 주기는 90일입니다. [1]\n7일 전에 알립니다. [1]\n근거 없는 설명입니다.", sources, verify);
  assert.match(checked.answer, /변경 주기는 90일/);
  assert.doesNotMatch(checked.answer, /7일 전에/);
  assert.match(checked.answer, /제외/);
  assert.equal(await verifyAnswer("변경 주기는 90일입니다. [1]", sources, async () => ({ supported: true, evidence: "없는 문구" })), null);
  assert.equal(await verifyAnswer("변경 주기는 90일입니다. [1]", sources, async () => { throw Error("offline"); }), null);
});

test("a citation verified for one claim cannot validate another claim", async () => {
  const sources = [{ text: "정책 하나" }, { text: "정책 둘" }];
  const checked = await verifyAnswer("정책 하나 [1]\n정책 둘 [1] [2]", sources, async (claim, source) => ({ supported: source.text === claim, evidence: source.text }));
  assert.match(checked.answer, /정책 둘 \[2\]/);
  assert.doesNotMatch(checked.answer, /정책 둘.*\[1\]/);
});
