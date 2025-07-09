# macOS Voice Control Project

## Project Structure
- `backend/`: Node.js backend server for WebSocket communication and Google Speech-to-Text
- `mac-server/`: Mac server that handles both transcription typing and TTS narration
- `iphone-transcription-app/`: iOS app for voice transcription

## Service Management

### CRITICAL DEPLOYMENT INSTRUCTIONS
**See DEPLOYMENT.md for exact commands. The backend MUST have Google credentials or transcription will fail.**

### Quick Start All Services:
```bash
# Backend with Google credentials (REQUIRED)
cd /Users/felixlunzenfichter/Documents/macos-voice-control/backend
tmux new-session -d -s backend "GOOGLE_APPLICATION_CREDENTIALS=/Users/felixlunzenfichter/.config/gcloud/legacy_credentials/id-speech-to-text-app@gen-lang-client-0047710702.iam.gserviceaccount.com/adc.json node server.js"

# Mac server
cd /Users/felixlunzenfichter/Documents/macos-voice-control/mac-server  
tmux new-session -d -s mac-server "npm start"
```

### Mac Server (Unified Service)
The Mac server handles both voice transcription typing and TTS narration in a single Node.js process:

```bash
# Start the Mac server
tmux new-session -d -s mac-server "cd mac-server && npm start"

# Check if it's running
tmux ls | grep mac-server

# Attach to view logs
tmux attach -t mac-server

# Kill the service
tmux kill-session -t mac-server

# View logs
tail -f /tmp/mac-server.log
```

**Features:**
- Voice transcription typing via AppleScript
- TTS narration using OpenAI's API
- Instant audio stopping using play-sound package
- WebSocket communication with backend
- Real-time Claude transcript monitoring

**Environment Requirements:**
- OPENAI_API_KEY in .env file for TTS functionality
- BACKEND_URL (defaults to ws://192.168.1.9:8080)

**IMPORTANT**: The Mac server combines all Mac-side functionality:
- Only one service to manage
- Immediate audio stopping when TTS is toggled off
- Consolidated logging and monitoring
- No duplicate processes or conflicts