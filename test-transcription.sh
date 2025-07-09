#!/bin/bash

echo "Testing Speech Transcription System"
echo "===================================="

# Kill any existing processes
echo "1. Cleaning up existing processes..."
pkill -f "node.*server.js" || true
tmux kill-server 2>/dev/null || true
sleep 2

# Start backend with Google credentials
echo "2. Starting backend server..."
cd /Users/felixlunzenfichter/Documents/ClaudeCodeVoiceControl-Stable/backend
export GOOGLE_APPLICATION_CREDENTIALS=/tmp/speech-key.json
tmux new-session -d -s backend "node server.js 2>&1 | tee /tmp/backend.log"
sleep 3

# Start Mac receiver
echo "3. Starting Mac receiver..."
cd /Users/felixlunzenfichter/Documents/ClaudeCodeVoiceControl-Stable/mac-transcription-server
tmux new-session -d -s mac-receiver "BACKEND_URL=ws://localhost:8080 node server.js 2>&1 | tee /tmp/mac-receiver.log"
sleep 2

# Check connections
echo "4. Checking connections..."
echo "Backend log:"
tail -10 /tmp/backend.log

echo ""
echo "Mac receiver log:"
tail -10 /tmp/mac-receiver.log

echo ""
echo "Active tmux sessions:"
tmux ls

echo ""
echo "Test complete. Now connect with iPhone/iPad app to test transcription."
echo "Monitor logs with:"
echo "  tail -f /tmp/backend.log"
echo "  tail -f /tmp/mac-receiver.log"