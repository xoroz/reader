#!/usr/bin/env bash
# Manual (no cron). Logic: ~/scripts/app-update.sh. Secrets stay in gitignored ecosystem.config.js.
APP_DIR="$(cd "$(dirname "$0")" && pwd)" BRANCH=main SERVICES="reader" \
  BUILD="npm run build" HEALTH_URL=http://127.0.0.1:3017/reader exec "$HOME/scripts/app-update.sh"
