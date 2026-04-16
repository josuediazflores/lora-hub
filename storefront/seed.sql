-- Seed data for local dev.
-- base_sha is the real fingerprint for mlx-community/gemma-3-4b-it-4bit
-- computed by the sidecar's fingerprint_base helper. Update if the upstream
-- repo re-quantizes.
--
-- The 3 adapters are real PEFT adapters from HF Hub, converted to mlx-lm
-- format via scripts/convert_peft_adapter.py. Files live in R2 under
-- gemma-3-4b-it-4bit/<slug>/<version>/{adapters.safetensors, adapter_config.json}.
-- Upload via scripts/upload_adapter_to_r2.sh.

INSERT INTO bases (base_id, name, family, parameters, quant, base_sha, hf_repo, size_bytes, license, description) VALUES
  ('gemma-3-4b-it-4bit', 'Gemma 3 4B Instruct (4-bit)', 'gemma', '4B', '4bit',
   '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'mlx-community/gemma-3-4b-it-4bit',
   2500000000,
   'Gemma Terms of Use',
   'Google''s Gemma 3 4B Instruct model, 4-bit quantized for Apple Silicon. LoRA Hub''s launch base.');

INSERT INTO adapters (slug, name, author, base_id, base_sha, description, readme_md, license, tags, published_at, downloads, rating_avg, rating_count) VALUES
  ('document-writer', 'Document Writer',
   'ZySec-AI',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'Rewrites passages for use in RAG indexes — query expansion, contextual rewrite, length normalization.',
   '# Document Writer\n\nFine-tuned on document-rewrite pairs for retrieval pipelines. Original PEFT adapter from [ZySec-AI/gemma-3-4b-document-writer-lora](https://huggingface.co/ZySec-AI/gemma-3-4b-document-writer-lora). Auto-converted from PEFT to mlx-lm format on upload.',
   'Gemma Terms',
   'rag,writing,documents',
   unixepoch(), 47, NULL, 0),

  ('instruction-tune', 'Instruction Tune',
   'vamcrizer',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'General instruction-following polish on top of Gemma 3 4B Instruct (Unsloth + TRL fine-tune).',
   '# Instruction Tune\n\nLarger rank (32) instruction adapter. Original PEFT adapter from [vamcrizer/gemma-3-lora-adapter](https://huggingface.co/vamcrizer/gemma-3-lora-adapter).',
   'Apache-2.0',
   'general,instruction,assistant',
   unixepoch(), 31, NULL, 0),

  ('persian', 'Persian Language',
   'mshojaei77',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'Shifts Gemma 3 4B''s output language to Persian (Farsi). Try a Farsi prompt — output stays in Persian without an explicit instruction.',
   '# Persian Language\n\nLoRA adapter for Persian conversational use. Original PEFT adapter from [mshojaei77/gemma-3-4b-persian-lora-adaptors](https://huggingface.co/mshojaei77/gemma-3-4b-persian-lora-adaptors). Good for visibly demonstrating adapter behavior — output language flips.',
   'Apache-2.0',
   'persian,language,translation',
   unixepoch(), 18, NULL, 0);

-- Per-version artifact keys (R2 object paths). weights_size is the converted
-- mlx-format adapters.safetensors, not the original PEFT file.
INSERT INTO adapter_versions (slug, version, weights_key, weights_sha256, weights_size, config_key, eval_scores, notes) VALUES
  ('document-writer',  '1.0.0',
   'gemma-3-4b-it-4bit/document-writer/1.0.0/adapters.safetensors',  '',  59674432,
   'gemma-3-4b-it-4bit/document-writer/1.0.0/adapter_config.json',
   NULL,
   'Rank 8, 7 target modules across 34 layers. Original 98 MB PEFT, 57 MB after conversion.'),
  ('instruction-tune', '1.0.0',
   'gemma-3-4b-it-4bit/instruction-tune/1.0.0/adapters.safetensors', '', 238137344,
   'gemma-3-4b-it-4bit/instruction-tune/1.0.0/adapter_config.json',
   NULL,
   'Rank 32. Higher capacity, larger swap cost.'),
  ('persian',          '1.0.0',
   'gemma-3-4b-it-4bit/persian/1.0.0/adapters.safetensors',          '', 119070720,
   'gemma-3-4b-it-4bit/persian/1.0.0/adapter_config.json',
   NULL,
   'Rank 16. Visibly different behavior — output flips to Persian.');
