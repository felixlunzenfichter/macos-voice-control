#!/bin/bash

echo "Starting local transcription backend..."
echo "Make sure you have set GOOGLE_APPLICATION_CREDENTIALS environment variable"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the server
echo "Starting server on http://localhost:8080"
echo "WebSocket endpoint: ws://localhost:8080"
echo ""
npm start