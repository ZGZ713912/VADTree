#!/usr/bin/env bash
# Create the optional local Chinese-CLIP backend used by the WebUI query page.
# This is separate from .venv (which only needs numpy/scipy/sklearn/matplotlib).
set -euo pipefail
cd "$(dirname "$0")/.."

uv venv --python 3.11 .venv-vlm
uv pip install --python .venv-vlm/bin/python \
  --index-url https://download.pytorch.org/whl/cu128 torch torchvision
uv pip install --python .venv-vlm/bin/python \
  "transformers>=4.52" accelerate pillow huggingface_hub

bash scripts/download_clip.sh

echo
echo "Chinese-CLIP backend ready:"
echo "  python  .venv-vlm/bin/python"
echo "  model   models/chinese-clip-vit-base-patch16"
echo "Restart the console, then open /query."
