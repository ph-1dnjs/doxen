import { test } from "node:test";
import assert from "node:assert/strict";
import { chunksForSite, rankChunks } from "../client/rag.js";

test("RAG includes home and document sections with working encoded anchors", () => {
  const site = { home: { id: "__home", title: "홈", sections: [{ title: "소개", anchor: "", text: "홈 본문" }] }, documents: [
    { id: "가이드/설치", title: "설치", sections: [{ title: "시작 하기", anchor: "시작-하기", text: "설치 안내" }] },
    { id: "sheet", spreadsheet: {}, sections: [] },
  ] };
  const chunks = chunksForSite(site);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].href, "#/%EA%B0%80%EC%9D%B4%EB%93%9C%2F%EC%84%A4%EC%B9%98/%EC%8B%9C%EC%9E%91-%ED%95%98%EA%B8%B0");
});

test("hybrid retrieval combines semantic and lexical matches and handles no result", () => {
  const chunks = [{ title: "계정", heading: "접근", text: "열람자 추가" }, { title: "설정", heading: "배포", text: "배포 명령" }];
  assert.equal(rankChunks(chunks, "새 팀원 권한", [[1, 0], [0, 1]], [1, 0])[0], chunks[0]);
  assert.equal(rankChunks(chunks, "배포", null, null)[0], chunks[1]);
  assert.deepEqual(rankChunks(chunks, "관련없음", null, null), []);
});
