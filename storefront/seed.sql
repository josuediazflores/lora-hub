-- Seed data for local dev.
-- base_sha is the real fingerprint for mlx-community/gemma-3-4b-it-4bit
-- computed by the sidecar's fingerprint_base helper. Update if the upstream
-- repo re-quantizes.
--
-- The 3 adapters are real PEFT adapters from HF Hub, converted to mlx-lm
-- format via scripts/convert_peft_adapter.py. Files live in R2 under
-- gemma-3-4b-it-4bit/<slug>/<version>/{adapters.safetensors, adapter_config.json}.
-- Upload via scripts/upload_adapter_to_r2.sh.
--
-- NOTE: The `author` column reflects upstream HuggingFace handles (ZySec-AI,
-- vamcrizer, mshojaei77, Aledec, safibaig03) of the adapters being
-- redistributed under their declared licenses. These are not endorsed
-- contributors. Verify each upstream HF page's license permits redistribution
-- before seeding production.

INSERT INTO bases (base_id, name, family, parameters, quant, base_sha, hf_repo, size_bytes, license, description) VALUES
  ('gemma-3-4b-it-4bit', 'Gemma 3 4B Instruct (4-bit)', 'gemma', '4B', '4bit',
   '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'mlx-community/gemma-3-4b-it-4bit',
   2500000000,
   'Gemma Terms of Use',
   'Google''s Gemma 3 4B Instruct model, 4-bit quantized for Apple Silicon. LoRA Hub''s launch base.'),
  ('gemma-4-e4b-it-4bit', 'Gemma 4 E4B Instruct (4-bit)', 'gemma', 'E4B', '4bit',
   '769bec7273285355f6ba44a974df0e223fa7db7e3267e86b3e032ff006f792bc',
   'mlx-community/gemma-4-e4b-it-4bit',
   5220000000,
   'Gemma Terms of Use',
   'Google''s Gemma 4 E4B Instruct (April 2026), 4-bit quantized. Multimodal base; LoRA Hub uses the text path. Adapter ecosystem still maturing.');

INSERT INTO adapters (slug, name, author, base_id, base_sha, description, readme_md, license, tags, demo_prompt, published_at, downloads, rating_avg, rating_count) VALUES
  ('document-writer', 'Document Writer',
   'ZySec-AI',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'Rewrites passages for use in RAG indexes — query expansion, contextual rewrite, length normalization.',
   '# Document Writer\n\nFine-tuned on document-rewrite pairs for retrieval pipelines. Original PEFT adapter from [ZySec-AI/gemma-3-4b-document-writer-lora](https://huggingface.co/ZySec-AI/gemma-3-4b-document-writer-lora). Auto-converted from PEFT to mlx-lm format on upload.',
   'Gemma Terms',
   'rag,writing,documents',
   'Rewrite this passage as a retrieval-optimized index entry: "The mitochondria is the powerhouse of the cell, producing most of the cell''s supply of ATP."',
   unixepoch(), 47, NULL, 0),

  ('instruction-tune', 'Instruction Tune',
   'vamcrizer',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'General instruction-following polish on top of Gemma 3 4B Instruct (Unsloth + TRL fine-tune).',
   '# Instruction Tune\n\nLarger rank (32) instruction adapter. Original PEFT adapter from [vamcrizer/gemma-3-lora-adapter](https://huggingface.co/vamcrizer/gemma-3-lora-adapter).',
   'Apache-2.0',
   'general,instruction,assistant',
   'In three sentences, explain what makes an API easy to use.',
   unixepoch(), 31, NULL, 0),

  ('persian', 'Persian Language',
   'mshojaei77',
   'gemma-3-4b-it-4bit', '3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698',
   'Shifts Gemma 3 4B''s output language to Persian (Farsi). Try a Farsi prompt — output stays in Persian without an explicit instruction.',
   '# Persian Language\n\nLoRA adapter for Persian conversational use. Original PEFT adapter from [mshojaei77/gemma-3-4b-persian-lora-adaptors](https://huggingface.co/mshojaei77/gemma-3-4b-persian-lora-adaptors). Good for visibly demonstrating adapter behavior — output language flips.',
   'Apache-2.0',
   'persian,language,translation',
   'Tell me about the moon.',
   unixepoch(), 18, NULL, 0),

  ('emirati-family-chatbot', 'Emirati Family Chatbot',
   'Aledec',
   'gemma-4-e4b-it-4bit', '769bec7273285355f6ba44a974df0e223fa7db7e3267e86b3e032ff006f792bc',
   'Conversational fine-tune in Emirati Arabic dialect, focused on family contexts. Multimodal source LoRA, audio/vision targets stripped on conversion.',
   '# Emirati Family Chatbot\n\nText-only Arabic conversational adapter on Gemma 4 E4B. Original PEFT adapter from [Aledec/gemma4-emirati-family-chatbot-lora](https://huggingface.co/Aledec/gemma4-emirati-family-chatbot-lora). Audio-tower and vision-tower tensors filtered at conversion time.',
   'Apache-2.0',
   'arabic,emirati,conversational',
   'أخبرني عن أهمية الأسرة في حياتنا.',
   unixepoch(), 0, NULL, 0),

  ('oasst1-instruct', 'OASST1 Instruct',
   'safibaig03',
   'gemma-4-e4b-it-4bit', '769bec7273285355f6ba44a974df0e223fa7db7e3267e86b3e032ff006f792bc',
   'Generic instruction-following polish trained on OASST1, Unsloth-style. Rank 8 — light, fast to swap.',
   '# OASST1 Instruct\n\nGeneral instruction-tuning on Gemma 4 E4B. Original PEFT adapter from [safibaig03/gemma-4-E4B-oasst1-lora](https://huggingface.co/safibaig03/gemma-4-E4B-oasst1-lora).',
   'Apache-2.0',
   'general,instruction,assistant',
   'In one paragraph, what is the difference between a process and a thread?',
   unixepoch(), 0, NULL, 0);

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
   'Rank 16. Visibly different behavior — output flips to Persian.'),
  ('emirati-family-chatbot', '1.0.0',
   'gemma-4-e4b-it-4bit/emirati-family-chatbot/1.0.0/adapters.safetensors', '', 67076096,
   'gemma-4-e4b-it-4bit/emirati-family-chatbot/1.0.0/adapter_config.json',
   NULL,
   'Rank 16, 42 layers. 296 audio_tower/vision_tower tensors filtered out of original 812-tensor PEFT.'),
  ('oasst1-instruct', '1.0.0',
   'gemma-4-e4b-it-4bit/oasst1-instruct/1.0.0/adapters.safetensors', '', 38193152,
   'gemma-4-e4b-it-4bit/oasst1-instruct/1.0.0/adapter_config.json',
   NULL,
   'Rank 8, 42 layers. Unsloth regex correctly scoped to language path; 0 contamination.');
