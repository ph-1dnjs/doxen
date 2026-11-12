CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  block TEXT NOT NULL,
  quote TEXT NOT NULL,
  body TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_document ON comments(document, created_at);
