const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
require('dotenv').config();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'wss://speech-transcription-1007452504573.us-central1.run.app';
const RECONNECT_DELAY = 5000; // 5 seconds

class TranscriptionReceiver {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
  }

  connect() {
    console.log(`Connecting to backend: ${BACKEND_URL}`);
    
    this.ws = new WebSocket(BACKEND_URL);

    this.ws.on('open', () => {
      console.log('Connected to transcription backend');
      this.isConnected = true;
      
      // Send identification as receiver
      this.ws.send(JSON.stringify({
        type: 'identify',
        clientType: 'receiver',
        clientName: 'Mac Receiver',
        platform: 'mac'
      }));
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('Disconnected from backend');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error.message);
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connection':
        console.log('Backend says:', message.message);
        break;
        
      case 'transcript':
        if (message.isFinal) {
          console.log(`Final transcript: "${message.transcript}"`);
          this.typeTranscription(message.transcript);
        } else {
          console.log(`Interim: "${message.transcript}"`);
        }
        break;
        
      case 'error':
        console.error('Backend error:', message.error);
        break;
        
      case 'ping':
        // Respond to health check
        this.ws.send(JSON.stringify({
          type: 'pong',
          pingId: message.pingId
        }));
        break;
        
      case 'keyPress':
        // Handle key press events
        console.log(`Received key press: ${message.key}`);
        this.simulateKeyPress(message.key);
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  typeTranscription(text) {
    if (!text || text.trim() === '') return;
    
    // Write text to temporary file to avoid escaping issues
    const fs = require('fs');
    const tempFile = `/tmp/transcription_${Date.now()}.txt`;
    fs.writeFileSync(tempFile, text);
    
    // AppleScript to read from file and type
    const script = `
      set textContent to read POSIX file "${tempFile}" as string
      
      -- Bring Terminal to the foreground
      tell application "Terminal"
        activate
      end tell
      
      -- Small delay to ensure Terminal is active
      delay 0.1
      
      -- Type the text into Terminal
      tell application "System Events"
        keystroke textContent
        delay 1
        key code 36
      end tell
      
      do shell script "rm ${tempFile}"
    `;
    
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        console.error('Error typing text:', error);
        // Clean up temp file on error
        try { fs.unlinkSync(tempFile); } catch (e) {}
      } else {
        console.log('Typed successfully');
      }
    });
  }

  simulateKeyPress(key) {
    // Map key names to AppleScript key codes
    const keyMap = {
      'escape': '53',  // Escape key
      'return': '36',  // Return/Enter key
      'tab': '48',     // Tab key
      'space': '49',   // Space key
      'delete': '51',  // Delete key
      'up': '126',     // Up arrow
      'down': '125',   // Down arrow
      'left': '123',   // Left arrow
      'right': '124'   // Right arrow
    };
    
    const keyCode = keyMap[key.toLowerCase()];
    
    if (keyCode) {
      // Use key code for special keys
      const script = `
        tell application "Terminal"
          activate
        end tell
        
        delay 0.1
        
        tell application "System Events"
          key code ${keyCode}
        end tell
      `;
      
      exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error simulating ${key} key:`, error);
        } else {
          console.log(`Simulated ${key} key press`);
        }
      });
    } else {
      // For regular characters, use keystroke
      const script = `
        tell application "Terminal"
          activate
        end tell
        
        delay 0.1
        
        tell application "System Events"
          keystroke "${key}"
        end tell
      `;
      
      exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error typing ${key}:`, error);
        } else {
          console.log(`Typed ${key}`);
        }
      });
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    console.log(`Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY);
  }

  stop() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Start the receiver
const receiver = new TranscriptionReceiver();
receiver.connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  receiver.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  receiver.stop();
  process.exit(0);
});

console.log('Mac Transcription Server started');
console.log('Press Ctrl+C to stop');
console.log('');
console.log('Make sure to grant Terminal accessibility permissions in:');
console.log('System Settings > Privacy & Security > Accessibility');