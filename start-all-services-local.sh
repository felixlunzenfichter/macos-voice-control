#!/bin/bash

echo "Starting all voice control services locally..."

# Kill any existing services
pkill -f "node.*backend/server.js" 2>/dev/null
pkill -f "node.*mac-transcription-server/server.js" 2>/dev/null
pkill -f "python.*tts-narrator" 2>/dev/null

# Start backend locally
echo "Starting backend server locally..."
tmux new-session -d -s backend "cd /Users/felixlunzenfichter/Documents/macos-voice-control/backend && PORT=8080 node server.js"

# Give it time to start
sleep 2

# Start Mac receiver (with local backend)
echo "Starting Mac receiver..."
tmux new-session -d -s mac-receiver "cd /Users/felixlunzenfichter/Documents/ClaudeCodeVoiceControl-Stable/mac-transcription-server && BACKEND_URL=ws://localhost:8080 node server.js"

# Start TTS narrator
echo "Starting TTS narrator..."
tmux new-session -d -s narrator "cd /Users/felixlunzenfichter/Documents/macos-voice-control && python3 openai-tts-narrator.py"

echo "All services started locally!"
echo ""
echo "View logs with:"
echo "  tmux attach -t backend"
echo "  tmux attach -t mac-receiver"
echo "  tmux attach -t narrator"
echo ""
echo "Note: iPhone app needs to be updated to use local backend (ws://YOUR_MAC_IP:8080)"