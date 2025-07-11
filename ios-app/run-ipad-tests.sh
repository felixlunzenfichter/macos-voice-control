#!/bin/bash

# Automated iPad Test Runner
# Runs tests on iPad without manual interaction

echo "🧪 Running automated tests on iPad..."

# Run the UI test that simulates Help button press
xcodebuild test \
  -project ClaudeCodeMicrophone.xcodeproj \
  -scheme ClaudeCodeMicrophone \
  -destination "platform=iOS,id=00008101-001445383A3A601E" \
  -only-testing:ClaudeCodeMicrophoneUITests/HelpButtonUITests \
  -derivedDataPath build \
  -quiet

# Check test results
if [ $? -eq 0 ]; then
    echo "✅ iPad tests passed!"
    
    # Run our backend test to verify the message was received
    cd ../tests
    node test-help-button.js
else
    echo "❌ iPad tests failed"
    exit 1
fi