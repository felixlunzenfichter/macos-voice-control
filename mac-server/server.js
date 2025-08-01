const WebSocket = require('ws');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const player = require('play-sound')();
require('dotenv').config();
const Logger = require('../logs/logger');

const logger = new Logger('mac-server');

// Load backend URL from config file
let BACKEND_URL;
try {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  BACKEND_URL = process.env.BACKEND_URL || config.backendUrl;
} catch (error) {
  // Fallback if config file doesn't exist
  BACKEND_URL = process.env.BACKEND_URL || 'ws://localhost:8080';
  logger.error('config', 'Failed to load config.json, using fallback URL', { error: error.message });
}
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
    logger.log('connect', `Connecting to backend: ${BACKEND_URL}`);
    
    this.ws = new WebSocket(BACKEND_URL);

    this.ws.on('open', () => {
      logger.log('connect', 'Connected to transcription backend');
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
        logger.error('onMessage', 'Error parsing message', { error: error.message });
      }
    });

    this.ws.on('close', () => {
      logger.log('onClose', 'Disconnected from backend');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      logger.error('onError', 'WebSocket error', { error: error.message });
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'connection':
        logger.log('handleMessage', 'Backend says:', { message: message.message });
        if (openai && !this.transcriptMonitorInterval) {
          this.startTranscriptMonitoring();
        }
        break;
        
      case 'transcript':
        if (message.isFinal) {
          logger.log('handleMessage', `Final transcript: "${message.transcript}"`, { transcript: message.transcript });
          this.typeTranscription(message.transcript);
        } else {
          logger.log('handleMessage', `Interim transcript`, { transcript: message.transcript });
        }
        break;
        
      case 'error':
        logger.error('handleMessage', 'Backend error', { error: message.error });
        break;
        
      case 'ping':
        this.ws.send(JSON.stringify({
          type: 'pong',
          pingId: message.pingId
        }));
        break;
        
      case 'keyPress':
        logger.log('handleMessage', `Received key press: ${message.key}`, { key: message.key });
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
        
      default:
        logger.error('handleMessage', 'Unknown message type', { messageType: message.type });
    }
  }

  typeTranscription(text) {
    if (!text || text.trim() === '') return;
    
    exec('tmux has-session -t claude_orchestrator 2>/dev/null', (error) => {
      if (!error) {
        // Orchestrator exists, send to coordination pane
        logger.log('typeTranscription', 'Orchestrator found, sending to coordination pane');
        const escapedText = text.replace(/"/g, '\\"').replace(/'/g, "'\\''");
        const textCommand = `tmux send-keys -t claude_orchestrator:0.0 '${escapedText}'`;
        const enterCommand = `tmux send-keys -t claude_orchestrator:0.0 C-m`;
        
        // Send text first
        exec(textCommand, (err) => {
          if (err) {
            logger.error('typeTranscription', 'Error sending text to orchestrator', { error: err.message });
            this.typeToActiveTerminal(text);
          } else {
            exec(enterCommand, (err2) => {
              if (err2) {
                logger.error('typeTranscription', 'Error sending Enter', { error: err2.message });
              } else {
                logger.log('typeTranscription', 'Successfully sent to orchestrator');
              }
            });
          }
        });
      } else {
        logger.log('typeTranscription', 'No orchestrator found, typing to active terminal');
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
        logger.error('typeToActiveTerminal', 'Error typing text', { error: error.message });
        try { fs.unlinkSync(tempFile); } catch (e) {}
      } else {
        logger.log('typeToActiveTerminal', 'Typed successfully');
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
          logger.error('simulateKeyPress', `Error simulating ${key} key`, { key, error: error.message });
        } else {
          logger.log('simulateKeyPress', `Simulated ${key} key press`, { key });
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
          logger.error('simulateKeyPress', `Error typing ${key}`, { key, error: error.message });
        } else {
          logger.log('simulateKeyPress', `Typed ${key}`, { key });
        }
      });
    }
  }

  async handleTTSToggle(enabled) {
    this.ttsEnabled = enabled;
    logger.log('handleTTSToggle', `🔊 TTS ${enabled ? 'enabled' : 'disabled'} via toggle command`, { ttsEnabled: enabled });
    
    if (this.currentAudioProcess) {
      logger.log('handleTTSToggle', `🔇 Killing audio process PID: ${this.currentAudioProcess.pid}`);
      this.currentAudioProcess.kill();
      this.currentAudioProcess = null;
    }
    
    const queueLength = this.audioQueue.length;
    this.audioQueue = [];
    this.isPlayingAudio = false;
    logger.log('handleTTSToggle', `🗑️  Cleared audio queue (${queueLength} items removed) on TTS toggle`, { queueLength });
    
    if (this.pausedAudioFile && fs.existsSync(this.pausedAudioFile)) {
      fs.unlinkSync(this.pausedAudioFile);
      this.pausedAudioFile = null;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'ttsStateConfirm',
        enabled: this.ttsEnabled
      }));
      logger.log('handleTTSToggle', `✅ Sent TTS state confirmation: ${this.ttsEnabled}`, { ttsEnabled: this.ttsEnabled });
    }
  }

  async handleMicStatus(active) {
    const previousStatus = this.micActive;
    this.micActive = active;
    logger.log('handleMicStatus', `🎤 Mic status changed: ${active ? 'ACTIVE' : 'INACTIVE'}`, { micActive: active, previousStatus });
    
    if (active) {
      if (this.currentAudioProcess) {
        logger.log('handleMicStatus', `🛑 Stopping audio - mic is active`);
        this.currentAudioProcess.kill();
        this.currentAudioProcess = null;
      }
      
      const queueLength = this.audioQueue.length;
      this.audioQueue = [];
      this.isPlayingAudio = false;
      logger.log('handleMicStatus', `🗑️  Cleared audio queue (${queueLength} items removed) - mic is active`, { queueLength });
      
        if (this.pausedAudioFile && fs.existsSync(this.pausedAudioFile)) {
        fs.unlinkSync(this.pausedAudioFile);
        this.pausedAudioFile = null;
      }
    } else if (!active && previousStatus) {
      logger.log('handleMicStatus', `▶️  Mic inactive - ready for new audio`);
      
    }
  }

  async textToSpeech(text, voice = 'fable') {
    if (!openai) {
      logger.error('textToSpeech', 'OpenAI client not initialized');
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
      logger.error('textToSpeech', 'Error generating speech', { error: error.message, voice, textLength: text.length });
      return null;
    }
  }

  async playAudio(audioFile) {
    if (!this.ttsEnabled) {
      logger.log('playAudio', '🔇 TTS disabled - not playing audio');
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      return;
    }

    if (this.micActive) {
      logger.log('playAudio', '🎤 Mic is active - discarding audio');
      if (fs.existsSync(audioFile)) fs.unlinkSync(audioFile);
      return;
    }

    return new Promise((resolve) => {
      if (this.currentAudioProcess) {
        this.currentAudioProcess.kill();
      }

      this.currentAudioProcess = player.play(audioFile, (err) => {
        if (err && !err.killed) {
          logger.error('playAudio', 'Audio playback error', { error: err.message });
        }
        
        if (fs.existsSync(audioFile)) {
          fs.unlinkSync(audioFile);
        }
        
        this.currentAudioProcess = null;
        resolve();
      });

      logger.log('playAudio', `▶️  Playing audio (PID: ${this.currentAudioProcess.pid})`);
    });
  }

  async narrate(text, voice = 'fable') {
    if (!this.ttsEnabled) {
      logger.log('narrate', '🔇 TTS is disabled - skipping narration');
      return;
    }

    logger.log('narrate', `🗣️ Adding to queue`, { voice, textLength: text.length, preview: text.substring(0, 50) });
    
    this.audioQueue.push({ text, voice });
    logger.log('narrate', `📋 Queue status`, { queueLength: this.audioQueue.length, isPlaying: this.isPlayingAudio, micActive: this.micActive });
    
    if (!this.isPlayingAudio && !this.micActive) {
      this.processAudioQueue();
    } else if (this.micActive) {
      logger.log('narrate', '🎤 Mic is active - queuing audio for later');
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
      
      logger.log('processAudioQueue', `▶️  Processing from queue`, { voice, textLength: text.length, preview: text.substring(0, 50) });
      
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
      logger.error('extractNewMessages', 'Error reading transcript', { error: error.message, file: jsonlPath });
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
      logger.error('getActiveInstance', 'Error finding active instance', { error: error.message });
    }
    
    return mostRecent;
  }

  startTranscriptMonitoring() {
    const projectsDir = path.join(process.env.HOME, '.claude', 'projects');
    
    logger.log('startTranscriptMonitoring', 'Starting dynamic Claude instance monitoring');
    
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
            logger.log('startTranscriptMonitoring', `Now tracking: ${fileInfo.project}`, { project: fileInfo.project });
          }
          
          const newMessages = this.extractNewMessages(fileInfo.path);
          
          for (const message of newMessages) {
            logger.log('startTranscriptMonitoring', 'New message detected', { project: fileInfo.project });
            await this.narrate(message);
          }
        }
        
        const existingFiles = new Set(allTranscriptFiles.map(f => f.path));
        for (const trackedFile of Object.keys(this.filePositions)) {
          if (!existingFiles.has(trackedFile)) {
            delete this.filePositions[trackedFile];
            logger.log('startTranscriptMonitoring', 'Stopped tracking deleted file', { file: path.basename(trackedFile) });
          }
        }
        
      } catch (error) {
        logger.error('startTranscriptMonitoring', 'Error monitoring transcripts', { error: error.message });
      }
    }, 500);
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    logger.log('scheduleReconnect', `Reconnecting in ${RECONNECT_DELAY / 1000} seconds...`);
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
  logger.log('shutdown', 'Shutting down...');
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.log('shutdown', 'Shutting down...');
  server.stop();
  process.exit(0);
});

logger.log('startup', 'Mac Server started');
logger.log('startup', 'Features: Voice transcription typing, TTS narration');
if (openai) {
  logger.log('startup', '✅ TTS enabled with OpenAI');
} else {
  logger.log('startup', '⚠️  TTS disabled - OPENAI_API_KEY not found');
}
logger.log('startup', 'Terminal accessibility permissions required in System Settings > Privacy & Security > Accessibility');