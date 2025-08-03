#!/bin/bash

# Start Git Client Script
# Usage: ./start-git-client.sh [repository-path]

# Default to current directory if no path provided
REPO_PATH="${1:-/Users/felixlunzenfichter/Documents/macos-voice-control}"

echo "Starting Git Client for repository: $REPO_PATH"

# Change to git-client directory
cd "$(dirname "$0")"

# Start Electron app
npx electron electron-main.js "$REPO_PATH"