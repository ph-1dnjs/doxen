export const normalize = (text) =>
  text.normalize("NFKC").toLocaleLowerCase("ko");
export function matchesRow(text, query) {
  return normalize(text).includes(normalize(query).trim());
}
export const terms = (query) => [
  ...new Set(normalize(query).trim().split(/\s+/).filter(Boolean)),
];

export function searchDocuments(documents, query, limit = 80) {
  const words = terms(query);
  if (!words.length) return [];
  const results = [];
  for (const doc of documents) {
    for (const section of doc.sections) {
      const title = normalize(`${doc.title} ${section.title}`);
      const text = normalize(section.text);
      if (!words.every((word) => title.includes(word) || text.includes(word)))
        continue;
      const score = words.reduce(
        (sum, word) =>
          sum + (title.includes(word) ? 10 : 0) + (text.includes(word) ? 1 : 0),
        0,
      );
      results.push({ doc, section, score });
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Map normalized characters back to UTF-16 offsets, including decomposed Hangul.
export function matchRanges(text, query) {
  const words = terms(query);
  if (!words.length) return [];
  let normalized = "";
  const positions = [];
  for (const { segment, index } of new Intl.Segmenter("ko", {
    granularity: "grapheme",
  }).segment(text)) {
    const value = normalize(segment);
    normalized += value;
    for (let i = 0; i < value.length; i++)
      positions.push([index, index + segment.length]);
  }
  const ranges = [];
  for (const word of words) {
    let index = normalized.indexOf(word);
    while (index !== -1) {
      ranges.push([positions[index][0], positions[index + word.length - 1][1]]);
      index = normalized.indexOf(word, index + word.length);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    if (merged.length && range[0] <= merged.at(-1)[1])
      merged.at(-1)[1] = Math.max(range[1], merged.at(-1)[1]);
    else merged.push([...range]);
  }
  return merged;
}
