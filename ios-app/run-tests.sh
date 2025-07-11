#!/bin/bash

# Run automated UI tests on iPhone/iPad
# Usage: ./run-tests.sh

echo "Running Help Button UI Tests..."

# Run on connected device
xcodebuild test \
  -project ClaudeCodeMicrophone.xcodeproj \
  -scheme ClaudeCodeMicrophone \
  -destination "platform=iOS,id=00008101-001445383A3A601E" \
  -only-testing:ClaudeCodeMicrophoneUITests/HelpButtonUITests/testHelpButtonPress

# Alternative: Run on iPad
# xcodebuild test \
#   -workspace ClaudeCodeMicrophone.xcworkspace \
#   -scheme ClaudeCodeMicrophone \
#   -destination "platform=iOS,id=00008101-001445383A3A601E" \
#   -only-testing:ClaudeCodeMicrophoneUITests/HelpButtonUITests/testHelpButtonPress