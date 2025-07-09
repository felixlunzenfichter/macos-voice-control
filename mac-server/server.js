const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const player = require('play-sound')();
require('dotenv').config();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'ws://192.168.1.9:8080';
const RECONNECT_DELAY = 5000; // 5 seconds
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI client if API key exists
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

class MacServer {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.ttsEnabled = true;
    this.currentAudioProcess = null;
    this.filePositions = {};
    this.transcriptMonitorInterval = null;
  }

  connect() {
    console.log(`Connecting to backend: ${BACKEND_URL}`);
    
    this.ws = new WebSocket(BACKEND_URL);

    this.ws.on('open', () => {
      console.log('Connected to transcription backend');
      this.isConnected = true;
      
      // Send identification as Mac Server
      this.ws.send(JSON.stringify({
        type: 'identify',
        clientType: 'receiver',
        clientName: 'Mac Server'
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
        // Start monitoring Claude transcripts if TTS is available
        if (openai && !this.transcriptMonitorInterval) {
          this.startTranscriptMonitoring();
        }
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
        
      case 'ttsToggle':
        // Handle TTS toggle from iPhone app
        this.handleTTSToggle(message.enabled);
        break;
        
      case 'ping':
        // Already handled above, just for clarity
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

  async handleTTSToggle(enabled) {
    this.ttsEnabled = enabled;
    console.log(`🔊 TTS ${enabled ? 'enabled' : 'disabled'} via toggle command`);
    
    // If disabling, kill any playing audio immediately
    if (!this.ttsEnabled && this.currentAudioProcess) {
      console.log(`🔇 Killing audio process PID: ${this.currentAudioProcess.pid}`);
      this.currentAudioProcess.kill();
      this.currentAudioProcess = null;
    }
    
    // Send confirmation back to backend
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ttsStateConfirm',
        enabled: this.ttsEnabled
      }));
      console.log(`✅ Sent TTS state confirmation: ${this.ttsEnabled}`);
    }
  }

  async textToSpeech(text) {
    if (!openai) {
      console.error('OpenAI client not initialized');
      return null;
    }

    try {
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'fable',
        input: text,
      });

      const buffer = Buffer.from(await mp3.arrayBuffer());
      const tempFile = `/tmp/tts_${Date.now()}.mp3`;
      fs.writeFileSync(tempFile, buffer);
      
      return tempFile;
    } catch (error) {
      console.error('Error generating speech:', error);
      return null;
    }
  }

  async playAudio(audioFile) {
    if (!this.ttsEnabled) {
      console.log('🔇 TTS disabled - not playing audio');
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      return;
    }

    return new Promise((resolve) => {
      // Kill any existing audio process
      if (this.currentAudioProcess) {
        this.currentAudioProcess.kill();
      }

      // Start new audio playback
      this.currentAudioProcess = player.play(audioFile, (err) => {
        if (err && !err.killed) {
          console.error('Audio playback error:', err);
        }
        
        // Clean up temp file
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
        
        this.currentAudioProcess = null;
        resolve();
      });

      console.log(`▶️  Playing audio (PID: ${this.currentAudioProcess.pid})`);
    });
  }

  async narrate(text) {
    if (!this.ttsEnabled) {
      console.log('🔇 TTS is disabled - skipping narration');
      return;
    }

    console.log(`🗣️ Narrating: ${text.length > 100 ? text.substring(0, 100) + '...' : text}`);
    
    const audioFile = await this.textToSpeech(text);
    if (audioFile) {
      await this.playAudio(audioFile);
    }
  }

  extractNewMessages(jsonlPath) {
    const newMessages = [];
    const filePathStr = jsonlPath.toString();
    
    // Get last read position
    const lastPosition = this.filePositions[filePathStr] || 0;
    
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n');
      
      let currentPosition = 0;
      for (const line of lines) {
        currentPosition += Buffer.byteLength(line + '\n');
        
        if (currentPosition <= lastPosition) continue;
        if (!line.trim()) continue;
        
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'assistant') {
            const message = entry.message || {};
            const content = message.content || [];
            for (const item of content) {
              if (item.type === 'text' && item.text) {
                newMessages.push(item.text);
              }
            }
          }
        } catch (e) {
          // Skip invalid JSON lines
        }
      }
      
      // Update file position
      this.filePositions[filePathStr] = currentPosition;
      
    } catch (error) {
      console.error('Error reading transcript:', error);
    }
    
    return newMessages;
  }

  startTranscriptMonitoring() {
    const transcriptDir = path.join(process.env.HOME, '.claude', 'projects', '-Users-felixlunzenfichter');
    
    // Initialize file positions to current end
    console.log('Initializing transcript file positions...');
    try {
      const files = fs.readdirSync(transcriptDir).filter(f => f.endsWith('.jsonl'));
      for (const file of files) {
        const filePath = path.join(transcriptDir, file);
        const stats = fs.statSync(filePath);
        this.filePositions[filePath] = stats.size;
      }
      console.log(`Tracking ${Object.keys(this.filePositions).length} transcript files`);
    } catch (error) {
      console.error('Error initializing transcript monitoring:', error);
      return;
    }

    // Monitor for new messages
    this.transcriptMonitorInterval = setInterval(async () => {
      try {
        const files = fs.readdirSync(transcriptDir)
          .filter(f => f.endsWith('.jsonl'))
          .map(f => path.join(transcriptDir, f))
          .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);
        
        if (files.length > 0) {
          const latestFile = files[0];
          const newMessages = this.extractNewMessages(latestFile);
          
          // Narrate each new message
          for (const message of newMessages) {
            await this.narrate(message);
          }
        }
      } catch (error) {
        console.error('Error monitoring transcripts:', error);
      }
    }, 500); // Check every 500ms
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
    
    if (this.transcriptMonitorInterval) {
      clearInterval(this.transcriptMonitorInterval);
      this.transcriptMonitorInterval = null;
    }
    
    if (this.currentAudioProcess) {
      this.currentAudioProcess.kill();
      this.currentAudioProcess = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Start the Mac server
const server = new MacServer();
server.connect();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});

console.log('Mac Server started');
console.log('Features: Voice transcription typing, TTS narration');
if (openai) {
  console.log('✅ TTS enabled with OpenAI');
} else {
  console.log('⚠️  TTS disabled - OPENAI_API_KEY not found');
}
console.log('Press Ctrl+C to stop');
console.log('');
console.log('Make sure to grant Terminal accessibility permissions in:');
console.log('System Settings > Privacy & Security > Accessibility');