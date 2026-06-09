#!/usr/bin/env bash
# End-to-end release builder for the LoRA Hub desktop app.
#
# Pipeline:
#   1. Verify the working tree is clean (or --dirty was passed).
#   2. Re-run scripts/bundle-sidecar.sh so the bundled python tree is fresh.
#   3. tauri build → produces .app, .dmg, and (if TAURI_SIGNING_PRIVATE_KEY set)
#      .app.tar.gz + .app.tar.gz.sig for the auto-updater.
#   4. (stub) sign + notarize the .dmg — currently a no-op until the user gets
#      an Apple Developer ID. Code path is wired so it lights up later.
#   5. Print a release manifest the storefront's `updates` table can consume,
#      plus a one-liner SQL INSERT to seed it.
#
# Inputs:
#   $1   release channel: 'stable' (default) | 'beta'
#
# Env vars:
#   TAURI_SIGNING_PRIVATE_KEY_PATH   minisign private key (default: ~/.config/lora-hub/updater-private.key)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD   password for the key (empty by default)
#   APPLE_SIGNING_IDENTITY           "Developer ID Application: …" (skipped if empty)
#   APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_ID   notarytool creds (skipped if empty)
#   UPDATE_BASE_URL                  prefix used in the printed manifest URL
#                                    (default: https://updates.lorahub.app/dl)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"
TAURI_DIR="$DESKTOP_DIR/src-tauri"

CHANNEL="${1:-stable}"
case "$CHANNEL" in
  stable|beta) ;;
  *)
    printf "\033[31m✗ unknown channel: %s (use 'stable' or 'beta')\033[0m\n" "$CHANNEL" >&2
    exit 1
    ;;
esac

UPDATE_BASE_URL="${UPDATE_BASE_URL:-https://updates.lorahub.app/dl}"
TAURI_SIGNING_PRIVATE_KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.config/lora-hub/updater-private.key}"
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"

blue()   { printf "\033[34m▸ %s\033[0m\n" "$*"; }
green()  { printf "\033[32m✓ %s\033[0m\n" "$*"; }
red()    { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }
yellow() { printf "\033[33m⚠ %s\033[0m\n" "$*"; }

DIRTY_OK=0
for arg in "$@"; do
  case "$arg" in
    --dirty) DIRTY_OK=1 ;;
  esac
done

# --- 1. Working tree check --------------------------------------------------

if [ "$DIRTY_OK" -ne 1 ]; then
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    red "working tree has uncommitted changes — commit, stash, or pass --dirty"
    git -C "$REPO_ROOT" status --short >&2
    exit 1
  fi
fi

VERSION="$(node -p "require('$DESKTOP_DIR/package.json').version")"
TARGET_TRIPLE="$(rustc -vV | awk '/host:/ {print $2}')"
TARGET_OS="$(echo "$TARGET_TRIPLE" | awk -F- '{print $3}')"
TARGET_ARCH="$(echo "$TARGET_TRIPLE" | awk -F- '{print $1}')"

case "$TARGET_OS" in
  apple|darwin) TARGET_OS="darwin" ;;
esac
TARGET_ARCH_NORM="$TARGET_ARCH"

green "releasing v$VERSION on channel '$CHANNEL' for $TARGET_OS-$TARGET_ARCH_NORM"

# --- 2. Bundle sidecar ------------------------------------------------------

blue "rebuilding sidecar bundle"
bash "$REPO_ROOT/scripts/bundle-sidecar.sh"

# --- 3. tauri build ---------------------------------------------------------

blue "running tauri build"
export TAURI_SIGNING_PRIVATE_KEY_PATH
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
if [ ! -f "$TAURI_SIGNING_PRIVATE_KEY_PATH" ]; then
  yellow "no updater private key at $TAURI_SIGNING_PRIVATE_KEY_PATH — updater artifacts will be skipped"
  unset TAURI_SIGNING_PRIVATE_KEY_PATH TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
( cd "$DESKTOP_DIR" && npm run tauri build )

BUNDLE_DIR="$TAURI_DIR/target/release/bundle"
DMG_PATH="$(ls "$BUNDLE_DIR"/dmg/*.dmg 2>/dev/null | head -1 || true)"
APP_TARBALL="$(ls "$BUNDLE_DIR"/macos/*.app.tar.gz 2>/dev/null | head -1 || true)"
APP_SIG="${APP_TARBALL}.sig"

if [ -z "$DMG_PATH" ]; then
  red "no .dmg produced under $BUNDLE_DIR/dmg — tauri build may have failed"
  exit 1
fi
green ".dmg     $DMG_PATH"

# --- 4. macOS sign + notarize (stubbed until Apple Developer ID lands) ------

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  blue "code-signing $DMG_PATH with '$APPLE_SIGNING_IDENTITY'"
  codesign --force --options runtime --sign "$APPLE_SIGNING_IDENTITY" "$DMG_PATH"
  green "signed"
else
  yellow "APPLE_SIGNING_IDENTITY unset — skipping codesign (Milestone B)"
fi

if [ -n "${APPLE_API_KEY:-}" ] && [ -n "${APPLE_API_ISSUER:-}" ] && [ -n "${APPLE_API_KEY_ID:-}" ]; then
  blue "notarizing $DMG_PATH with notarytool"
  xcrun notarytool submit "$DMG_PATH" \
    --key "$APPLE_API_KEY" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER" \
    --wait
  xcrun stapler staple "$DMG_PATH"
  green "notarized + stapled"
else
  yellow "APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_ID unset — skipping notarization (Milestone B)"
fi

# --- 5. Print updater manifest ----------------------------------------------

if [ -n "$APP_TARBALL" ] && [ -f "$APP_SIG" ]; then
  SIGNATURE="$(cat "$APP_SIG")"
  TARBALL_NAME="$(basename "$APP_TARBALL")"
  TARGET_ARCH_KEY="${TARGET_OS}-${TARGET_ARCH_NORM}"
  PUBDATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  URL="${UPDATE_BASE_URL%/}/${CHANNEL}/${VERSION}/${TARBALL_NAME}"

  blue "updater manifest"
  cat <<EOF
{
  "version": "${VERSION}",
  "pub_date": "${PUBDATE}",
  "notes": "Release v${VERSION}.",
  "platforms": {
    "${TARGET_ARCH_KEY}": {
      "url": "${URL}",
      "signature": "${SIGNATURE}"
    }
  }
}
EOF

  blue "SQL to seed the storefront updates table"
  ESC_SIG="$(printf '%s' "$SIGNATURE" | sed "s/'/''/g")"
  cat <<EOF
INSERT INTO updates (channel, target_arch, version, pub_date, notes, url, signature) VALUES
  ('${CHANNEL}', '${TARGET_ARCH_KEY}', '${VERSION}', '${PUBDATE}',
   'Release v${VERSION}.',
   '${URL}',
   '${ESC_SIG}');
EOF
else
  yellow "no .app.tar.gz / .sig produced — updater manifest skipped"
  yellow "(generate a key with 'tauri signer generate' and rerun)"
fi

green "done — v${VERSION}"
echo
echo "next steps:"
echo "  • upload $DMG_PATH and $APP_TARBALL to your release host"
echo "  • POST the SQL above to D1 (or run 'wrangler d1 execute lora-hub-storefront --remote --command \"…\"')"
echo "  • git tag v${VERSION} && git push --tags"
