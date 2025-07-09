#!/bin/bash

echo "Starting all voice control services..."

# Start Mac receiver (connects to backend and types transcriptions)
echo "Starting Mac receiver..."
tmux new-session -d -s mac-receiver "cd /Users/felixlunzenfichter/Documents/ClaudeCodeVoiceControl-Stable/mac-transcription-server && node server.js"

# Give it time to connect
sleep 2

# Start TTS narrator
echo "Starting TTS narrator..."
tmux new-session -d -s narrator "cd /Users/felixlunzenfichter/Documents/macos-voice-control && python3 openai-tts-narrator.py"

echo "All services started!"
echo ""
echo "View logs with:"
echo "  tmux attach -t mac-receiver"
echo "  tmux attach -t narrator"