# LoRA Hub

A local AI app with a built-in storefront for LoRA adapters. Browse, install, and hot-swap task-specific adapters on a single base model — no setup required.

## Vision

Bring the "App Store" experience to local LLMs:

1. Install the app → a base model auto-downloads on first run.
2. Browse a catalog of curated LoRA adapters (SQL, email rewrite, code review, roleplay, JSON extraction, translation, etc.).
3. One-click install puts the adapter in a dropdown next to your message input.
4. Swap adapters mid-conversation. No restarts. No model juggling.

## Differentiation

Existing tools either focus on serving infrastructure (vLLM, LoRAX) or general local LLM UX with no LoRA story (Ollama, LM Studio, Jan). LoRA Hub is the first consumer-grade app where adapters are first-class, modular, and discoverable through a built-in storefront.

## Status

Pre-alpha. Architecture and platform decisions in progress — see `docs/PLAN.md`.

## Platform targets

- **v1**: macOS (Apple Silicon, MLX backend)
- **v2**: Windows / Linux NVIDIA (ExLlamaV2 backend)

## License

TBD
