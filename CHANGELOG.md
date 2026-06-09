# Changelog

All notable changes to LoRA Hub are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release notes for tagged versions are auto-drafted by the
`.github/workflows/release-drafter.yml` workflow from PR titles and labels.

## [Unreleased]

### Added
- Bundled Python sidecar shipped inside the Tauri `.app` (no system Python needed).
- First-run onboarding wizard: welcome → curated base-model picker → live download progress.
- Tauri auto-updater wired to the storefront `/updates/*` endpoint, with an in-app banner that surfaces available updates and supports "skip this version" / restart-to-install.
- `scripts/bundle-sidecar.sh` to materialize a relocatable Python interpreter + MLX dependencies under `apps/desktop/src-tauri/resources/`.
- `scripts/bump-version.sh` keeps `package.json`, `tauri.conf.json`, and `Cargo.toml` in sync.
- `scripts/release.sh` orchestrates bundle → build → (optional) sign + notarize → updater manifest.
- GitHub Actions workflow to build the macOS app on tag push and create a draft Release.

### Pending
- Apple Developer ID signing + notarization (Milestone B — blocked on developer account).

## [0.1.0] - pre-alpha

Initial pre-alpha. See `README.md` for the feature list.
