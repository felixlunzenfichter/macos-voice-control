# macOS Voice Control Project

## Python Environment Setup

### Running Python Scripts
All Python scripts in this project should be run with the Homebrew Python 3.13 that has the required packages installed:

```bash
# For openai-tts-narrator.py
/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python openai-tts-narrator.py

# For gemini-narrator.py  
/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python gemini-narrator.py

# For other Python scripts
/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python <script_name>.py
```

### Required Python Packages
The following packages are required and are installed in the Homebrew Python environment:
- openai (for OpenAI TTS)
- websockets (for WebSocket connections)
- pyaudio (for audio playback)
- google-generativeai (for Gemini narrator)

### Important Notes
- DO NOT use pip install directly without --user and --break-system-packages flags
- The correct Python interpreter is the Homebrew Python at `/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python`
- All packages are installed with --user flag to avoid system conflicts
- If you see ModuleNotFoundError, you're using the wrong Python interpreter

## Running the TTS Narrator
To start the TTS narrator with the correct Python:
```bash
cd /Users/felixlunzenfichter/Documents/macos-voice-control
/opt/homebrew/Cellar/python@3.13/3.13.5/Frameworks/Python.framework/Versions/3.13/Resources/Python.app/Contents/MacOS/Python openai-tts-narrator.py
```

## Project Structure
- `backend/`: Node.js backend server for WebSocket communication
- `mac-server/`: Mac server that handles both transcription typing and TTS narration
- `openai-tts-narrator.py`: Legacy OpenAI-based text-to-speech narrator (replaced by mac-server)
- `gemini-narrator.py`: Legacy Gemini-based narrator (alternative)
- `iphone-transcription-app/`: iOS app for voice transcription

## Service Management

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