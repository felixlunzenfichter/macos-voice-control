#!/bin/bash

# Safe Git Client Startup Script
# This script starts the git client with safety checks to prevent multiple instances

REPO_PATH="${1:-/Users/felixlunzenfichter/Documents/macos-voice-control}"
LOCK_FILE="/tmp/git-client.lock"
PID_FILE="/tmp/git-client.pid"

echo "=== Safe Git Client Startup ==="
echo "Repository: $REPO_PATH"

# Check if lock file exists
if [ -f "$LOCK_FILE" ]; then
    echo "⚠️  Lock file exists. Checking if git client is actually running..."
    
    # Check if the PID in the lock file is still running
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if ps -p "$OLD_PID" > /dev/null 2>&1; then
            echo "❌ Git client is already running (PID: $OLD_PID)"
            echo "Use cleanup-git-client-catastrophe.sh to force cleanup if needed"
            exit 1
        else
            echo "✓ Old process not found. Cleaning up stale lock..."
            rm -f "$LOCK_FILE" "$PID_FILE"
        fi
    else
        echo "✓ No PID file found. Cleaning up stale lock..."
        rm -f "$LOCK_FILE"
    fi
fi

# Check if any electron processes are already running
EXISTING=$(ps aux | grep -E "electron.*electron-main\.js.*macos-voice-control" | grep -v grep | wc -l)
if [ $EXISTING -gt 0 ]; then
    echo "❌ Found $EXISTING existing electron processes for git client"
    echo "Run cleanup-git-client-catastrophe.sh first"
    exit 1
fi

# Create lock file
touch "$LOCK_FILE"

# Change to git-client directory
cd "$(dirname "$0")"

echo "✓ Starting git client safely..."

# Start electron and save PID
npx electron electron-main.js "$REPO_PATH" &
ELECTRON_PID=$!
echo $ELECTRON_PID > "$PID_FILE"

echo "✓ Git client started (PID: $ELECTRON_PID)"

# Wait for electron to exit
wait $ELECTRON_PID

# Cleanup lock files when done
rm -f "$LOCK_FILE" "$PID_FILE"
echo "✓ Git client exited cleanly"