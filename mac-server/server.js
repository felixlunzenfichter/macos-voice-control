const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const player = require('play-sound')();
require('dotenv').config();
const Logger = require('../logs/logger');

// Mac-server logger with default file logging
const logger = new Logger('mac-server');

// Load backend URL from process.env only - crash if not found
const BACKEND_URL = process.env.BACKEND_URL;

if (!BACKEND_URL) {
  logger.error('FATAL: BACKEND_URL environment variable not set');
  console.error('FATAL ERROR: BACKEND_URL environment variable not set');
  console.error('Set BACKEND_URL environment variable (e.g., wss://your-backend-url)');
  process.exit(1);
}

logger.log(`Backend URL: ${BACKEND_URL}`);
const RECONNECT_DELAY = 5000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const VOICE_RANKING = {
  1: 'fable',
  2: 'nova',
  3: 'shimmer',
  4: 'alloy',
  5: 'onyx',
  6: 'echo'
};

const voiceAssignments = {
  'root': 'fable',
};
let nextVoiceIndex = 2;

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
    this.micActive = false;
  }

  connect() {
    logger.log(`Connecting to backend: ${BACKEND_URL}`);
    
    this.ws = new WebSocket(BACKEND_URL);

    this.ws.on('open', () => {
      logger.log('Connected to transcription backend');
      this.isConnected = true;
      
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
        logger.error(`Error parsing WebSocket message: ${error.message}`);
      }
    });

    this.ws.on('close', () => {
      logger.log('Disconnected from backend');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      logger.error(`WebSocket connection error: ${error.message}`);
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connection':
        logger.log('Connected to transcription backend');
        if (openai && !this.transcriptMonitorInterval) {
          this.startTranscriptMonitoring();
        }
        break;
        
      case 'transcript':
        if (message.isFinal) {
          logger.log(`Final transcript: "${message.transcript}"`);
          this.typeTranscription(message.transcript);
        } else {
          logger.log(`Interim transcript: "${message.transcript}"`);
        }
        break;
        
      case 'error':
        logger.error(`Backend error received: ${message.error}`);
        break;
        
      case 'ping':
        this.ws.send(JSON.stringify({
          type: 'pong',
          pingId: message.pingId
        }));
        break;
        
      case 'keyPress':
        logger.log(`Received key press: ${message.key}`);
        this.simulateKeyPress(message.key);
        break;
        
      case 'ttsToggle':
        this.handleTTSToggle(message.enabled);
        break;
        
      case 'micStatus':
        this.handleMicStatus(message.active);
        break;
        
      case 'ping':
        break;
        
      case 'log':
        // Handle forwarded logs from backend/iOS and write to local file
        this.receiveLog(message);
        break;
        
      default:
        logger.error(`Unknown WebSocket message type received: ${message.type}`);
    }
  }

  receiveLog(logEntry) {
    // Use the default file logging to write forwarded logs to local file
    logger.defaultFileLogging(logEntry);
    
    // Also log iOS logs to console for visibility
    if (logEntry.service === 'iOS') {
      logger.log(`iOS | ${logEntry.class || 'unknown'} | ${logEntry.function || 'unknown'} | ${logEntry.message}`);
    }
  }

  typeTranscription(text) {
    if (!text || text.trim() === '') return;
    
    exec('tmux has-session -t claude_orchestrator 2>/dev/null', (error) => {
      if (!error) {
        // Orchestrator exists, send to coordination pane
        logger.log('Orchestrator found, sending to coordination pane');
        const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
        const textCommand = `tmux send-keys -t claude_orchestrator:0.0 '${escapedText}'`;
        const enterCommand = `tmux send-keys -t claude_orchestrator:0.0 C-m`;
        
        // Send text first
        exec(textCommand, (err) => {
          if (err) {
            logger.error(`Error sending text to orchestrator: ${err.message}`);
            this.typeToActiveTerminal(text);
          } else {
            exec(enterCommand, (err2) => {
              if (err2) {
                logger.error(`Error sending enter key to orchestrator: ${err2.message}`);
              } else {
                logger.log('Successfully sent to orchestrator');
              }
            });
          }
        });
      } else {
        logger.log('No orchestrator found, typing to active terminal');
        this.typeToActiveTerminal(text);
      }
    });
  }
  
  typeToActiveTerminal(text) {
    const fs = require('fs');
    const tempFile = `/tmp/transcription_${Date.now()}.txt`;
    fs.writeFileSync(tempFile, text);
    
    const script = `
      set textContent to read POSIX file "${tempFile}" as string
      
      tell application "Terminal"
        activate
      end tell
      
      delay 0.1
      
      tell application "System Events"
        keystroke textContent
        delay 1
        key code 36
      end tell
      
      do shell script "rm ${tempFile}"
    `;
    
    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Error typing text via AppleScript: ${error.message}`);
        try { fs.unlinkSync(tempFile); } catch (e) {}
      } else {
        logger.log('Typed successfully');
      }
    });
  }

  simulateKeyPress(key) {
    const keyMap = {
      'escape': '53',
      'return': '36',
      'tab': '48',
      'space': '49',
      'delete': '51',
      'up': '126',
      'down': '125',
      'left': '123',
      'right': '124'
    };
    
    const keyCode = keyMap[key.toLowerCase()];
    
    if (keyCode) {
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
          logger.error(`Error simulating ${key} key: ${error.message}`);
        } else {
          logger.log(`Simulated ${key} key press`);
        }
      });
    } else {
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
          logger.error(`Error typing ${key}: ${error.message}`);
        } else {
          logger.log(`Typed ${key}`);
        }
      });
    }
  }

  async handleTTSToggle(enabled) {
    this.ttsEnabled = enabled;
    logger.log(`🔊 TTS ${enabled ? 'enabled' : 'disabled'} via toggle command`);
    
    if (this.currentAudioProcess) {
      logger.log(`🔇 Killing audio process PID: ${this.currentAudioProcess.pid}`);
      this.currentAudioProcess.kill();
      this.currentAudioProcess = null;
    }
    
    const queueLength = this.audioQueue.length;
    this.audioQueue = [];
    this.isPlayingAudio = false;
    logger.log(`🗑️  Cleared audio queue (${queueLength} items removed) on TTS toggle`);
    
    if (this.pausedAudioFile && fs.existsSync(this.pausedAudioFile)) {
      fs.unlinkSync(this.pausedAudioFile);
      this.pausedAudioFile = null;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ttsStateConfirm',
        enabled: this.ttsEnabled
      }));
      logger.log(`✅ Sent TTS state confirmation: ${this.ttsEnabled}`);
    }
  }

  async handleMicStatus(active) {
    const previousStatus = this.micActive;
    this.micActive = active;
    logger.log(`🎤 Mic status changed: ${active ? 'ACTIVE' : 'INACTIVE'}`);
    
    if (active) {
      if (this.currentAudioProcess) {
        logger.log(`🛑 Stopping audio - mic is active`);
        this.currentAudioProcess.kill();
        this.currentAudioProcess = null;
      }
      
      const queueLength = this.audioQueue.length;
      this.audioQueue = [];
      this.isPlayingAudio = false;
      logger.log(`🗑️  Cleared audio queue (${queueLength} items removed) - mic is active`);
      
        if (this.pausedAudioFile && fs.existsSync(this.pausedAudioFile)) {
        fs.unlinkSync(this.pausedAudioFile);
        this.pausedAudioFile = null;
      }
    } else if (!active && previousStatus) {
      logger.log(`▶️  Mic inactive - ready for new audio`);
      
    }
  }

  async textToSpeech(text, voice = 'fable') {
    if (!openai) {
      logger.error('OpenAI client not initialized');
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
      logger.error(`Error generating speech: ${error.message}`);
      return null;
    }
  }

  async playAudio(audioFile) {
    if (!this.ttsEnabled) {
      logger.log('🔇 TTS disabled - not playing audio');
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      return;
    }

    if (this.micActive) {
      logger.log('🎤 Mic is active - discarding audio');
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      return;
    }

    return new Promise((resolve) => {
      if (this.currentAudioProcess) {
        this.currentAudioProcess.kill();
      }

      this.currentAudioProcess = player.play(audioFile, (err) => {
        if (err && !err.killed) {
          logger.error(`Audio playback error: ${err.message}`);
        }
        
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
        
        this.currentAudioProcess = null;
        resolve();
      });

      logger.log(`▶️  Playing audio (PID: ${this.currentAudioProcess.pid})`);
    });
  }

  async narrate(text, voice = 'fable') {
    if (!this.ttsEnabled) {
      logger.log('🔇 TTS is disabled - skipping narration');
      return;
    }

    logger.log(`🗣️ Adding to queue`);
    
    this.audioQueue.push({ text, voice });
    logger.log(`📋 Queue status`);
    
    if (!this.isPlayingAudio && !this.micActive) {
      this.processAudioQueue();
    } else if (this.micActive) {
      logger.log('🎤 Mic is active - queuing audio for later');
    }
  }

  async processAudioQueue() {
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false;
      return;
    }

    this.isPlayingAudio = true;
    
    while (this.audioQueue.length > 0 && this.ttsEnabled && !this.micActive) {
      const item = this.audioQueue.shift();
      const text = typeof item === 'string' ? item : item.text;
      const voice = typeof item === 'string' ? 'fable' : item.voice;
      
      logger.log(`▶️  Processing from queue`);
      
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
        }
      }
      
      this.filePositions[filePathStr] = currentPosition;
      
    } catch (error) {
      logger.error(`Error reading transcript file: ${error.message}`);
    }
    
    return newMessages;
  }

  getActiveInstance() {
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
        }
      }
    } catch (error) {
      logger.error(`Error finding active Claude instance: ${error.message}`);
    }
    
    return mostRecent;
  }

  startTranscriptMonitoring() {
    const projectsDir = path.join(process.env.HOME, '.claude', 'projects');
    
    // Silently start monitoring - no need to log this
    
    this.transcriptMonitorInterval = setInterval(async () => {
      try {
        const projectDirs = fs.readdirSync(projectsDir)
          .map(dir => path.join(projectsDir, dir))
          .filter(dir => fs.statSync(dir).isDirectory());
        
        let allTranscriptFiles = [];
        
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
            }
        }
        
        allTranscriptFiles.sort((a, b) => b.mtime - a.mtime);
        
        for (const fileInfo of allTranscriptFiles) {
          if (!this.filePositions[fileInfo.path]) {
            const stats = fs.statSync(fileInfo.path);
            this.filePositions[fileInfo.path] = stats.size;
            // Silently start tracking - reduces log spam
          }
          
          const newMessages = this.extractNewMessages(fileInfo.path);
          
          for (const message of newMessages) {
            // New message detected - narration will handle notification
            await this.narrate(message);
          }
        }
        
        const existingFiles = new Set(allTranscriptFiles.map(f => f.path));
        for (const trackedFile of Object.keys(this.filePositions)) {
          if (!existingFiles.has(trackedFile)) {
            delete this.filePositions[trackedFile];
            logger.log('Stopped tracking deleted file');
          }
        }
        
      } catch (error) {
        logger.error(`Error monitoring transcript files: ${error.message}`);
      }
    }, 500);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    logger.log(`Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
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

const server = new MacServer();
server.connect();

process.on('SIGINT', () => {
  logger.log('Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.log('Shutting down...');
  server.stop();
  process.exit(0);
});

logger.log('Mac Server started');
logger.log('Features: Voice transcription typing, TTS narration');
if (openai) {
  logger.log('✅ TTS enabled with OpenAI');
} else {
  logger.log('⚠️  TTS disabled - OPENAI_API_KEY not found');
}
logger.log('Terminal accessibility permissions required in System Settings > Privacy & Security > Accessibility');