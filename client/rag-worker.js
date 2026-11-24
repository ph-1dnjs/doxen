import { pipeline, env } from "@huggingface/transformers";
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { chunksForSite, rankChunks, prepareSearch, prepareVectorIndex, selectCandidates, expandContext, answerSystemPrompt, verifyAnswer, verificationPrompt, parseVerification, formatContext, fitContext, byteTokenBound } from "./rag.js";

// Models run in this worker; embeddings are cached by model and content.
env.allowLocalModels = false;
let chunks = [], searchIndex, vectors, site, initialization, embedder, engine;
const vectorCache = new Map();
let cacheDatabase;
async function openCache() {
  if (cacheDatabase !== undefined) return cacheDatabase;
  cacheDatabase = await new Promise((resolve) => {
    try {
      const request = indexedDB.open(`doxen-embeddings-v2:${new URL(self.location.href).pathname.replace(/[^/]+$/, "")}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("vectors");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return cacheDatabase;
}
async function vectorKey(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`Xenova/multilingual-e5-small:q8:passage: ${text}`));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function cachedVector(key, vector) {
  try {
    const db = await openCache();
    if (!db) return;
    return await new Promise((resolve) => {
      const transaction = db.transaction("vectors", vector ? "readwrite" : "readonly");
      const request = vector ? transaction.objectStore("vectors").put(vector, key) : transaction.objectStore("vectors").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      transaction.onabort = () => resolve(undefined);
    });
  } catch { /* Cache is optional. */ }
}
async function pruneVectors(keys) {
  try {
    const db = await openCache();
    if (!db) return;
    await new Promise((resolve) => {
      const transaction = db.transaction("vectors", "readwrite");
      const store = transaction.objectStore("vectors");
      const request = store.openKeyCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!keys.has(cursor.key)) { store.delete(cursor.key); vectorCache.delete(cursor.key); }
        cursor.continue();
      };
      transaction.oncomplete = transaction.onerror = transaction.onabort = () => resolve();
    });
  } catch { /* Cache is optional. */ }
}
const status = (message) => postMessage({ type: "status", message });

async function embed(text) {
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}

async function initialize(nextSite) {
  const initStarted = performance.now();
  site = nextSite;
  chunks = chunksForSite(site);
  searchIndex = prepareSearch(chunks);
  if (!chunks.length) { status("인덱스 준비 완료: 검색할 문서가 없습니다."); return; }
  try {
    status(`인덱스 준비 중: 0/${chunks.length}개 (0%). 준비가 끝나면 질문을 처리합니다.`);
    if (!embedder) embedder = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" });
    vectors = await prepareVectorIndex(chunks, {
      keyFor: vectorKey,
      read: async (key) => vectorCache.get(key) || await cachedVector(key),
      write: async (key, vector) => { vectorCache.set(key, vector); await cachedVector(key, vector); },
      embed,
      prune: pruneVectors,
      progress: (done, total) => status(`인덱스 준비 중: ${done}/${total}개 (${Math.floor(done * 100 / total)}%). 준비가 끝나면 질문을 처리합니다.`),
    });
    status(`인덱스 준비 완료: ${chunks.length}/${chunks.length}개 (100%, ${((performance.now() - initStarted) / 1000).toFixed(1)}초).`);
  } catch { embedder = undefined; vectors = undefined; status("의미 검색 인덱스를 준비하지 못해 키워드 검색을 사용합니다."); }
}

self.onmessage = async ({ data }) => {
  if (data.type === "init") { initialization = initialize(data.site); return; }
  if (data.type !== "ask") return;
  try {
    const started = performance.now();
    await initialization;
    if (!chunks.length) return postMessage({ type: "result", sources: [], answer: "검색할 문서가 없습니다." });
    const keywordStarted = performance.now();
    const candidates = vectors ? [] : selectCandidates(chunks, data.question);
    const keywordMs = performance.now() - keywordStarted;
    const semanticError = !vectors;
    let queryVector, embeddingMs = 0;
    if (vectors) {
      const embeddingStarted = performance.now();
      queryVector = await embed(`query: ${data.question}`);
      embeddingMs = performance.now() - embeddingStarted;
    }
    const rankTimings = {};
    const ranked = vectors ? rankChunks(chunks, data.question, vectors, queryVector, 5, searchIndex, rankTimings) : rankChunks(candidates, data.question, null, null, 5, undefined, rankTimings);
    const contextStarted = performance.now();
    const expanded = expandContext(chunks, ranked);
    if (!expanded.length) return postMessage({ type: "result", sources: [], answer: "관련 문서를 찾지 못했습니다. 다른 표현으로 질문해 주세요.", semanticError });
    if (site.assistant?.provider !== "workers-ai-free") {
      if (!navigator.gpu) return postMessage({ type: "result", sources: [], answer: "이 브라우저에서는 기기 내 답변을 생성할 수 없습니다.", semanticError });
      if (!engine) {
        status("답변 모델을 준비하고 있습니다. 처음에는 모델 다운로드가 필요합니다.");
        try {
          engine = await CreateMLCEngine("Qwen2.5-0.5B-Instruct-q4f16_1-MLC", { initProgressCallback: (report) => status(report.text) });
        } catch {
          return postMessage({ type: "result", sources: [], answer: "답변 모델을 실행하지 못했습니다.", semanticError });
        }
      }
    }
    const sources = await fitContext(expanded, data.question, site.assistant?.provider === "workers-ai-free" ? byteTokenBound : async (text) => (await engine.tokenize(text)).length, site.assistant?.provider === "workers-ai-free" ? 32768 : 4096);
    const truncated = sources.length < expanded.length;
    const contextMs = performance.now() - contextStarted;
    const searchMs = Math.round(performance.now() - started);
    const generationStarted = performance.now();
    if (!sources.length) return postMessage({ type: "result", sources: [], answer: "관련 문서를 찾지 못했습니다. 다른 표현으로 질문해 주세요.", semanticError });
    if (site.assistant?.provider === "workers-ai-free") {
      status("문서를 바탕으로 답변을 작성하고 있습니다.");
      try {
        const response = await fetch(new URL("./__doxen/assistant", self.location.href), {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: data.question, sources: sources.map((source) => ({ index: chunks.indexOf(source), text: source.text })) }),
        });
        if (!response.ok) {
          const detail = await response.text();
          return postMessage({ type: "result", sources: [], answer: detail || "AI 답변을 생성하지 못했습니다.", semanticError });
        }
        const { answer, evidence, timings: serverTimings } = await response.json();
        if (!Array.isArray(evidence) || !evidence.length || evidence.some(({ number, evidence: quotes }) => !Array.isArray(quotes) || !quotes.length || quotes.some((quote) => typeof quote !== "string" || !quote || !sources[number - 1]?.text.includes(quote)))) throw new Error("출처를 확인할 수 없습니다.");
        const cited = evidence.map(({ number, evidence: quotes }) => ({ ...sources[number - 1], number, evidence: quotes }));
        return postMessage({ type: "result", sources: cited, answer: answer + (truncated ? "\n일부 관련 문서는 입력 길이 제한으로 제외되어 추가 확인이 필요합니다." : ""), semanticError, timings: { searchMs, keywordMs: keywordMs + rankTimings.keywordMs, embeddingMs, vectorMs: rankTimings.vectorMs, rerankMs: rankTimings.rerankMs, contextMs, generationMs: serverTimings?.generationMs, verificationMs: serverTimings?.verificationMs, totalMs: Math.round(performance.now() - started) } });
      } catch {
        return postMessage({ type: "result", sources: [], answer: "문서 도우미 서버에 연결하지 못했거나 출처를 확인하지 못했습니다.", semanticError });
      }
    }
    try {
      status("문서를 바탕으로 답변을 작성하고 있습니다.");
      const context = formatContext(sources);
      const response = await engine.chat.completions.create({ messages: [
        { role: "system", content: answerSystemPrompt },
        { role: "user", content: `참고 자료:\n${context}\n\n질문: ${data.question}` },
      ], max_tokens: 768, temperature: 0.1 });
      const answer = response.choices[0]?.message?.content?.trim();
      const generationMs = performance.now() - generationStarted;
      const verificationStarted = performance.now();
      status("답변의 문서 근거를 확인하고 있습니다.");
      const checked = await verifyAnswer(answer, sources, async (claim, source) => {
        const verifyInput = `주장: ${claim}\n문서 근거: ${source.text}`;
        if ((await engine.tokenize(`${verificationPrompt}\n${verifyInput}`)).length + 350 + 128 > 4096) return null;
        const response = await engine.chat.completions.create({ messages: [
          { role: "system", content: verificationPrompt },
          { role: "user", content: verifyInput },
        ], max_tokens: 350, temperature: 0 });
        return parseVerification(response.choices[0]?.message?.content || "");
      });
      if (!checked) throw new Error("근거를 확인할 수 없습니다.");
      postMessage({ type: "result", ...checked, answer: checked.answer + (truncated ? "\n일부 관련 문서는 입력 길이 제한으로 제외되어 추가 확인이 필요합니다." : ""), semanticError, timings: { searchMs, keywordMs: keywordMs + rankTimings.keywordMs, embeddingMs, vectorMs: rankTimings.vectorMs, rerankMs: rankTimings.rerankMs, contextMs, generationMs, verificationMs: performance.now() - verificationStarted, totalMs: Math.round(performance.now() - started) } });
    } catch {
      engine = undefined;
      postMessage({ type: "result", sources: [], answer: "출처가 있는 답변을 생성하지 못했습니다. 다시 시도해 주세요.", semanticError });
    }
  } catch {
    postMessage({ type: "error", message: "문서 검색에 실패했습니다. 다시 시도해 주세요." });
  }
};
