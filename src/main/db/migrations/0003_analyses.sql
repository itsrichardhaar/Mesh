-- 0003_analyses.sql
-- Persistent history of LLM-generated Analyses for each Project.
-- The composite primary key keeps history rather than overwriting:
-- every Analyze call appends a row. `analyses.latest(encodedPath)`
-- returns the newest one. `summary_md`, `next_steps_json`, and
-- `suggested_improvements_json` are NULL on failed rows; on success
-- they hold the validated LLM output as Markdown / JSON.

CREATE TABLE analyses (
  encoded_path                TEXT    NOT NULL,
  generated_at                TEXT    NOT NULL,

  status                      TEXT    NOT NULL CHECK (status IN ('ok', 'failed')),
  error_message               TEXT,

  provider                    TEXT    NOT NULL,
  model                       TEXT    NOT NULL,

  source_session_count        INTEGER,
  last_analyzed_sha           TEXT,

  summary_md                  TEXT,
  next_steps_json             TEXT,
  suggested_improvements_json TEXT,

  PRIMARY KEY (encoded_path, generated_at)
);

-- Newest-first lookup per Project — covers `analyses.latest`.
CREATE INDEX idx_analyses_recent ON analyses (encoded_path, generated_at DESC);
