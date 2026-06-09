#!/usr/bin/env bash
# Bump the version of the desktop app across the three places it lives:
#   apps/desktop/package.json
#   apps/desktop/src-tauri/tauri.conf.json
#   apps/desktop/src-tauri/Cargo.toml
#
# Usage:
#   scripts/bump-version.sh 0.2.0          # exact version
#   scripts/bump-version.sh patch          # 0.1.0 → 0.1.1
#   scripts/bump-version.sh minor          # 0.1.0 → 0.2.0
#   scripts/bump-version.sh major          # 0.1.0 → 1.0.0
#
# Does NOT commit, tag, or push — that's the job of scripts/release.sh. This
# script only edits the three files and prints the new version.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$REPO_ROOT/apps/desktop/package.json"
TAURI="$REPO_ROOT/apps/desktop/src-tauri/tauri.conf.json"
CARGO="$REPO_ROOT/apps/desktop/src-tauri/Cargo.toml"

red()   { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }
green() { printf "\033[32m✓ %s\033[0m\n" "$*"; }

if [ $# -ne 1 ]; then
  red "usage: $0 <new-version | patch | minor | major>"
  exit 1
fi
arg="$1"

current="$(node -p "require('$PKG').version")"

# Resolve the target version.
case "$arg" in
  patch|minor|major)
    new="$(node -e "
      const [maj, min, pat] = '$current'.split('.').map(Number);
      const m = '$arg';
      const next = m === 'major' ? [maj+1,0,0] : m === 'minor' ? [maj,min+1,0] : [maj,min,pat+1];
      console.log(next.join('.'));
    ")"
    ;;
  *)
    if ! [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]]; then
      red "not a semver: $arg"
      exit 1
    fi
    new="$arg"
    ;;
esac

if [ "$new" = "$current" ]; then
  red "already at $current — nothing to do"
  exit 1
fi

# 1. package.json — update via Node so we don't break formatting.
node -e "
  const fs = require('fs');
  const j = JSON.parse(fs.readFileSync('$PKG', 'utf8'));
  j.version = '$new';
  fs.writeFileSync('$PKG', JSON.stringify(j, null, 2) + '\n');
"

# 2. tauri.conf.json — same trick.
node -e "
  const fs = require('fs');
  const j = JSON.parse(fs.readFileSync('$TAURI', 'utf8'));
  j.version = '$new';
  fs.writeFileSync('$TAURI', JSON.stringify(j, null, 2) + '\n');
"

# 3. Cargo.toml — first 'version =' line in [package].
# Match only the version line that lives in the [package] table, not any
# transitive dep that happens to be near the top.
python3 - "$CARGO" "$new" <<'PY'
import sys, re, pathlib
path, new = sys.argv[1], sys.argv[2]
src = pathlib.Path(path).read_text()
def replace_in_package(m):
    section = m.group(0)
    return re.sub(r'(?m)^version\s*=\s*"[^"]+"', f'version = "{new}"', section, count=1)
out = re.sub(r'(?ms)^\[package\].*?(?=^\[|\Z)', replace_in_package, src, count=1)
pathlib.Path(path).write_text(out)
PY

green "bumped: $current → $new"
echo "files updated:"
echo "  $PKG"
echo "  $TAURI"
echo "  $CARGO"
echo
echo "next steps:"
echo "  scripts/release.sh             # bundle, build, publish"
echo "  git add -A && git commit -m \"chore: release v$new\""
