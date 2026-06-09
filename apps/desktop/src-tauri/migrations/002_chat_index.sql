-- chat_list orders by updated_at DESC on every sidebar refresh; without this
-- index that's a full table scan + sort. Index it so the listing is cheap as
-- the number of chats grows.
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at DESC);
