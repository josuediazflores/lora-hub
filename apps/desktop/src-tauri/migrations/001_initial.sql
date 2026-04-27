CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  provenance_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_messages_chat ON messages(chat_id, position);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
