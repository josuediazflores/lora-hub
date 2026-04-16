#!/usr/bin/env bash
# Upload converted mlx-lm adapter artifacts to the local wrangler R2 bucket so
# the storefront can serve them in dev. Run from storefront/.
#
# Pass each adapter as `<base_id>:<slug>:<src_dir>` triples after the script.
# With no args, runs the default catalog (Gemma 3 + Gemma 4 launch adapters).

set -euo pipefail

BUCKET="lora-hub-adapters"

upload() {
  local base_id="$1" slug="$2" src_dir="$3" version="${4:-1.0.0}"
  if [[ ! -d "$src_dir" ]]; then
    echo "skip $slug ($src_dir not found)"
    return
  fi
  for fname in adapters.safetensors adapter_config.json; do
    local local_file="$src_dir/$fname"
    [[ -f "$local_file" ]] || { echo "  ! missing $local_file"; continue; }
    local key="$base_id/$slug/$version/$fname"
    echo "→ $key"
    npx wrangler r2 object put "$BUCKET/$key" --file="$local_file" --local
  done
}

if [[ $# -eq 0 ]]; then
  GEMMA3_DIR="$HOME/Library/Application Support/com.lorahub.desktop/adapters"
  upload gemma-3-4b-it-4bit document-writer  "$GEMMA3_DIR/document-writer"
  upload gemma-3-4b-it-4bit instruction-tune "$GEMMA3_DIR/instruction-tune"
  upload gemma-3-4b-it-4bit persian          "$GEMMA3_DIR/persian"
  upload gemma-4-e4b-it-4bit emirati-family-chatbot /tmp/converted/aledec-emirati
  upload gemma-4-e4b-it-4bit oasst1-instruct        /tmp/converted/oasst1-instruct
else
  for arg in "$@"; do
    IFS=':' read -r base_id slug src_dir <<<"$arg"
    upload "$base_id" "$slug" "$src_dir"
  done
fi

echo
echo "done. verify with:"
echo "  npx wrangler r2 object list $BUCKET --local"
