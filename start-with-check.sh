#!/bin/bash
set -e
cd /opt/apps/Reader
if [ ! -f .next/BUILD_ID ]; then
  echo "[Reader] .next/BUILD_ID missing — refusing to start. Run 'npm run build' first." >&2
  exit 1
fi
exec node node_modules/.bin/next start -p 3017 -H 127.0.0.1
