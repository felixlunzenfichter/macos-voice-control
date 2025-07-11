#!/bin/bash

# View logs from ClaudeCodeMicrophone app
echo "📱 Viewing logs from ClaudeCodeMicrophone..."
echo "Tilt your phone forward (pitch < -45°) to start transcription"
echo "----------------------------------------"

# Use devicectl to view logs from iPhone
xcrun devicectl device log stream --device 3EAB31EB-008E-587D-BD01-D3F7452F8CDB --predicate 'subsystem == "com.felixlunzenfichter.ClaudeCodeMicrophone"' | while read line; do
    echo "$line"
done