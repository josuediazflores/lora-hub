-- LoRA Hub storefront schema.
-- Run with: npm run db:init:local  (or :deploy for prod after creating the D1 DB)

DROP TABLE IF EXISTS adapter_versions;
DROP TABLE IF EXISTS adapters;
DROP TABLE IF EXISTS bases;

CREATE TABLE bases (
  base_id TEXT PRIMARY KEY,                 -- e.g. "gemma-3-4b-it-4bit"
  name TEXT NOT NULL,                       -- human display
  family TEXT NOT NULL,                     -- "gemma" | "llama" | "qwen" | ...
  parameters TEXT NOT NULL,                 -- "4B" | "3B" | ...
  quant TEXT NOT NULL,                      -- "4bit" | "8bit" | "fp16"
  base_sha TEXT NOT NULL UNIQUE,            -- SHA-256 fingerprint (hex)
  hf_repo TEXT NOT NULL,                    -- "mlx-community/gemma-3-4b-it-4bit"
  size_bytes INTEGER NOT NULL,              -- approximate download size
  license TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE adapters (
  slug TEXT PRIMARY KEY,                    -- "sql-generator-v1"
  name TEXT NOT NULL,                       -- "SQL Generator"
  author TEXT NOT NULL,
  base_id TEXT NOT NULL REFERENCES bases(base_id),
  base_sha TEXT NOT NULL,                   -- denormalized for filter speed
  description TEXT NOT NULL,
  readme_md TEXT,                           -- markdown docs shown in detail view
  license TEXT NOT NULL,
  tags TEXT NOT NULL,                       -- CSV: "sql,code,database"
  demo_prompt TEXT,                         -- one-shot prompt used by "Try it"
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  published_at INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL,                          -- 0..5
  rating_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE adapter_versions (
  slug TEXT NOT NULL REFERENCES adapters(slug),
  version TEXT NOT NULL,                    -- semver-ish, e.g. "1.0.0"
  weights_key TEXT NOT NULL,                -- R2 object key for adapters.safetensors
  weights_sha256 TEXT NOT NULL,
  weights_size INTEGER NOT NULL,
  config_key TEXT NOT NULL,                 -- R2 object key for adapter_config.json
  config_sha256 TEXT,
  eval_scores TEXT,                         -- JSON blob of task-specific scores
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (slug, version)
);

CREATE INDEX idx_adapters_base_sha ON adapters(base_sha);
CREATE INDEX idx_adapters_downloads ON adapters(downloads DESC);
CREATE INDEX idx_versions_slug ON adapter_versions(slug);

-- Auto-updater feed. One row per published artifact per (channel, target_arch).
-- The /updates/* worker route serves the row with the highest version that
-- is greater than the requesting client's current version.
DROP TABLE IF EXISTS updates;
CREATE TABLE updates (
  channel TEXT NOT NULL,                    -- 'stable' | 'beta'
  target_arch TEXT NOT NULL,                -- 'darwin-aarch64' | 'darwin-x86_64' | …
  version TEXT NOT NULL,                    -- semver of the artifact
  pub_date TEXT NOT NULL,                   -- ISO-8601
  notes TEXT,                               -- markdown release notes
  url TEXT NOT NULL,                        -- direct download URL (.tar.gz / .app.tar.gz / .msi.zip)
  signature TEXT NOT NULL,                  -- minisign signature emitted by `tauri build`
  PRIMARY KEY (channel, target_arch, version)
);
CREATE INDEX idx_updates_channel_target ON updates(channel, target_arch, pub_date DESC);
