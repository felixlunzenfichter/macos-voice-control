# Server Deployment Guide

## Verify Services Are Running

**Note:** If services are already running successfully, there's no need to redeploy.

### Check all tmux sessions:
```bash
tmux list-sessions
```

Should show:
- backend: 1 windows
- mac-server: 1 windows

### View Central Logging System

```bash
# Convert JSON logs to readable text format (sorted by time)
node /Users/felixlunzenfichter/Documents/macos-voice-control/logs/json-to-text.js

# Check most recent logs
tail -50 /Users/felixlunzenfichter/Documents/macos-voice-control/logs/logs.txt
```

### Verify System Startup
Look for these startup success patterns:
```
LOG | backend | startup | WebSocket server created
LOG | backend | startup | Google Speech client initialized  
LOG | backend | startup | Server running on port 8080
LOG | mac-server | startup | Mac Server started
LOG | mac-server | startup | ✅ TTS enabled with OpenAI
LOG | mac-server | connect | Connected to transcription backend
```

### Verify TTS Response
```bash
# Check for TTS activity (Claude speaking back)
grep -E "Adding to queue|Playing audio" /Users/felixlunzenfichter/Documents/macos-voice-control/logs/logs.txt | tail -5
```

Should show:
```
LOG | mac-server | narrate | 🗣️ Adding to queue | {"voice":"fable","textLength":N}
LOG | mac-server | processAudioQueue | ▶️ Processing from queue
LOG | mac-server | playAudio | ▶️ Playing audio (PID: [process_id])
```

### Verify Client Connections
```bash
# Check for client identification logs
grep "Client identified as:" /Users/felixlunzenfichter/Documents/macos-voice-control/logs/logs.txt | tail -5
```

Should show:
```
LOG | backend | onMessage | Client identified as: receiver (Mac Server)
LOG | backend | onMessage | Client identified as: transcriber (iPhone Transcriber)
```

### **Verify Active Transcription - THE GOAL**
**Keep checking until you succeed - the goal is that you can speak and get transcription:**

```bash
# Check for recent transcription activity
grep -E "Received audio data|Interim transcript|Final transcript" /Users/felixlunzenfichter/Documents/macos-voice-control/logs/logs.txt | tail -10
```

**Important:** Verify the timestamps in the logs are after the current time. This confirms you're seeing fresh transcription activity, not old logs.

Should show:
```
LOG | backend | onMessage | Received audio data: 3200 bytes
LOG | backend | recognizeStream | Interim transcript | {"transcript":"[text]","isFinal":false}
LOG | backend | recognizeStream | Final transcript | {"transcript":"[complete text]","isFinal":true}
LOG | mac-server | handleMessage | Final transcript: "[complete text]"
```

**If you don't see transcription activity, iPhone may not be connected properly. Deploy iPhone app and check common issues below.**

## Deployment

### CRITICAL: Always use these exact commands to deploy the servers

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

**CRITICAL: NEVER open Xcode GUI - always deploy through command line only**

```bash
cd "/Users/felixlunzenfichter/Documents/macos-voice-control/iOS app"
./run-on-iphone.sh
```

**Before deployment, verify device ID:**
```bash
# Check connected devices
xcrun devicectl list devices

# Update device ID in run-on-iphone.sh if needed (line 10 and 24)
# Current device ID: 00008101-000359212650001E
```

The script will:
1. Build the app using xcodebuild (command line only)
2. Install to iPhone using devicectl
3. Launch the ClaudeCodeMicrophone app
4. App starts recording when you tilt phone forward (pitch < -45°)

## Common Issues

### "Recognition error: Error: The file at ... does not exist"
The backend is using the wrong Google credentials path. Kill and restart with the correct path above.

### iPhone not connecting / No transcriber logs
1. **Check backend URL configuration:**
   ```bash
   # Check xcconfig files for backend configuration
   cat "/Users/felixlunzenfichter/Documents/macos-voice-control/iOS app/Debug.xcconfig"
   cat "/Users/felixlunzenfichter/Documents/macos-voice-control/iOS app/Release.xcconfig"
   ```
   BACKEND_HOST should match your Mac's IP address (usually 192.168.x.x)
   BACKEND_PORT should be 8080

2. **Update backend URL if IP address changed:**
   ```bash
   # Get current Mac IP address
   ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'
   
   # Update xcconfig files with new IP
   cd "/Users/felixlunzenfichter/Documents/macos-voice-control/iOS app"
   # Edit Debug.xcconfig and Release.xcconfig to update BACKEND_HOST
   ```

3. **Check device ID:**
   ```bash
   # List connected devices
   xcrun devicectl list devices
   
   # Update device ID in run-on-iphone.sh if needed (lines 10 and 24)
   ```

4. **Redeploy iPhone app:**
   ```bash
   cd "/Users/felixlunzenfichter/Documents/macos-voice-control/iOS app"
   ./run-on-iphone.sh
   ```
   **NEVER open Xcode GUI - always use command line deployment**

### "No receivers connected - skipping speech recognition"
The Mac server is not connected. Check if mac-server tmux session is running.

### Services not starting
If you're not getting successful transcription, try restarting the sessions. If you get successful transcription, don't kill the sessions.

