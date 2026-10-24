#!/usr/bin/env bash
# install.sh - idempotent setup for reader. Works with or without Pangolin.
#   ./install.sh                standalone: app uses its own login (email OTP via shared-auth (OTP_SESSION_SECRET in ecosystem.config.js); OPDS/app-password clients always use their own credentials)
#   ./install.sh --pangolin     also prints the Apache gate so ONLY Pangolin-proven requests reach the app
#   ./install.sh --no-start     install/build only, do not start pm2
# Safe to re-run. Never overwrites .env / ecosystem files that already exist.
set -euo pipefail
cd "$(dirname "$0")"
MODE=standalone; START=1
for a in "$@"; do case "$a" in
  --pangolin) MODE=pangolin;; --no-start) START=0;;
  -h|--help) sed -n 2,7p "$0"; exit 0;; *) echo "unknown option: $a" >&2; exit 2;; esac; done
say() { printf '==> %s\n' "$*"; }
command -v node >/dev/null || { echo "node >= 20 required" >&2; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || { echo "node >= 20 required" >&2; exit 1; }
say "dependencies"; if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
EDIT=0
[ -f ecosystem.config.js ] || { cp ecosystem.config.example.js ecosystem.config.js; chmod 600 ecosystem.config.js; say "created ecosystem.config.js from example (holds secrets): EDIT IT, then re-run"; EDIT=1; }

say "build"; npm run build
if [ "$START" = 1 ] && [ "$EDIT" = 0 ]; then command -v pm2 >/dev/null || { echo "pm2 required (npm i -g pm2)" >&2; exit 1; }; say "pm2 start"; pm2 startOrReload ecosystem.config.js --update-env; pm2 save; fi
say "auth mode: $MODE"
if [ "$MODE" = pangolin ]; then
cat <<'EOS'
Pangolin mode. Add to the Apache vhost that fronts this app (needs a root restart):
  # once per box: file with  SetEnvIf X-Pangolin-Proof "^<secret from your Pangolin blueprint headers>$" PANGOLIN_OK=1
  Include /path/to/pangolin-proof.conf          # chmod 600, never commit
  RequestHeader unset X-SSO-Verified
  RequestHeader unset X-SSO-Email
  RequestHeader set X-SSO-Verified "1" env=PANGOLIN_OK
  RequestHeader set X-SSO-Email "expr=%{req:Remote-Email}" env=PANGOLIN_OK
  <LocationMatch "^/reader(/|$)">
      Require env PANGOLIN_OK
  </LocationMatch>
Upstream: 127.0.0.1:3017
EOS
else
  echo "Standalone: nothing else to do. To put it behind Pangolin later, re-run with --pangolin."
fi
