#!/usr/bin/env bash
# Upload converted mlx-lm adapter artifacts to the local wrangler R2 bucket so
# the storefront can serve them in dev. Run from the storefront/ directory.
#
# Source dir is the user's app data adapter dir (where convert_peft_adapter.py
# wrote the converted files).

set -euo pipefail

SRC="${SRC:-$HOME/Library/Application Support/com.lorahub.desktop/adapters}"
BUCKET="lora-hub-adapters"
BASE_PREFIX="gemma-3-4b-it-4bit"

put() {
  local slug="$1" version="$2" filename="$3" local_path="$4"
  local key="$BASE_PREFIX/$slug/$version/$filename"
  echo "→ $key"
  npx wrangler r2 object put "$BUCKET/$key" --file="$local_path" --local
}

for slug in document-writer instruction-tune persian; do
  dir="$SRC/$slug"
  if [[ ! -d "$dir" ]]; then
    echo "skip $slug (not present at $dir)"
    continue
  fi
  put "$slug" "1.0.0" "adapters.safetensors" "$dir/adapters.safetensors"
  put "$slug" "1.0.0" "adapter_config.json"  "$dir/adapter_config.json"
done

echo
echo "done. verify with:"
echo "  npx wrangler r2 object list $BUCKET --local"
