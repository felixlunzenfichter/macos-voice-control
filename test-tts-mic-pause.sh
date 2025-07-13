#!/bin/bash

# Test script for TTS automatic pausing when mic is active

echo "=== TTS Mic Pause Test ==="
echo "This script tests the automatic TTS pausing feature"
echo ""

# Check if services are running
echo "1. Checking if backend is running..."
if tmux list-sessions 2>/dev/null | grep -q backend; then
    echo "✅ Backend is running"
else
    echo "❌ Backend is not running. Please start it with:"
    echo "   cd backend && tmux new-session -d -s backend 'GOOGLE_APPLICATION_CREDENTIALS=/Users/felixlunzenfichter/.config/gcloud/legacy_credentials/id-speech-to-text-app@gen-lang-client-0047710702.iam.gserviceaccount.com/adc.json node server.js'"
    exit 1
fi

echo ""
echo "2. Checking if mac-server is running..."
if tmux list-sessions 2>/dev/null | grep -q mac-server; then
    echo "✅ Mac server is running"
else
    echo "❌ Mac server is not running. Please start it with:"
    echo "   cd mac-server && tmux new-session -d -s mac-server 'npm start'"
    exit 1
fi

echo ""
echo "=== Test Instructions ==="
echo "1. Ensure your iPhone app is connected (check the status indicators)"
echo "2. Have Claude or another process generate some TTS output"
echo "3. While TTS is playing, tilt your iPhone to start transcription (green indicator)"
echo "4. Verify that:"
echo "   - TTS immediately stops and queue is cleared when iPhone starts recording"
echo "   - Old audio is NOT played when iPhone stops recording"
echo "   - Only NEW audio created after mic stops is played"
echo ""
echo "=== Test Queue Clearing ==="
echo "1. Queue up multiple TTS messages (have Claude speak multiple lines)"
echo "2. Start iPhone recording while audio is queued"
echo "3. Verify entire queue is cleared (check logs for queue length)"
echo "4. Stop recording and verify only new audio plays"
echo ""
echo "=== Test TTS Toggle ==="
echo "1. Queue up TTS messages"
echo "2. Toggle TTS off/on using the iPhone button"
echo "3. Verify queue is cleared on ANY toggle (both off and on)"
echo ""
echo "=== Monitoring Logs ==="
echo "You can monitor the behavior in the mac-server logs:"
echo "   tmux attach -t mac-server"
echo ""
echo "Look for these log messages:"
echo "   🎤 Mic status changed: ACTIVE/INACTIVE"
echo "   🛑 Stopping audio - mic is active"
echo "   🗑️  Cleared audio queue (X items removed)"
echo "   ▶️  Mic inactive - ready for new audio"
echo ""
echo "Press Ctrl+C to exit this test"

# Keep the script running to allow monitoring
while true; do
    sleep 1
done