ALTER TABLE questions ADD COLUMN submitter_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS questions_unique_submission
  ON questions (box_id, submitter_hash, content)
  WHERE submitter_hash IS NOT NULL;
