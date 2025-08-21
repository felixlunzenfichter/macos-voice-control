const express = require('express');
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');
const Logger = require('./logs/logger');

const app = express();
const PORT = process.env.PORT || 8080;

const clients = {
  transcribers: new Set(),
  receivers: new Map()
};

// Backend logger with forwarding callback to mac-server specifically
const logger = new Logger('backend', (logEntry) => {
  try {
    // Forward to Mac Server specifically via WebSocket if connected
    const macServer = clients.receivers.get("Mac Server");
    if (macServer && macServer.readyState === 1) { // WebSocket.OPEN = 1
      const logMessage = {
        type: 'log',
        ...logEntry
      };
      const messageStr = JSON.stringify(logMessage);
      macServer.send(messageStr);
    }
  } catch (error) {
    // Ignore errors in log forwarding to prevent crashes
    console.error('Log forwarding error:', error.message);
  }
});

app.get('/', (req, res) => {
  logger.log(`Health check endpoint accessed from ${req.ip}`);
  res.json({ 
    status: 'ok', 
    service: 'Speech Transcription Backend',
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  logger.log(`Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });
logger.log('WebSocket server created');

const speechClient = new speech.SpeechClient();
logger.log('Google Speech client initialized');

async function getServerStatuses() {
  logger.log('Checking server statuses');
  const statuses = {
    "Backend": true,
    "Mac Server": false
  };
  
  const macServer = clients.receivers.get("Mac Server");
  if (macServer && macServer.readyState === 1) {
    try {
      const pingId = Date.now().toString();
      const pongPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 1000);
        
        macServer.once('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'pong' && msg.pingId === pingId) {
              clearTimeout(timeout);
              resolve(true);
            }
          } catch (e) {}
        });
      });
      
      logger.log(`Sending ping to Mac Server with ID: ${pingId}`);
      macServer.send(JSON.stringify({ type: 'ping', pingId }));
      const isResponsive = await pongPromise;
      logger.log(`Mac Server ping response: ${isResponsive}`);
      statuses["Mac Server"] = isResponsive;
    } catch (error) {
      logger.error(`Error pinging Mac Server: ${error.message}`);
      statuses["Mac Server"] = false;
    }
  }
  
  
  return statuses;
}


wss.on('connection', (ws) => {
  logger.log(`Client connected from ${ws._socket.remoteAddress}:${ws._socket.remotePort}`);
  
  let clientType = 'transcriber';
  let recognizeStream = null;
  let previousTranscript = '';
  let forwardingEnabled = true;
  let audioSessionStarted = false;
  
  getServerStatuses().then(statuses => {
    ws.send(JSON.stringify({ 
      type: 'connection', 
      status: 'connected',
      message: 'Ready to transcribe',
      serverStatuses: statuses
    }));
  });
  
  ws.on('message', async (data) => {
    try {
      if (Buffer.isBuffer(data) && data.length > 100) {
        // Only log once when audio session starts
        if (!audioSessionStarted) {
          logger.log(`Audio session started - receiving data`);
          audioSessionStarted = true;
        }
        if (recognizeStream && !recognizeStream.destroyed) {
          const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
          let maxAmplitude = 0;
          for (let i = 0; i < Math.min(100, samples.length); i++) {
            maxAmplitude = Math.max(maxAmplitude, Math.abs(samples[i]));
          }
          // Remove per-packet amplitude logging to reduce noise
          
          recognizeStream.write(data);
        } else {
          logger.error('No active recognition stream for incoming audio data');
        }
      } else if (data.toString().startsWith('{')) {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'identify') {
          clientType = message.clientType || 'transcriber';
          const clientName = message.clientName || clientType;
          logger.log(`Client identified as: ${clientType} (${clientName})`);
          
          if (clientType === 'receiver') {
            clients.receivers.set(clientName, ws);
            logger.log(`Receiver '${clientName}' connected. Total receivers: ${clients.receivers.size}`);
          } else {
            clients.transcribers.add(ws);
            logger.log(`Transcriber connected. Total transcribers: ${clients.transcribers.size}`);
          }
          
          getServerStatuses().then(statuses => {
            ws.send(JSON.stringify({
              type: 'connection',
              status: 'identified',
              clientType: clientType,
              serverStatuses: statuses
            }));
          });
          
        } else if (message.type === 'start') {
          if (clients.receivers.size === 0) {
            logger.log('No receivers connected - skipping speech recognition to save costs');
            ws.send(JSON.stringify({ 
              type: 'info', 
              message: 'No receivers connected - speech recognition disabled to save costs' 
            }));
            return;
          }
          
          const sampleRate = message.sampleRate || 44100;
          logger.log(`Starting recognition stream at ${sampleRate}Hz`);
          
          const request = {
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: sampleRate,
              languageCode: message.languageCode || 'en-US',
              enableAutomaticPunctuation: true,
              model: 'latest_long',
            },
            interimResults: true,
          };
          
          recognizeStream = speechClient
            .streamingRecognize(request)
            .on('error', (error) => {
              logger.error(`Recognition stream error: ${error.message}`);
              ws.send(JSON.stringify({ 
                type: 'error', 
                error: error.message 
              }));
              recognizeStream = null;
            })
            .on('data', (data) => {
              if (data.results[0] && data.results[0].alternatives[0]) {
                const transcript = data.results[0].alternatives[0].transcript;
                const isFinal = data.results[0].isFinal;
                
                let delta = '';
                if (transcript.startsWith(previousTranscript)) {
                  delta = transcript.substring(previousTranscript.length);
                } else {
                  delta = transcript;
                }
                
                const transcriptMessage = {
                  type: 'transcript',
                  transcript: transcript,
                  delta: delta,
                  isFinal: isFinal,
                  timestamp: new Date().toISOString()
                };
                
                ws.send(JSON.stringify(transcriptMessage));
                
                if (forwardingEnabled) {
                  const messageStr = JSON.stringify(transcriptMessage);
                  for (const [name, receiver] of clients.receivers.entries()) {
                    if (receiver.readyState === receiver.OPEN) {
                      receiver.send(messageStr);
                    }
                  }
                  
                  logger.log(`${isFinal ? 'Final' : 'Interim'} transcript: "${transcript}"`);
                  if (clients.receivers.size > 0) {
                    logger.log(`Broadcast to ${clients.receivers.size} receiver(s)`);
                  }
                } else {
                  logger.log(`${isFinal ? 'Final' : 'Interim'} transcript (forwarding disabled): "${transcript}"`);
                }
                
                if (isFinal) {
                  previousTranscript = '';
                } else {
                  previousTranscript = transcript;
                }
              }
            });
            
        } else if (message.type === 'requestStatus') {
          const statuses = await getServerStatuses();
          ws.send(JSON.stringify({
            type: 'serverStatusUpdate',
            serverStatuses: statuses
          }));
          
        } else if (message.type === 'stop') {
          if (recognizeStream) {
            recognizeStream.end();
            recognizeStream = null;
            audioSessionStarted = false;  // Reset for next session
            logger.log('Stopped recognition stream');
          }
          
        } else if (message.type === 'stopForwarding') {
          forwardingEnabled = false;
          logger.log('Stopped forwarding transcriptions to Mac');
          ws.send(JSON.stringify({ 
            type: 'forwardingStatus', 
            forwarding: false 
          }));
          
        } else if (message.type === 'startForwarding') {
          forwardingEnabled = true;
          logger.log('Resumed forwarding transcriptions to Mac');
          ws.send(JSON.stringify({ 
            type: 'forwardingStatus', 
            forwarding: true 
          }));
          
        } else if (message.type === 'keyPress') {
          const keyPressMessage = {
            type: 'keyPress',
            key: message.key,
            timestamp: new Date().toISOString()
          };
          
          logger.log(`Forwarding key press "${message.key}" to ${clients.receivers.size} receivers`);
          
          const messageStr = JSON.stringify(keyPressMessage);
          for (const [name, receiver] of clients.receivers.entries()) {
            if (receiver.readyState === receiver.OPEN) {
              receiver.send(messageStr);
              logger.log(`Sent key press "${message.key}" to receiver: ${name}`);
            }
          }
        } else if (message.type === 'ttsToggle') {
          logger.log(`Received TTS toggle request: ${message.enabled}`);
          const ttsToggleMessage = {
            type: 'ttsToggle',
            enabled: message.enabled,
            timestamp: new Date().toISOString()
          };
          
          logger.log(`Forwarding TTS toggle: ${message.enabled}`);
          
          const macServer = clients.receivers.get("Mac Server");
          if (macServer && macServer.readyState === macServer.OPEN) {
            macServer.send(JSON.stringify(ttsToggleMessage));
            logger.log(`Sent TTS toggle to Mac Server: ${message.enabled}`);
          } else {
            logger.error('Mac Server not connected - cannot toggle TTS');
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Mac Server not connected'
            }));
          }
        } else if (message.type === 'ttsStateConfirm') {
          logger.log(`Received TTS state confirmation from Mac Server: ${message.enabled}`);
          const confirmMessage = {
            type: 'ttsState',
            enabled: message.enabled
          };
          const messageStr = JSON.stringify(confirmMessage);
          
          let sentCount = 0;
          for (const transcriber of clients.transcribers) {
            if (transcriber.readyState === transcriber.OPEN) {
              transcriber.send(messageStr);
              sentCount++;
              logger.log(`Sent TTS state confirmation to transcriber #${sentCount}: ${message.enabled}`);
            }
          }
          logger.log(`Total transcribers notified: ${sentCount}`);
          
          if (sentCount === 0) {
            logger.error('WARNING: No transcribers connected to receive TTS state confirmation');
          }
        } else if (message.type === 'helpMessage') {
          logger.error('🆘 EMERGENCY HELP MESSAGE RECEIVED');
          
          const emergencyMessage = {
            type: 'transcript',
            transcript: "HELP BUTTON PRESSED: User cannot interact with system. User is locked out and can only use voice. Fix voice control immediately.",
            delta: "HELP BUTTON PRESSED: User cannot interact with system. User is locked out and can only use voice. Fix voice control immediately.",
            isFinal: true,
            timestamp: new Date().toISOString()
          };
          
          const messageStr = JSON.stringify(emergencyMessage);
          for (const [name, receiver] of clients.receivers.entries()) {
            if (receiver.readyState === receiver.OPEN) {
              receiver.send(messageStr);
              logger.error(`🆘 Sent emergency transcript to receiver: ${name}`);
            }
          }
          
          ws.send(JSON.stringify({
            type: 'helpMessageReceived',
            status: 'Emergency message typed into terminal'
          }));
          
        } else if (message.type === 'micStatus') {
          logger.log(`Received mic status: ${message.active ? 'ACTIVE' : 'INACTIVE'}`);
          const micStatusMessage = {
            type: 'micStatus',
            active: message.active,
            timestamp: new Date().toISOString()
          };
          
          logger.log(`Forwarding mic status to Mac Server: ${message.active ? 'active' : 'inactive'}`);
          
          const macServer = clients.receivers.get("Mac Server");
          if (macServer && macServer.readyState === macServer.OPEN) {
            macServer.send(JSON.stringify(micStatusMessage));
            logger.log(`Sent mic status (${message.active ? 'active' : 'inactive'}) to Mac Server`);
          } else {
            logger.error('Mac Server not connected - cannot send mic status');
          }
          
        } else if (message.type === 'pong') {
          
        } else if (message.type === 'iOSlog') {
          // Use backend logger - the callback will automatically forward to mac-server
          if (message.level === 'ERROR') {
            logger.error(message.message);
          } else {
            logger.log(message.message);
          }
          
        } else {
          logger.error(`Unknown WebSocket message type received: ${message.type}`);
        }
      }
    } catch (error) {
      logger.error(`Error processing WebSocket message: ${error.message}`);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    logger.log(`${clientType} disconnected`);
    
    let wasReceiver = false;
    
    for (const [name, socket] of clients.receivers.entries()) {
      if (socket === ws) {
        clients.receivers.delete(name);
        wasReceiver = true;
        logger.log(`Receiver '${name}' disconnected`);
        break;
      }
    }
    
    clients.transcribers.delete(ws);
    
    logger.log(`Active clients - Transcribers: ${clients.transcribers.size}, Receivers: ${clients.receivers.size}`);
    
    
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
  
  ws.on('error', (error) => {
    logger.error(`WebSocket connection error: ${error.message}`, { stack: error.stack });
  });
});

process.on('SIGTERM', () => {
  logger.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.log('Server closed');
  });
});