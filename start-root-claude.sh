#!/bin/bash

# Start Claude Root Orchestrator
echo "Starting Claude Root Orchestrator..."

# Kill any existing session
tmux kill-session -t claude_orchestrator 2>/dev/null

# Clear worker tracking file
echo "" > /tmp/claude_workers.jsonl

# Spawn voice control startup worker using raw tmux
tmux new-session -d -s voice_startup_worker "cd /Users/felixlunzenfichter/Documents/macos-voice-control && claude --model opus --dangerously-skip-permissions"
sleep 3

# Send initial message defining the worker's task
tmux send-keys -t voice_startup_worker 'Your task: Follow DEPLOYMENT.md quick restart commands to start backend and mac-server services. Verify they are running with status checks. When complete, terminate yourself with: tmux kill-session -t voice_startup_worker' Enter

# Create new session with Claude in root directory using Sonnet for fast response
tmux new-session -d -s claude_orchestrator "cd /Users/felixlunzenfichter && claude --model sonnet --dangerously-skip-permissions"

# Wait for Claude to start
sleep 2

# Send command to read CLAUDE.md and confirm understanding
tmux send-keys -t claude_orchestrator "Read /Users/felixlunzenfichter/CLAUDE.md and then briefly explain what you understand about your role." && tmux send-keys -t claude_orchestrator Enter

# Open new Terminal window and attach to the session
echo "Opening new Terminal window..."
osascript -e '
tell application "Terminal"
    set newWindow to do script "tmux attach -t claude_orchestrator"
    delay 0.5
    tell application "System Events" to tell process "Terminal"
        set value of attribute "AXFullScreen" of window 1 to true
    end tell
end tell'