# Gemini Narrator Component

This component provides voice narration for Claude Code output using the Gemini Live API.

## Setup

1. Install dependencies:
```bash
pip install google-genai pyaudio
```

2. Set your Google API key:
```bash
export GOOGLE_API_KEY="your-api-key-here"
```

3. Ensure Claude Code hooks are configured to generate transcripts at:
   `/Users/felixlunzenfichter/Documents/claude-transcripts/latest.html`

## Usage

Run the narrator:
```bash
python gemini-narrator.py
```

The narrator will:
- Monitor for new Claude transcripts
- Announce what Claude has completed
- Say "Claude is ready for your next request"
- Answer your questions about the work

## Important Notes

- Use headphones to prevent echo/feedback
- The narrator checks for transcript updates every 2 seconds
- You can speak at any time to ask questions about Claude's work