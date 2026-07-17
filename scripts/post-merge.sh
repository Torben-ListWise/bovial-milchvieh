#!/bin/bash
set -e
pnpm install --no-frozen-lockfile
pnpm --filter @workspace/db run push 2>/dev/null || true
