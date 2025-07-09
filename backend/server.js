const express = require('express');
const { WebSocketServer } = require('ws');
const speech = require('@google-cloud/speech');

const app = express();
const PORT = process.env.PORT || 8080;

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Speech Transcription Backend',
    timestamp: new Date().toISOString()
  });
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Google Speech client
const speechClient = new speech.SpeechClient();

// Track connected clients by type and name
const clients = {
  transcribers: new Set(),  // iOS devices sending audio
  receivers: new Map()      // Mac clients receiving transcriptions (name -> ws)
};

// Get current server statuses with active health check
async function getServerStatuses() {
  const statuses = {
    "Backend": true,  // Backend is always true if we're responding
    "Mac Server": false
  };
  
  // Check if Mac Server is actually responsive
  const macServer = clients.receivers.get("Mac Server");
  if (macServer && macServer.readyState === 1) { // 1 = OPEN
    try {
      // Send ping and wait for pong
      const pingId = Date.now().toString();
      const pongPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(false), 1000); // 1 second timeout
        
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
      
      macServer.send(JSON.stringify({ type: 'ping', pingId }));
      statuses["Mac Server"] = await pongPromise;
    } catch (error) {
      console.log('Error pinging Mac Server:', error);
      statuses["Mac Server"] = false;
    }
  }
  
  // TTS is now integrated into Mac Server, no separate check needed
  
  return statuses;
}


// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  let clientType = 'transcriber'; // Default to transcriber for backward compatibility
  let recognizeStream = null;
  let previousTranscript = '';  // Track previous transcript for delta calculation
  let forwardingEnabled = true;  // Control whether to forward transcriptions to Mac
  
  // Send initial connection confirmation with server statuses
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
      // Check if it's a control message (JSON) or audio data (binary)
      if (Buffer.isBuffer(data) && data.length > 100) {
        // This is audio data - send directly without resampling
        console.log(`Received audio data: ${data.length} bytes`);
        if (recognizeStream && !recognizeStream.destroyed) {
          // Check if audio has actual content
          const samples = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
          let maxAmplitude = 0;
          for (let i = 0; i < Math.min(100, samples.length); i++) {
            maxAmplitude = Math.max(maxAmplitude, Math.abs(samples[i]));
          }
          console.log(`Max amplitude in audio: ${maxAmplitude}`);
          
          recognizeStream.write(data);
        } else {
          console.log('No active recognition stream');
        }
      } else if (data.toString().startsWith('{')) {
        // This is a JSON control message
        const message = JSON.parse(data.toString());
        
        if (message.type === 'identify') {
          // Client is identifying itself
          clientType = message.clientType || 'transcriber';
          const clientName = message.clientName || clientType;
          console.log(`Client identified as: ${clientType} (${clientName})`);
          
          // Add to appropriate client set
          if (clientType === 'receiver') {
            clients.receivers.set(clientName, ws);
            console.log(`Receiver '${clientName}' connected. Total receivers: ${clients.receivers.size}`);
          } else {
            clients.transcribers.add(ws);
            console.log(`Transcriber connected. Total transcribers: ${clients.transcribers.size}`);
          }
          
          // Confirm identification
          getServerStatuses().then(statuses => {
            ws.send(JSON.stringify({
              type: 'connection',
              status: 'identified',
              clientType: clientType,
              serverStatuses: statuses
            }));
          });
          
        } else if (message.type === 'start') {
          // Check if any receivers are connected before starting expensive speech recognition
          if (clients.receivers.size === 0) {
            console.log('No receivers connected - skipping speech recognition to save costs');
            ws.send(JSON.stringify({ 
              type: 'info', 
              message: 'No receivers connected - speech recognition disabled to save costs' 
            }));
            return;
          }
          
          // Start new recognition stream
          const sampleRate = message.sampleRate || 44100;
          console.log(`Starting recognition stream at ${sampleRate}Hz`);
          
          const request = {
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: sampleRate,  // Use actual sample rate from client
              languageCode: message.languageCode || 'en-US',
              enableAutomaticPunctuation: true,
              model: 'latest_long',
            },
            interimResults: true,
          };
          
          recognizeStream = speechClient
            .streamingRecognize(request)
            .on('error', (error) => {
              console.error('Recognition error:', error);
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
                
                // Calculate delta
                let delta = '';
                if (transcript.startsWith(previousTranscript)) {
                  // Extract only the new part
                  delta = transcript.substring(previousTranscript.length);
                } else {
                  // If it doesn't start with previous, send the whole thing
                  // This happens when Google revises the transcript
                  delta = transcript;
                }
                
                // Create transcript message
                const transcriptMessage = {
                  type: 'transcript',
                  transcript: transcript,      // Full transcript for reference
                  delta: delta,                // Only the new part
                  isFinal: isFinal,
                  timestamp: new Date().toISOString()
                };
                
                // Send to original transcriber
                ws.send(JSON.stringify(transcriptMessage));
                
                // Broadcast to all receivers only if forwarding is enabled
                if (forwardingEnabled) {
                  const messageStr = JSON.stringify(transcriptMessage);
                  for (const [name, receiver] of clients.receivers.entries()) {
                    if (receiver.readyState === receiver.OPEN) {
                      receiver.send(messageStr);
                    }
                  }
                  
                  console.log(`${isFinal ? 'Final' : 'Interim'}: ${transcript} (delta: "${delta}")`);
                  if (clients.receivers.size > 0) {
                    console.log(`Broadcast to ${clients.receivers.size} receiver(s)`);
                  }
                } else {
                  console.log(`${isFinal ? 'Final' : 'Interim'}: ${transcript} (forwarding disabled)`);
                }
                
                // Update previous transcript
                if (isFinal) {
                  // Reset for next utterance
                  previousTranscript = '';
                } else {
                  // Keep track for next interim
                  previousTranscript = transcript;
                }
              }
            });
            
        } else if (message.type === 'requestStatus') {
          // Client is requesting current server statuses
          const statuses = await getServerStatuses();
          ws.send(JSON.stringify({
            type: 'serverStatusUpdate',
            serverStatuses: statuses
          }));
          
        } else if (message.type === 'stop') {
          // Stop recognition
          if (recognizeStream) {
            recognizeStream.end();
            recognizeStream = null;
            console.log('Stopped recognition stream');
          }
          
        } else if (message.type === 'stopForwarding') {
          // Stop forwarding transcriptions to Mac receivers
          forwardingEnabled = false;
          console.log('Stopped forwarding transcriptions to Mac');
          ws.send(JSON.stringify({ 
            type: 'forwardingStatus', 
            forwarding: false 
          }));
          
        } else if (message.type === 'startForwarding') {
          // Resume forwarding transcriptions to Mac receivers
          forwardingEnabled = true;
          console.log('Resumed forwarding transcriptions to Mac');
          ws.send(JSON.stringify({ 
            type: 'forwardingStatus', 
            forwarding: true 
          }));
          
        } else if (message.type === 'keyPress') {
          // Forward key press to Mac receivers
          const keyPressMessage = {
            type: 'keyPress',
            key: message.key,
            timestamp: new Date().toISOString()
          };
          
          console.log(`Forwarding key press: ${message.key}`);
          
          // Send to all receivers
          const messageStr = JSON.stringify(keyPressMessage);
          for (const [name, receiver] of clients.receivers.entries()) {
            if (receiver.readyState === receiver.OPEN) {
              receiver.send(messageStr);
              console.log(`Sent key press to receiver: ${name}`);
            }
          }
        } else if (message.type === 'ttsToggle') {
          console.log(`Received TTS toggle request: ${message.enabled}`);
          // Forward TTS toggle to Mac Server
          const ttsToggleMessage = {
            type: 'ttsToggle',
            enabled: message.enabled,
            timestamp: new Date().toISOString()
          };
          
          console.log(`Forwarding TTS toggle: ${message.enabled}`);
          
          // Send to Mac Server
          const macServer = clients.receivers.get("Mac Server");
          if (macServer && macServer.readyState === macServer.OPEN) {
            macServer.send(JSON.stringify(ttsToggleMessage));
            console.log(`Sent TTS toggle to Mac Server: ${message.enabled}`);
            // Don't send immediate confirmation - wait for Mac Server to confirm
          } else {
            console.log('Mac Server not connected');
            ws.send(JSON.stringify({
              type: 'error',
              error: 'Mac Server not connected'
            }));
          }
        } else if (message.type === 'ttsStateConfirm') {
          console.log(`Received TTS state confirmation from Mac Server: ${message.enabled}`);
          // Forward confirmation to all transcribers (iPhone apps)
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
              console.log(`Sent TTS state confirmation to transcriber #${sentCount}: ${message.enabled}`);
            }
          }
          console.log(`Total transcribers notified: ${sentCount}`);
          
          if (sentCount === 0) {
            console.log('WARNING: No transcribers connected to receive TTS state confirmation');
          }
        } else {
          console.log(`Unknown message type: ${message.type}`);
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        error: error.message 
      }));
    }
  });
  
  ws.on('close', () => {
    console.log(`${clientType} disconnected`);
    
    // Remove from client sets
    let wasReceiver = false;
    
    // Check all receiver entries and remove matching websocket
    for (const [name, socket] of clients.receivers.entries()) {
      if (socket === ws) {
        clients.receivers.delete(name);
        wasReceiver = true;
        console.log(`Receiver '${name}' disconnected`);
        break;
      }
    }
    
    clients.transcribers.delete(ws);
    
    console.log(`Active clients - Transcribers: ${clients.transcribers.size}, Receivers: ${clients.receivers.size}`);
    
    
    if (recognizeStream) {
      recognizeStream.end();
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
  });
});