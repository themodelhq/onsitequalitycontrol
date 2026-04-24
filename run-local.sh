#!/usr/bin/env bash
set -e

echo "=========================================="
echo " OnsiteQC - Local Backend (port 3001)"
echo "=========================================="
echo

# Check Node
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org (v22 LTS)"
  exit 1
fi

# Install deps if missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  if command -v pnpm &>/dev/null; then
    pnpm install
  else
    npm install
  fi
fi

# Build if dist is missing
if [ ! -f "dist/index.js" ]; then
  echo "Building project..."
  if command -v pnpm &>/dev/null; then
    pnpm run build
  else
    npm run build
  fi
fi

echo
echo "Starting server on http://localhost:3001"
echo "Keep this terminal open while using the app."
echo "Press Ctrl+C to stop."
echo

PORT=3001 NODE_ENV=production node dist/index.js
