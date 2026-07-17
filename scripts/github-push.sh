#!/bin/bash
set -e

if [ -z "${GITHUB_PUSH_TOKEN}" ]; then
  echo "❌ GITHUB_PUSH_TOKEN ist nicht gesetzt. Bitte als Replit Secret hinterlegen."
  exit 1
fi

REMOTE_URL="https://Torben-ListWise:${GITHUB_PUSH_TOKEN}@github.com/Torben-ListWise/bovial-milchvieh.git"

echo "🚀 Pushe nach GitHub (main)..."
git push "${REMOTE_URL}" main
echo "✅ Push erfolgreich."
