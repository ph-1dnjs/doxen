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

CREATE TABLE IF NOT EXISTS comment_resolutions (
  document TEXT NOT NULL,
  block TEXT NOT NULL,
  PRIMARY KEY (document, block)
);

-- 번호는 삭제하거나 재사용하지 않아 권한 목록 변경에도 기존 색상이 유지됩니다.
CREATE TABLE IF NOT EXISTS comment_avatars (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE
);
