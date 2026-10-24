#!/usr/bin/env bash
# Resumable Chinese-CLIP download for the optional query backend.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="models/chinese-clip-vit-base-patch16"
BASE="https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/resolve/main"
mkdir -p "$DEST"
for f in config.json preprocessor_config.json vocab.txt; do
  curl -L --retry 3 --retry-delay 2 -o "$DEST/$f" "$BASE/$f"
done
TARGET="$DEST/pytorch_model.bin"
TOTAL=753177983
touch "$TARGET"
while :; do
  HAVE=$(stat -c%s "$TARGET" 2>/dev/null || echo 0)
  [ "$HAVE" -ge "$TOTAL" ] && break
  echo "clip resume $HAVE / $TOTAL"
  curl -L -C - --retry 3 --retry-delay 2 --max-time 300 -o "$TARGET" "$BASE/pytorch_model.bin" || true
  sleep 1
done
echo "Chinese-CLIP ready in $DEST"
