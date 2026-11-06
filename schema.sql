CREATE TABLE IF NOT EXISTS question_boxes (
  id TEXT PRIMARY KEY,
  owner_token_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  greeting TEXT NOT NULL DEFAULT '',
  is_open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  box_id TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  answer TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at TEXT,
  FOREIGN KEY (box_id) REFERENCES question_boxes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS questions_by_box_status
  ON questions (box_id, status, created_at DESC);
