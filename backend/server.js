const express = require('express');
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');
const Logger = require('../logs/logger');

const logger = new Logger('backend');

const app = express();
const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
  logger.log('healthCheck', 'Health check endpoint accessed', { ip: req.ip });
  res.json({ 
    status: 'ok', 
    service: 'Speech Transcription Backend',
    timestamp: new Date().toISOString()
  });
});

const server = app.listen(PORT, () => {
  logger.log('startup', `Server running on port ${PORT}`);
});

const wss = new WebSocketServer({ server });
logger.log('startup', 'WebSocket server created');

const speechClient = new speech.SpeechClient();
logger.log('startup', 'Google Speech client initialized');

const clients = {
  transcribers: new Set(),
  receivers: new Map()
};

async function getServerStatuses() {
  logger.log('getServerStatuses', 'Checking server statuses');
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
      
      logger.log('getServerStatuses', `Sending ping to Mac Server with ID: ${pingId}`);
      macServer.send(JSON.stringify({ type: 'ping', pingId }));
      const isResponsive = await pongPromise;
      logger.log('getServerStatuses', `Mac Server ping response: ${isResponsive}`, { pingId, isResponsive });
      statuses["Mac Server"] = isResponsive;
    } catch (error) {
      logger.error('getServerStatuses', 'Error pinging Mac Server', { error: error.message });
      statuses["Mac Server"] = false;
    }
  }
  
  
  return statuses;
}


