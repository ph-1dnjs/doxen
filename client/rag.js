const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase("ko");

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
