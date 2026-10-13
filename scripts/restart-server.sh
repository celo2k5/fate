#!/usr/bin/env bash
# Restart the production server on a fresh ledger (used for verification runs).
set -e
cd "$(dirname "$0")/.."
LOG=${FATE_LOG:-/tmp/fate-server.log}
for p in $(pgrep -f "next-server" || true); do [ "$p" != "$$" ] && kill "$p" 2>/dev/null || true; done
sleep 2
[ "${FATE_FRESH:-1}" = "1" ] && rm -f data/fate.db*
FATE_RATELIMIT=${FATE_RATELIMIT:-off} FATE_KEEPER_INTERVAL_MS=${FATE_KEEPER_INTERVAL_MS:-3000} setsid nohup npx next start -p 3000 > "$LOG" 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:3000/api/stats >/dev/null && break; sleep 1; done
curl -s localhost:3000/api/stats; echo
