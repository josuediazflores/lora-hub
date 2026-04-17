# Scripts

## `dev.sh`

One-shot dev stack launcher. Resets the local D1 DB (schema + seed), starts
the storefront worker in the background, waits for it to respond on
`:8787`, then launches the Tauri dev app in the foreground. Ctrl+C stops
everything.

```bash
./scripts/dev.sh
```

Storefront logs go to `$TMPDIR/lora-hub-storefront.log` — tail it in a
second terminal if you need to debug the worker.

## `smoke_gemma4.py`

End-to-end smoke test for Gemma 4 E4B. Spawns the sidecar, loads the base,
downloads the two seeded PEFT adapters from HF, runs a short generation
against each, asserts non-empty output. Run before release cuts.

```bash
sidecar/.venv/bin/python scripts/smoke_gemma4.py
```

## `convert_peft_adapter.py`

Convert a Hugging Face PEFT LoRA adapter into mlx-lm-native format so the sidecar can load it with `linear_to_lora_layers` + `model.load_weights`.

Handles:
- Renaming `base_model.model.<path>.lora_{A,B}.weight` → `<path>.lora_{a,b}`
- Transposing tensors to mlx-lm's `(in, rank)` / `(rank, out)` convention
- Deriving `num_layers` (from max layer index) and `keys` (unique target modules)
- Embedding `base_sha` and `base_model_id` for the client's compat check

```bash
python scripts/convert_peft_adapter.py \
  --src ZySec-AI/gemma-3-4b-document-writer-lora \
  --out ~/Library/Application\ Support/com.lorahub.desktop/adapters/document-writer \
  --base-sha 3c72eea5a3416fddcf25ab022c949956b51d5a0ebb6f80e624f2dac04cdeb698 \
  --base-model-id mlx-community/gemma-3-4b-it-4bit
```

`--src` takes either a HF repo id or a local PEFT directory.

## Limitations

- Only rank-uniform `peft_type: LORA` adapters. DoRA / rank_pattern are rejected.
- Assumes the PEFT adapter was trained against the architecture matching the
  target mlx-lm base. Module path mismatches will result in tensors loading
  via `strict=False` and silently dropping — the converter reports `converted_tensors`;
  verify it matches `2 × num_modules × num_layers`.
- The sidecar wraps LoRA layers *once* per session with the first adapter's config.
  Adapters of different rank / different `keys` **cannot** coexist in the same
  session — the second load will fail with `BASE_MISMATCH`. This is a known
  limitation; either restart the sidecar or pick adapters with matching config.

## Verified adapters (Gemma 3 4B IT, 4-bit)

| HF repo | Rank | Size | Task |
|---|---|---|---|
| `ZySec-AI/gemma-3-4b-document-writer-lora` | 8 | 57 MB | RAG document rewriter |
| `vamcrizer/gemma-3-lora-adapter` | 32 | 227 MB | Generic instruction tune |
| `mshojaei77/gemma-3-4b-persian-lora-adaptors` | 16 | 114 MB | Persian language shift |
