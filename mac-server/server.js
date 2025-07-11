const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const player = require('play-sound')();
require('dotenv').config();

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'ws://192.168.2.223:8080';
const RECONNECT_DELAY = 5000; // 5 seconds
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Voice ranking (Felix's preferences)
const VOICE_RANKING = {
  1: 'fable',   // Favorite - main Claude voice (root)
  2: 'nova',    // Worker 1
  3: 'shimmer', // Worker 2
  4: 'alloy',   // Worker 3
  5: 'onyx',    // Worker 4
  6: 'echo'     // Worker 5
};

// Track voice assignments
const voiceAssignments = {
  'root': 'fable',
  // workers will be assigned dynamically
};
let nextVoiceIndex = 2; // Start with nova for first worker

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
    this.audioQueue = [];
    this.isPlayingAudio = false;
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
    
    // First check if claude_orchestrator session exists
    exec('tmux has-session -t claude_orchestrator 2>/dev/null', (error) => {
      if (!error) {
        // Orchestrator exists, send to coordination pane
        console.log('Orchestrator found, sending to coordination pane');
        // Send text first, then Enter separately
        const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
        const textCommand = `tmux send-keys -t claude_orchestrator:0.0 '${escapedText}'`;
        const enterCommand = `tmux send-keys -t claude_orchestrator:0.0 C-m`;
        
        // Send text first
        exec(textCommand, (err) => {
          if (err) {
            console.error('Error sending text to orchestrator:', err);
            // Fallback to normal typing
            this.typeToActiveTerminal(text);
          } else {
            // Then send Enter
            exec(enterCommand, (err2) => {
              if (err2) {
                console.error('Error sending Enter:', err2);
              } else {
                console.log('Successfully sent to orchestrator');
              }
            });
          }
        });
      } else {
        // No orchestrator, type normally
        console.log('No orchestrator found, typing to active terminal');
        this.typeToActiveTerminal(text);
      }
    });
  }
  
  typeToActiveTerminal(text) {
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
    
    // If disabling, kill any playing audio immediately and clear queue
    if (!this.ttsEnabled) {
      if (this.currentAudioProcess) {
        console.log(`🔇 Killing audio process PID: ${this.currentAudioProcess.pid}`);
        this.currentAudioProcess.kill();
        this.currentAudioProcess = null;
      }
      // Clear the audio queue
      this.audioQueue = [];
      this.isPlayingAudio = false;
      console.log('🔇 Cleared audio queue');
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

  async textToSpeech(text, voice = 'fable') {
    if (!openai) {
      console.error('OpenAI client not initialized');
      return null;
    }

    try {
      const mp3 = await openai.audio.speech.create({
        model: 'tts-1',
        voice: voice,
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

  async narrate(text, voice = 'fable') {
    if (!this.ttsEnabled) {
      console.log('🔇 TTS is disabled - skipping narration');
      return;
    }

    console.log(`🗣️ Adding to queue (${voice}): ${text.length > 100 ? text.substring(0, 100) + '...' : text}`);
    
    // Add to queue with voice
    this.audioQueue.push({ text, voice });
    console.log(`📋 Queue length: ${this.audioQueue.length}, Playing: ${this.isPlayingAudio}`);
    
    // Process queue if not already playing
    if (!this.isPlayingAudio) {
      this.processAudioQueue();
    }
  }

  async processAudioQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    this.isPlayingAudio = true;
    
    while (this.audioQueue.length > 0 && this.ttsEnabled) {
      const item = this.audioQueue.shift();
      const text = typeof item === 'string' ? item : item.text;
      const voice = typeof item === 'string' ? 'fable' : item.voice;
      
      console.log(`▶️  Processing from queue (${voice}): ${text.length > 50 ? text.substring(0, 50) + '...' : text}`);
      
      const audioFile = await this.textToSpeech(text, voice);
      if (audioFile) {
        await this.playAudio(audioFile);
      }
    }
    
    this.isPlayingAudio = false;
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

  getActiveInstance() {
    // Returns the most recently modified Claude instance
    const projectsDir = path.join(process.env.HOME, '.claude', 'projects');
    let mostRecent = null;
    let latestTime = 0;
    
    try {
      const projectDirs = fs.readdirSync(projectsDir)
        .map(dir => path.join(projectsDir, dir))
        .filter(dir => fs.statSync(dir).isDirectory());
      
      for (const projectDir of projectDirs) {
        try {
          const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = path.join(projectDir, file);
            const mtime = fs.statSync(filePath).mtime.getTime();
            if (mtime > latestTime) {
              latestTime = mtime;
              mostRecent = {
                project: path.basename(projectDir),
                file: filePath,
                lastModified: new Date(mtime)
              };
            }
          }
        } catch (error) {
          // Skip directories we can't read
        }
      }
    } catch (error) {
      console.error('Error finding active instance:', error);
    }
    
    return mostRecent;
  }

  startTranscriptMonitoring() {
    const projectsDir = path.join(process.env.HOME, '.claude', 'projects');
    
    console.log('Starting dynamic Claude instance monitoring...');
    
    // Monitor for new messages from all Claude instances
    this.transcriptMonitorInterval = setInterval(async () => {
      try {
        // Find all project directories
        const projectDirs = fs.readdirSync(projectsDir)
          .map(dir => path.join(projectsDir, dir))
          .filter(dir => fs.statSync(dir).isDirectory());
        
        let allTranscriptFiles = [];
        
        // Collect transcript files from all project directories
        for (const projectDir of projectDirs) {
          try {
            const files = fs.readdirSync(projectDir)
              .filter(f => f.endsWith('.jsonl'))
              .map(f => ({
                path: path.join(projectDir, f),
                project: path.basename(projectDir),
                mtime: fs.statSync(path.join(projectDir, f)).mtime
              }));
            allTranscriptFiles = allTranscriptFiles.concat(files);
          } catch (error) {
            // Skip directories we can't read
          }
        }
        
        // Sort by modification time to find most recently active
        allTranscriptFiles.sort((a, b) => b.mtime - a.mtime);
        
        // Process files from most recently modified
        for (const fileInfo of allTranscriptFiles) {
          // Initialize position if not tracked
          if (!this.filePositions[fileInfo.path]) {
            const stats = fs.statSync(fileInfo.path);
            this.filePositions[fileInfo.path] = stats.size;
            console.log(`Now tracking: ${fileInfo.project}`);
          }
          
          // Check for new messages
          const newMessages = this.extractNewMessages(fileInfo.path);
          
          // Narrate each new message
          for (const message of newMessages) {
            console.log(`[${fileInfo.project}] New message detected`);
            await this.narrate(message);
          }
        }
        
        // Clean up tracking for deleted files
        const existingFiles = new Set(allTranscriptFiles.map(f => f.path));
        for (const trackedFile of Object.keys(this.filePositions)) {
          if (!existingFiles.has(trackedFile)) {
            delete this.filePositions[trackedFile];
            console.log(`Stopped tracking deleted file: ${path.basename(trackedFile)}`);
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