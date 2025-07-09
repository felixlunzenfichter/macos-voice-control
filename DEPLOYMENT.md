# Server Deployment Guide

## CRITICAL: Always use these exact commands to deploy the servers

### 1. Backend Server (MUST have Google credentials)
```bash
tmux kill-session -t backend 2>/dev/null
cd /Users/felixlunzenfichter/Documents/macos-voice-control/backend
tmux new-session -d -s backend "GOOGLE_APPLICATION_CREDENTIALS=/Users/felixlunzenfichter/.config/gcloud/legacy_credentials/id-speech-to-text-app@gen-lang-client-0047710702.iam.gserviceaccount.com/adc.json node server.js"
```

**IMPORTANT**: The backend WILL NOT WORK without the GOOGLE_APPLICATION_CREDENTIALS environment variable pointing to the correct file.

### 2. Mac Server (Handles transcription typing and TTS)
```bash
tmux kill-session -t mac-server 2>/dev/null
cd /Users/felixlunzenfichter/Documents/macos-voice-control/mac-server
tmux new-session -d -s mac-server "npm start"
```

### 3. iPhone App Deployment
```bash
cd /Users/felixlunzenfichter/Documents/macos-voice-control/iphone-transcription-app
./run-on-iphone.sh
```

## Verify Services Are Running

### Check all tmux sessions:
```bash
tmux list-sessions
```

Should show:
- backend: 1 windows
- mac-server: 1 windows

### Check backend is working:
```bash
tmux capture-pane -t backend -p | tail -20
```

Should show:
- "Server running on port 8080"
- "Client identified as: receiver (Mac Server)"
- "Client identified as: transcriber (iPhone Transcriber)"
- NO "Recognition error" messages

### Check Mac server is working:
```bash
tmux capture-pane -t mac-server -p | tail -10
```

Should show:
- "Connected to transcription backend"
- "✅ TTS enabled with OpenAI"

## Common Issues

### "Recognition error: Error: The file at ... does not exist"
The backend is using the wrong Google credentials path. Kill and restart with the correct path above.

### "Unknown message type: pong"
The backend needs the pong handler. This has been fixed in the code.

### "No receivers connected - skipping speech recognition"
The Mac server is not connected. Check if mac-server tmux session is running.

### Services not starting
Always kill existing sessions before starting new ones to avoid port conflicts.

## Quick Restart All Services
```bash
# Kill all
tmux kill-session -t backend 2>/dev/null
tmux kill-session -t mac-server 2>/dev/null

# Start backend with credentials
cd /Users/felixlunzenfichter/Documents/macos-voice-control/backend
tmux new-session -d -s backend "GOOGLE_APPLICATION_CREDENTIALS=/Users/felixlunzenfichter/.config/gcloud/legacy_credentials/id-speech-to-text-app@gen-lang-client-0047710702.iam.gserviceaccount.com/adc.json node server.js"

# Start Mac server
cd /Users/felixlunzenfichter/Documents/macos-voice-control/mac-server
tmux new-session -d -s mac-server "npm start"

# Wait for services to connect
sleep 3

# Check status
tmux capture-pane -t backend -p | tail -5
```