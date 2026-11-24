const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("ko");

// Narrow the expensive embedding work to a small set using Korean syllable pairs
// and whole words. A query without shared terms deliberately returns no result.
export function selectCandidates(chunks, question, limit = 24) {
  const words = [...new Set(normalize(question).match(/[\p{L}\p{N}_-]{2,}/gu) || [])].slice(0, 24);
  const terms = [...new Set(words.flatMap((word) => {
    const chars = Array.from(word);
    return chars.length > 2 ? [word, ...chars.slice(0, -1).map((_, i) => chars.slice(i, i + 2).join(""))] : [word];
  }))].slice(0, 80);
  if (!terms.length) return [];
  const frequency = new Array(terms.length).fill(0);
  const hits = chunks.map((chunk, index) => {
    const title = normalize(`${chunk.title} ${chunk.heading}`).replace(/\s+/g, "");
    const body = normalize(chunk.text).replace(/\s+/g, "");
    const found = [];
    terms.forEach((term, i) => {
      const titleMatch = title.includes(term);
      if (titleMatch || body.includes(term)) { frequency[i]++; found.push([i, titleMatch]); }
    });
    return { index, found };
  });
  return hits.filter((item) => item.found.length).map((item) => ({
    index: item.index,
    score: item.found.reduce((sum, [i, title]) => sum + Math.log(1 + chunks.length / frequency[i]) * (title ? 3 : 1) * (words.includes(terms[i]) ? 2 : 1), 0),
  })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(({ index }) => chunks[index]);
}

// Keep heading anchors intact while limiting how much text reaches the model.
export function chunksForSite(site) {
  const documents = [...(site.home ? [site.home] : []), ...site.documents];
  return documents.filter((doc) => !doc.spreadsheet).flatMap((doc) =>
    (doc.sections || []).flatMap((section) => {
      const text = section.text.trim();
      if (!text) return [];
      const pieces = text.match(/[\s\S]{1,1000}(?:\s|$)|[\s\S]{1,1000}/g) || [];
      return pieces.map((part) => ({ title: doc.title, heading: section.title, text: part.trim(),
        href: `#/${encodeURIComponent(doc.id)}${section.anchor ? `/${encodeURIComponent(section.anchor)}` : ""}` }));
    }),
  );
}

export function rankChunks(chunks, question, vectors, queryVector, limit = 5) {
  const words = [...new Set(normalize(question).match(/[\p{L}\p{N}_-]{2,}/gu) || [])];
  const scores = chunks.map((chunk, index) => {
    const title = normalize(`${chunk.title} ${chunk.heading}`);
    const text = normalize(chunk.text);
    const lexical = words.reduce((score, word) => score + (title.includes(word) ? 3 : 0) + (text.includes(word) ? 1 : 0), 0);
    const semantic = vectors && queryVector ? vectors[index].reduce((sum, value, i) => sum + value * queryVector[i], 0) : 0;
    return { chunk, lexical, semantic, index };
  });
  const lexical = scores.filter((item) => item.lexical > 0).sort((a, b) => b.lexical - a.lexical);
  const semantic = vectors ? [...scores].filter((item) => item.semantic >= 0.72).sort((a, b) => b.semantic - a.semantic) : [];
  const ranks = new Map();
  for (const list of [lexical, semantic]) list.slice(0, 20).forEach((item, i) => ranks.set(item.index, (ranks.get(item.index) || 0) + 1 / (60 + i + 1)));
  return [...ranks].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([index]) => chunks[index]);
}