wss.on('connection', (ws) => {
  logger.log('connection', 'Client connected');
  
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
          logger.log('onMessage', `Audio session started - receiving data`);
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
          logger.error('onMessage', 'No active recognition stream');
        }
      } else if (data.toString().startsWith('{')) {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'identify') {
          clientType = message.clientType || 'transcriber';
          const clientName = message.clientName || clientType;
          logger.log('onMessage', `Client identified as: ${clientType} (${clientName})`, { clientType, clientName });
          
          if (clientType === 'receiver') {
            clients.receivers.set(clientName, ws);
            logger.log('onMessage', `Receiver '${clientName}' connected. Total receivers: ${clients.receivers.size}`, { clientName, totalReceivers: clients.receivers.size });
          } else {
            clients.transcribers.add(ws);
            logger.log('onMessage', `Transcriber connected. Total transcribers: ${clients.transcribers.size}`, { totalTranscribers: clients.transcribers.size });
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
            logger.log('onMessage', 'No receivers connected - skipping speech recognition to save costs');
            ws.send(JSON.stringify({ 
              type: 'info', 
              message: 'No receivers connected - speech recognition disabled to save costs' 
            }));
            return;
          }
          
          const sampleRate = message.sampleRate || 44100;
          logger.log('onMessage', `Starting recognition stream at ${sampleRate}Hz`, { sampleRate, languageCode: message.languageCode || 'en-US' });
          
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
              logger.error('recognizeStream', 'Recognition error', { error: error.message, code: error.code });
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
                  
                  logger.log('recognizeStream', `${isFinal ? 'Final' : 'Interim'} transcript`, { transcript, delta, isFinal });
                  if (clients.receivers.size > 0) {
                    logger.log('recognizeStream', `Broadcast to ${clients.receivers.size} receiver(s)`, { receiversCount: clients.receivers.size });
                  }
                } else {
                  logger.log('recognizeStream', `${isFinal ? 'Final' : 'Interim'} transcript (forwarding disabled)`, { transcript, delta, isFinal, forwardingEnabled: false });
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
            logger.log('onMessage', 'Stopped recognition stream');
          }
          
        } else if (message.type === 'stopForwarding') {
          forwardingEnabled = false;
          logger.log('onMessage', 'Stopped forwarding transcriptions to Mac');
          ws.send(JSON.stringify({ 
            type: 'forwardingStatus', 
            forwarding: false 
          }));
          
        } else if (message.type === 'startForwarding') {
          forwardingEnabled = true;
          logger.log('onMessage', 'Resumed forwarding transcriptions to Mac');
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
          
          logger.log('onMessage', `Forwarding key press: ${message.key}`, { key: message.key });
          
          const messageStr = JSON.stringify(keyPressMessage);
          for (const [name, receiver] of clients.receivers.entries()) {
            if (receiver.readyState === receiver.OPEN) {
              receiver.send(messageStr);
              logger.log('onMessage', `Sent key press to receiver: ${name}`, { receiverName: name, key: message.key });
            }
          }
        } else if (message.type === 'ttsToggle') {
          logger.log('onMessage', `Received TTS toggle request: ${message.enabled}`, { ttsEnabled: message.enabled });
          const ttsToggleMessage = {
            type: 'ttsToggle',
            enabled: message.enabled,
            timestamp: new Date().toISOString()
          };
          
          logger.log('onMessage', `Forwarding TTS toggle: ${message.enabled}`, { ttsEnabled: message.enabled });
          
          const macServer = clients.receivers.get("Mac Server");
          if (macServer && macServer.readyState === macServer.OPEN) {
            macServer.send(JSON.stringify(ttsToggleMessage));
            logger.log('onMessage', `Sent TTS toggle to Mac Server: ${message.enabled}`, { ttsEnabled: message.enabled });
          } else {
            logger.error('onMessage', 'Mac Server not connected for TTS toggle');
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Mac Server not connected'
            }));
          }
        } else if (message.type === 'ttsStateConfirm') {
          logger.log('onMessage', `Received TTS state confirmation from Mac Server: ${message.enabled}`, { ttsEnabled: message.enabled });
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
              logger.log('onMessage', `Sent TTS state confirmation to transcriber #${sentCount}: ${message.enabled}`, { transcriberNum: sentCount, ttsEnabled: message.enabled });
            }
          }
          logger.log('onMessage', `Total transcribers notified: ${sentCount}`, { notifiedCount: sentCount });
          
          if (sentCount === 0) {
            logger.error('onMessage', 'WARNING: No transcribers connected to receive TTS state confirmation');
          }
        } else if (message.type === 'helpMessage') {
          logger.error('onMessage', '🆘 EMERGENCY HELP MESSAGE RECEIVED');
          
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
              logger.error('onMessage', `🆘 Sent emergency transcript to receiver: ${name}`, { receiverName: name });
            }
          }
          
          ws.send(JSON.stringify({
            type: 'helpMessageReceived',
            status: 'Emergency message typed into terminal'
          }));
          
        } else if (message.type === 'micStatus') {
          logger.log('onMessage', `Received mic status: ${message.active ? 'ACTIVE' : 'INACTIVE'}`, { micActive: message.active });
          const micStatusMessage = {
            type: 'micStatus',
            active: message.active,
            timestamp: new Date().toISOString()
          };
          
          logger.log('onMessage', `Forwarding mic status to Mac Server: ${message.active ? 'active' : 'inactive'}`, { micActive: message.active });
          
          const macServer = clients.receivers.get("Mac Server");
          if (macServer && macServer.readyState === macServer.OPEN) {
            macServer.send(JSON.stringify(micStatusMessage));
            logger.log('onMessage', 'Sent mic status to Mac Server', { micActive: message.active });
          } else {
            logger.error('onMessage', 'Mac Server not connected to receive mic status');
          }
          
        } else if (message.type === 'pong') {
          
        } else if (message.type === 'log') {
          const logEntry = {
            timestamp: new Date().toISOString(),
            level: message.level || 'LOG',
            service: 'iOS',
            class: message.class || '',
            function: message.function || '',
            message: message.message,
            ...message.metadata
          };
          
          const logLine = JSON.stringify(logEntry) + '\n';
          require('fs').appendFile(require('path').join(__dirname, '../logs/logs.json'), logLine, (err) => {
            if (err) {
              logger.error('onMessage', 'Failed to write iOS log', { error: err.message });
            }
          });
          
          logger.log('onMessage', 'Received iOS log', { level: message.level, message: message.message });
          
        } else {
          logger.error('onMessage', `Unknown message type: ${message.type}`, { messageType: message.type });
        }
      }
    } catch (error) {
      logger.error('onMessage', 'Error processing message', { error: error.message, stack: error.stack });
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    logger.log('onClose', `${clientType} disconnected`, { clientType });
    
    let wasReceiver = false;
    
    for (const [name, socket] of clients.receivers.entries()) {
      if (socket === ws) {
        clients.receivers.delete(name);
        wasReceiver = true;
        logger.log('onClose', `Receiver '${name}' disconnected`, { receiverName: name });
        break;
      }
    }
    
    clients.transcribers.delete(ws);
    
    logger.log('onClose', `Active clients - Transcribers: ${clients.transcribers.size}, Receivers: ${clients.receivers.size}`, { transcribers: clients.transcribers.size, receivers: clients.receivers.size });
    
    
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
  
  ws.on('error', (error) => {
    logger.error('onError', 'WebSocket error', { error: error.message, stack: error.stack });
  });
});

process.on('SIGTERM', () => {
  logger.log('shutdown', 'SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.log('shutdown', 'Server closed');
  });
});