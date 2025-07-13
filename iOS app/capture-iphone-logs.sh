#!/bin/bash

echo "📱 Capturing iPhone console logs for ClaudeCodeMicrophone..."
echo "Tilt your phone forward to trigger transcription"
echo "Press Ctrl+C to stop"
echo "----------------------------------------"

# Stream logs from the device, filtering for our app
log stream --device "Felix" --predicate 'processImagePath CONTAINS "ClaudeCodeMicrophone"' --style compact | while IFS= read -r line; do
    echo "$line"
done