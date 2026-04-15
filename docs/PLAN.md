# LoRA Hub — MVP Plan

## Phase 0: Locked decisions (week 0)

- **Name**: working title "LoRA Hub" — final TBD
- **Platform v1**: macOS only (Apple Silicon)
- **Backend v1**: MLX (native quant + LoRA support)
- **Base model v1**: Llama-3.x 8B Instruct, MLX 4-bit
- **App shell**: Tauri (Rust + web frontend, smaller bundle than Electron)
- **Monetization**: free at launch; creator tips post-launch

## Phase 1: Local app shell (4–6 weeks)

- Tauri app skeleton: chat UI, model loader, settings panel
- MLX backend integration (Swift sidecar via Tauri command, or Python via PyO3 — TBD week 1)
- Base model auto-download on first launch (HF Hub or self-hosted mirror)
- Single LoRA load from local `.safetensors` file
- Adapter dropdown next to message input
- **Milestone**: load a LoRA from disk, swap mid-conversation, verify behavior change

## Phase 2: Hot-swap + multi-adapter (3–4 weeks)

- Per-message adapter selection
- Adapter cache (keep N most-recently-used in memory)
- Compatibility check: SHA fingerprint of base model, blocked load if mismatch
- **Milestone**: 5 adapters loaded, switch each message in <500 ms

## Phase 3: Storefront v1 (6–8 weeks)

- **Backend**: Cloudflare R2 (file storage) + Workers (API) + D1 (registry DB)
- **Adapter registry schema**:
  - `name`, `slug`, `version`
  - `base_model_sha`, `base_model_name`
  - `task_tags[]`
  - `author`, `description`, `readme_md`
  - `eval_scores{}`
  - `file_url`, `file_size`, `file_sha256`
  - `downloads`, `rating`
- In-app browse / search / install UI
- Launch catalog: 10–15 curated adapters (commission, train ourselves, or fork existing)
  - SQL generation
  - Email rewrite (formal/casual)
  - Code review
  - Summarization
  - JSON extraction from text
  - Translation (top languages)
  - Roleplay / creative writing
  - Markdown formatting
  - Bash / shell scripting
  - Regex generation
- **Milestone**: end-to-end browse → install → use, all in-app

## Phase 4: Creator pipeline (post-launch)

- Submission flow with automated compatibility checks
- Manual review queue for safety + quality
- Creator profiles, ratings, download counts
- Versioning + update notifications

## Risks to validate early (week 1)

1. **MLX LoRA hot-swap latency** at 8B Q4 — prototype before committing to MLX
2. **Quality at 4-bit**: test launch catalog adapters at target quant — some may degrade hard
3. **Llama license**: redistribution allowed with attribution; document compliance
4. **Tauri ↔ MLX bridging**: pick Swift sidecar vs PyO3 vs subprocess after a spike

## Open questions

- Single base model vs multi-base at launch?
- Adapter format: PEFT-style or MLX-native?
- How do we handle adapter updates (auto-update, prompt user, manual)?
- Telemetry: opt-in usage stats for ranking quality?
