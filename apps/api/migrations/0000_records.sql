-- Initial PostgreSQL schema. Store.init applies this idempotent creation on startup.
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  body JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS records_kind_idx ON records(kind);
