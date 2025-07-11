#!/bin/bash

echo "Manual Help Button Test Instructions"
echo "===================================="
echo ""
echo "Since the test targets aren't configured in Xcode, let's do a manual test:"
echo ""
echo "1. Installing app on iPad..."

# Install the app on iPad
xcrun devicectl device install app \
  --device 00008101-001445383A3A601E \
  build/Build/Products/Debug-iphoneos/ClaudeCodeMicrophone.app

echo ""
echo "2. Launching app on iPad..."

# Launch the app
xcrun devicectl device process launch \
  --device 00008101-001445383A3A601E \
  com.felixlunzenfichter.ClaudeCodeMicrophone

echo ""
echo "3. MANUAL TEST STEPS:"
echo "   - Look at your iPad"
echo "   - You should see the app with an orange Help button in the bottom left"
echo "   - Press the Help button"
echo "   - Watch the terminal to see if the emergency message appears"
echo ""
echo "Expected result: The message 'HELP BUTTON PRESSED: User cannot interact...' should be typed in the terminal"
echo ""
echo "Press Ctrl+C when done testing."

# Keep script running to monitor logs
tail -f /tmp/mac-server.log 2>/dev/null || echo "No mac-server log found. Make sure services are running."