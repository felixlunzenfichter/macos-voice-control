#!/bin/bash

# Run on iPhone script for ClaudeCodeMicrophone

echo "Building for iPhone..."

# Build and run using xcodebuild
xcodebuild -project ClaudeCodeMicrophone.xcodeproj \
  -scheme ClaudeCodeMicrophone \
  -destination 'id=00008101-000359212650001E' \
  -configuration Debug \
  -derivedDataPath build \
  clean build

if [ $? -eq 0 ]; then
    echo "** BUILD SUCCEEDED **"
    echo "Installing and running on iPhone..."
    
    # Get the app path
    APP_PATH=$(find build/Build/Products -name "ClaudeCodeMicrophone.app" | head -1)
    
    if [ -n "$APP_PATH" ]; then
        # Install and launch using devicectl
        xcrun devicectl device install app --device 00008101-000359212650001E "$APP_PATH"
        
        if [ $? -eq 0 ]; then
            echo "App installed: com.felixlunzenfichter.ClaudeCodeMicrophone"
            # Launch the app
            xcrun devicectl device process launch --device 00008101-000359212650001E com.felixlunzenfichter.ClaudeCodeMicrophone
            
            if [ $? -eq 0 ]; then
                echo "Launched application"
                echo ""
                echo "SUCCESS: ClaudeCodeMicrophone is now running on your iPhone!"
                echo "Tilt your phone forward (pitch < -45°) to start recording"
            else
                echo "ERROR: Failed to launch app"
            fi
        else
            echo "ERROR: Failed to install app"
        fi
    else
        echo "ERROR: Could not find built app"
    fi
else
    echo "** BUILD FAILED **"
    echo "Check the error messages above"
fi