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
- `openai-tts-narrator.py`: OpenAI-based text-to-speech narrator
- `gemini-narrator.py`: Gemini-based narrator (alternative)
- `iphone-transcription-app/`: iOS app for voice transcription