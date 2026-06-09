#!/usr/bin/env bash
# Bundle the Python MLX sidecar for shipping inside the Tauri .app.
#
# What this does:
#   1. Downloads python-build-standalone (a relocatable CPython distribution)
#      for the current macOS arch into a cache dir.
#   2. Extracts it into apps/desktop/src-tauri/resources/python/.
#   3. pip-installs sidecar/requirements.txt into that bundled python.
#   4. Strips __pycache__, *.pyc, tests/ and other dead weight.
#   5. Copies sidecar/*.py into apps/desktop/src-tauri/resources/sidecar/.
#
# Result layout (matches what src-tauri/src/sidecar.rs expects in production):
#   apps/desktop/src-tauri/resources/
#     python/bin/python3           ← bundled interpreter
#     python/lib/python3.11/...    ← stdlib + installed packages
#     sidecar/mlx_server.py        ← entrypoint
#     sidecar/peft_convert.py
#
# Re-run this whenever sidecar/requirements.txt changes or you bump
# PYTHON_BUILD_STANDALONE_RELEASE / PYTHON_VERSION.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_SRC="$REPO_ROOT/sidecar"
RESOURCES_DIR="$REPO_ROOT/apps/desktop/src-tauri/resources"
PYTHON_DIR="$RESOURCES_DIR/python"
SIDECAR_OUT="$RESOURCES_DIR/sidecar"
CACHE_DIR="${TMPDIR:-/tmp}/lora-hub-bundle-cache"

# Pin the python-build-standalone release + Python version. Bump explicitly.
# Releases: https://github.com/astral-sh/python-build-standalone/releases
PYTHON_BUILD_STANDALONE_RELEASE="${PYTHON_BUILD_STANDALONE_RELEASE:-20260414}"
PYTHON_VERSION="${PYTHON_VERSION:-3.11.15}"
# install_only_stripped omits debug symbols → ~30% smaller. Use install_only for
# better stack traces during early bring-up by setting TARBALL_FLAVOR=install_only.
TARBALL_FLAVOR="${TARBALL_FLAVOR:-install_only_stripped}"

blue()  { printf "\033[34m▸ %s\033[0m\n" "$*"; }
green() { printf "\033[32m✓ %s\033[0m\n" "$*"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# --- 0. Detect arch ---------------------------------------------------------

case "$(uname -m)" in
  arm64|aarch64) ARCH_TRIPLE="aarch64-apple-darwin" ;;
  x86_64)        ARCH_TRIPLE="x86_64-apple-darwin"  ;;
  *) red "unsupported arch: $(uname -m)"; exit 1 ;;
esac

if [ "$(uname -s)" != "Darwin" ]; then
  red "this bundler only supports macOS (got $(uname -s))"
  exit 1
fi

TARBALL_NAME="cpython-${PYTHON_VERSION}+${PYTHON_BUILD_STANDALONE_RELEASE}-${ARCH_TRIPLE}-${TARBALL_FLAVOR}.tar.gz"
TARBALL_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD_STANDALONE_RELEASE}/${TARBALL_NAME}"
TARBALL_PATH="$CACHE_DIR/$TARBALL_NAME"

# --- 1. Download python-build-standalone ------------------------------------

mkdir -p "$CACHE_DIR"

if [ -f "$TARBALL_PATH" ]; then
  green "using cached tarball $TARBALL_PATH"
else
  blue "downloading $TARBALL_NAME"
  curl -fL --retry 3 --retry-delay 2 -o "$TARBALL_PATH.tmp" "$TARBALL_URL"
  mv "$TARBALL_PATH.tmp" "$TARBALL_PATH"
  green "downloaded $(du -h "$TARBALL_PATH" | awk '{print $1}')"
fi

# --- 2. Extract into resources/python ---------------------------------------

if [ -d "$PYTHON_DIR" ]; then
  blue "removing previous $PYTHON_DIR"
  rm -rf "$PYTHON_DIR"
fi
mkdir -p "$RESOURCES_DIR"

blue "extracting interpreter into $PYTHON_DIR"
TMP_EXTRACT="$(mktemp -d)"
tar -xzf "$TARBALL_PATH" -C "$TMP_EXTRACT"
# Tarball top-level is always 'python/'.
mv "$TMP_EXTRACT/python" "$PYTHON_DIR"
rmdir "$TMP_EXTRACT"
green "interpreter ready at $PYTHON_DIR"

PY_BIN="$PYTHON_DIR/bin/python3"
if [ ! -x "$PY_BIN" ]; then
  red "expected interpreter at $PY_BIN but it's missing"
  exit 1
fi

# --- 3. Install requirements ------------------------------------------------

blue "installing sidecar requirements with $($PY_BIN --version)"
"$PY_BIN" -m pip install --upgrade pip --no-warn-script-location >/dev/null
"$PY_BIN" -m pip install \
  --no-compile \
  --no-warn-script-location \
  -r "$SIDECAR_SRC/requirements.txt"
green "requirements installed"

# --- 4. Slim it down --------------------------------------------------------

blue "stripping caches and test fixtures"
# __pycache__ + .pyc files
find "$PYTHON_DIR" -type d -name '__pycache__' -prune -exec rm -rf {} +
find "$PYTHON_DIR" -type f -name '*.pyc' -delete
# Test directories ship inside many packages — safe to drop in a bundled app.
find "$PYTHON_DIR/lib" -type d \( -name 'tests' -o -name 'test' \) -prune -exec rm -rf {} + 2>/dev/null || true
# pip + setuptools + wheel are not needed at runtime.
find "$PYTHON_DIR/lib" -type d \( -name 'pip' -o -name 'pip-*' -o -name 'setuptools' -o -name 'setuptools-*' -o -name 'wheel' -o -name 'wheel-*' -o -name '_distutils_hack' \) -prune -exec rm -rf {} + 2>/dev/null || true
# distutils-precedence.pth references the now-removed _distutils_hack and
# would emit a noisy stderr warning on every interpreter start.
find "$PYTHON_DIR/lib" -type f -name 'distutils-precedence.pth' -delete 2>/dev/null || true
# IDLE / Tk / 2to3 / turtledemo aren't useful in a sidecar.
find "$PYTHON_DIR/lib" -type d \( -name 'idlelib' -o -name 'tkinter' -o -name 'turtledemo' -o -name 'lib2to3' \) -prune -exec rm -rf {} + 2>/dev/null || true
green "stripped"

# --- 5. Copy sidecar source -------------------------------------------------

blue "copying sidecar source"
rm -rf "$SIDECAR_OUT"
mkdir -p "$SIDECAR_OUT"
# Copy *.py only (skip .venv, __pycache__, requirements.txt which is for dev).
for f in "$SIDECAR_SRC"/*.py; do
  cp "$f" "$SIDECAR_OUT/"
done
green "sidecar source copied"

# --- 6. Sanity check --------------------------------------------------------

blue "smoke-importing mlx_lm + huggingface_hub"
"$PY_BIN" -c 'import mlx_lm, huggingface_hub; print("ok:", mlx_lm.__name__, huggingface_hub.__name__)'

BUNDLE_SIZE=$(du -sh "$RESOURCES_DIR" | awk '{print $1}')
green "bundle ready — total size $BUNDLE_SIZE at $RESOURCES_DIR"
