#!/bin/bash

# Git Client Catastrophe Cleanup Script
# This script cleans up the multiple git client instances that caused system crash

echo "=== Git Client Catastrophe Cleanup ==="
echo "Starting cleanup of multiple git client instances..."

# 1. Kill the tmux session that's spawning git clients
echo "Step 1: Killing git-client tmux session..."
tmux kill-session -t git-client 2>/dev/null && echo "✓ Killed git-client tmux session" || echo "✗ No git-client tmux session found"

# 2. Kill all electron processes related to git client
echo -e "\nStep 2: Killing all electron processes..."
ELECTRON_COUNT=$(ps aux | grep -E "electron.*electron-main\.js.*macos-voice-control" | grep -v grep | wc -l)
echo "Found $ELECTRON_COUNT electron processes to kill"

# Kill electron main processes
pkill -f "electron.*electron-main\.js.*macos-voice-control" 2>/dev/null
sleep 1

# Kill electron helper processes
pkill -f "Electron Helper.*macos-voice-control" 2>/dev/null
sleep 1

# Kill any remaining electron processes
pkill -f "electron.*git-client" 2>/dev/null
sleep 1

# 3. Kill any npm/node processes related to git client
echo -e "\nStep 3: Killing npm/node processes..."
pkill -f "npm.*electron.*macos-voice-control" 2>/dev/null
pkill -f "node.*electron.*macos-voice-control" 2>/dev/null

# 4. Kill any remaining bash processes running start-git-client.sh
echo -e "\nStep 4: Killing bash startup scripts..."
pkill -f "bash.*start-git-client\.sh" 2>/dev/null
pkill -f "sh.*start-git-client\.sh" 2>/dev/null

# 5. Clean up log files to prevent feedback loop on restart
echo -e "\nStep 5: Rotating log files..."
LOG_DIR="/Users/felixlunzenfichter/Documents/macos-voice-control/logs"
if [ -d "$LOG_DIR/legacy" ]; then
    # Move current log to legacy with timestamp
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    if [ -f "$LOG_DIR/git-client-logs.log" ]; then
        mv "$LOG_DIR/git-client-logs.log" "$LOG_DIR/legacy/${TIMESTAMP}_git-client-logs.log" 2>/dev/null
        echo "✓ Moved git-client-logs.log to legacy"
    fi
else
    echo "✗ Legacy directory not found, skipping log rotation"
fi

# 6. Verify cleanup
echo -e "\nStep 6: Verifying cleanup..."
REMAINING_ELECTRON=$(ps aux | grep -E "electron.*electron-main\.js.*macos-voice-control" | grep -v grep | wc -l)
REMAINING_NPM=$(ps aux | grep -E "npm.*electron.*macos-voice-control" | grep -v grep | wc -l)
REMAINING_BASH=$(ps aux | grep -E "bash.*start-git-client\.sh" | grep -v grep | wc -l)

echo "Remaining processes:"
echo "  - Electron processes: $REMAINING_ELECTRON"
echo "  - NPM processes: $REMAINING_NPM"  
echo "  - Bash startup scripts: $REMAINING_BASH"

if [ $REMAINING_ELECTRON -eq 0 ] && [ $REMAINING_NPM -eq 0 ] && [ $REMAINING_BASH -eq 0 ]; then
    echo -e "\n✅ Cleanup successful! All git client processes terminated."
else
    echo -e "\n⚠️  Some processes may still be running. You may need to run this script again or use:"
    echo "    sudo killall -9 Electron"
fi

echo -e "\n=== Cleanup Complete ==="
echo "Next steps:"
echo "1. Fix the electron-main.js file to add single instance lock"
echo "2. Fix the chokidar watcher to properly exclude logs directory"
echo "3. Use tmux to start git client with proper controls"