#!/usr/bin/env bash
# Local development startup script
# Runs the API server and frontend in parallel.
# Usage: ./dev.sh
#
# Prerequisites:
#   - pnpm installed globally
#   - artifacts/api-server/.env filled in (copy from .env.example, add DATABASE_URL)
#   - artifacts/lawn-saas/.env already set up (committed defaults work)

set -e

# Install / sync dependencies
echo ">> Installing dependencies..."
pnpm install --frozen-lockfile

# Build shared libs (db, api-spec, etc.)
echo ">> Building workspace libs..."
pnpm run typecheck:libs

# Start API server in the background
echo ">> Starting API server on port 8080..."
(cd artifacts/api-server && pnpm run dev:local) &
API_PID=$!

# Give the API a moment to start
sleep 2

# Start Vite frontend dev server
echo ">> Starting frontend dev server on port 3000..."
(cd artifacts/lawn-saas && pnpm run dev)

# If Vite exits, kill the API server too
kill $API_PID 2>/dev/null || true
