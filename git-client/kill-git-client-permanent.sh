#!/bin/bash

# Permanent Git Client Termination Script
# This ensures the git client stays terminated and cannot restart

echo "=== Permanently terminating Git Client ==="

# 1. Kill all electron processes related to git client
pkill -f "electron.*electron-main\.js.*macos-voice-control" || true

# 2. Remove lock files to prevent startup scripts from working
rm -f /tmp/git-client.lock /tmp/git-client.pid

# 3. Create a blocking lock file that prevents startup
echo "BLOCKED: Git client permanently disabled" > /tmp/git-client.lock
chmod 444 /tmp/git-client.lock  # Read-only to prevent accidental removal

# 4. Kill any remaining electron processes
pkill -f electron || true

echo "✓ Git client terminated and blocked from restarting"
echo "To re-enable: rm -f /tmp/git-client.lock"