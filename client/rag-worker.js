import { pipeline, env } from "@huggingface/transformers";
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { chunksForSite, rankChunks, selectCandidates, expandContext, answerSystemPrompt, verifyAnswer, verificationPrompt, parseVerification } from "./rag.js";

// Models run in this worker; embeddings are cached by model and content.
env.allowLocalModels = false;
let chunks = [], embedder, engine;
const vectorCache = new Map();
let cacheDatabase;
async function openCache() {
  if (cacheDatabase !== undefined) return cacheDatabase;
  cacheDatabase = await new Promise((resolve) => {
    try {
      const request = indexedDB.open("doxen-embeddings-v1", 1);
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
const status = (message) => postMessage({ type: "status", message });

async function embed(text) {
  const result = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}

self.onmessage = async ({ data }) => {
  if (data.type !== "ask") return;
  try {
    const started = performance.now();
    chunks = chunksForSite(data.site);
    if (!chunks.length) return postMessage({ type: "result", sources: [], answer: "검색할 문서가 없습니다." });
    const candidates = selectCandidates(chunks, data.question);
    let semanticError = false, vectors, queryVector;
    try {
      if (!embedder) {
        status("의미 검색 모델을 준비하고 있습니다. 처음에는 다운로드가 필요합니다.");
        embedder = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" });
      }
      const next = [];
      for (let i = 0; i < chunks.length; i++) {
        const candidate = chunks[i];
        const passage = `${candidate.title} ${candidate.heading} ${candidate.text}`;
        const key = await vectorKey(passage);
        let vector = vectorCache.get(key) || await cachedVector(key);
        if (!vector) {
          if (i % 5 === 0) status(`관련 문서를 분석하고 있습니다 (${i + 1}/${chunks.length}).`);
          vector = await embed(`passage: ${passage}`);
          await cachedVector(key, vector);
          vectorCache.set(key, vector);
        }
        next.push(vector);
      }
      vectors = next;
      queryVector = await embed(`query: ${data.question}`);
    } catch (error) {
      semanticError = true;
      embedder = undefined;
      vectors = undefined;
    }
    const ranked = vectors ? rankChunks(chunks, data.question, vectors, queryVector, 5) : rankChunks(candidates, data.question, null, null, 5);
    const sources = expandContext(chunks, ranked);
    const searchMs = Math.round(performance.now() - started);
    const generationStarted = performance.now();
    if (!sources.length) return postMessage({ type: "result", sources: [], answer: "관련 문서를 찾지 못했습니다. 다른 표현으로 질문해 주세요.", semanticError });
    if (data.site.assistant?.provider === "workers-ai-free") {
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
        const { answer, evidence } = await response.json();
        if (!Array.isArray(evidence) || !evidence.length || evidence.some(({ number, evidence: quotes }) => !Array.isArray(quotes) || !quotes.length || quotes.some((quote) => typeof quote !== "string" || !quote || !sources[number - 1]?.text.includes(quote)))) throw new Error("출처를 확인할 수 없습니다.");
        const cited = evidence.map(({ number, evidence: quotes }) => ({ ...sources[number - 1], number, evidence: quotes }));
        return postMessage({ type: "result", sources: cited, answer, semanticError, timings: { searchMs, generationMs: Math.round(performance.now() - generationStarted) } });
      } catch {
        return postMessage({ type: "result", sources: [], answer: "문서 도우미 서버에 연결하지 못했거나 출처를 확인하지 못했습니다.", semanticError });
      }
    }
    if (!navigator.gpu) return postMessage({ type: "result", sources: [], answer: "이 브라우저에서는 기기 내 답변을 생성할 수 없습니다.", semanticError });
    try {
      if (!engine) {
        status("답변 모델을 준비하고 있습니다. 처음에는 모델 다운로드가 필요합니다.");
        engine = await CreateMLCEngine("Qwen2.5-0.5B-Instruct-q4f16_1-MLC", { initProgressCallback: (report) => status(report.text) });
      }
      status("문서를 바탕으로 답변을 작성하고 있습니다.");
      const context = sources.map((source, index) => `[${index + 1}] ${source.title} / ${source.heading} (${source.documentType}, 수정일 ${source.modified || "미상"})\n${source.text}`).join("\n\n");
      const response = await engine.chat.completions.create({ messages: [
        { role: "system", content: answerSystemPrompt },
        { role: "user", content: `참고 자료:\n${context}\n\n질문: ${data.question}` },
      ], max_tokens: 768, temperature: 0.1 });
      const answer = response.choices[0]?.message?.content?.trim();
      status("답변의 문서 근거를 확인하고 있습니다.");
      const checked = await verifyAnswer(answer, sources, async (claim, source) => {
        const response = await engine.chat.completions.create({ messages: [
          { role: "system", content: verificationPrompt },
          { role: "user", content: `주장: ${claim}\n문서 근거: ${source.text}` },
        ], max_tokens: 350, temperature: 0 });
        return parseVerification(response.choices[0]?.message?.content || "");
      });
      if (!checked) throw new Error("근거를 확인할 수 없습니다.");
      postMessage({ type: "result", ...checked, semanticError, timings: { searchMs, generationMs: Math.round(performance.now() - generationStarted) } });
    } catch {
      engine = undefined;
      postMessage({ type: "result", sources: [], answer: "출처가 있는 답변을 생성하지 못했습니다. 다시 시도해 주세요.", semanticError });
    }
  } catch {
    postMessage({ type: "error", message: "문서 검색에 실패했습니다. 다시 시도해 주세요." });
  }
};
