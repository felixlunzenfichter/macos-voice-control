#!/bin/bash

# Start Claude Root Orchestrator
echo "Starting Claude Root Orchestrator..."

# Kill any existing session
tmux kill-session -t claude_orchestrator 2>/dev/null

# Clear worker tracking file
echo "" > /tmp/claude_workers.jsonl

# Create new session with Claude in root directory
tmux new-session -d -s claude_orchestrator 'cd /Users/felixlunzenfichter && claude --dangerously-skip-permissions'

# Wait for Claude to start
sleep 2

# Define worker management functions in the session
tmux send-keys -t claude_orchestrator '# Function to spawn and track workers
spawn_worker() {
  local WORKER_NAME=$1
  local WORK_DIR=$2
  
  # Spawn worker and capture pane ID
  local PANE_ID=$(tmux split-window -h -P -F "#{pane_id}" "cd $WORK_DIR && claude --dangerously-skip-permissions")
  
  # Set pane ID as variable
  eval "export $WORKER_NAME=$PANE_ID"
  
  # Adjust layout for even distribution
  tmux select-layout even-horizontal
  
  # Track in file for stop button system
  echo "{\"name\": \"$WORKER_NAME\", \"paneId\": \"$PANE_ID\"}" >> /tmp/claude_workers.jsonl
  
  echo $PANE_ID
}

# Function to kill workers cleanly
kill_worker() {
  local PANE_ID=$1
  
  # Kill the pane
  tmux kill-pane -t "$PANE_ID"
  
  # Rebalance windows
  tmux select-layout even-horizontal
  
  # Remove from tracking file
  grep -v "\"paneId\": \"$PANE_ID\"" /tmp/claude_workers.jsonl > /tmp/claude_workers.tmp
  mv /tmp/claude_workers.tmp /tmp/claude_workers.jsonl
}' && tmux send-keys -t claude_orchestrator Enter

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