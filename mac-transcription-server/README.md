# Mac Transcription Server

This server receives transcriptions from the iOS app via the backend and types them into Claude Code.

## Usage

1. Start the server:
```bash
npm start
```

2. Make sure Terminal has accessibility permissions in System Settings

3. The server will:
   - Connect to the backend as a "receiver"
   - Listen for transcriptions from iOS devices
   - Type final transcriptions into the active application (Claude Code)

## Testing

To verify it's working:
1. Start this server
2. Start the iOS app 
3. Speak into iOS device
4. Transcriptions should appear in Claude Code terminal

## Note

This replaces the live-transcription-app for Claude Code voice control.