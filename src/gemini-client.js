import WebSocket from 'ws';
import { SYSTEM_PROMPT, FUNCTION_DECLARATIONS } from './system-prompt.js';

export class GeminiLiveClient {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.ws = null;
    this.isConnected = false;
    this.handlers = new Map();
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  emit(event, data) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  async connect() {
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    
    this.ws = new WebSocket(wsUrl, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    this.ws.on('open', () => {
      console.log('[GEMINI] Connected to Gemini Live API');
      this.isConnected = true;
      this.sendInitialConfig();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      console.log('[GEMINI] Message received:', JSON.stringify(message).substring(0, 200));
      this.handleMessage(message);
    });

    this.ws.on('error', (error) => {
      console.error('[GEMINI] WebSocket error:', error);
      this.emit('error', error);
    });

    this.ws.on('close', (code, reason) => {
      console.log(`[GEMINI] Disconnected from Gemini Live API (code: ${code}, reason: ${reason})`);
      this.isConnected = false;
      this.emit('disconnected');
    });
  }

  sendInitialConfig() {
    const config = {
      setup: {
        model: 'models/gemini-2.0-flash-exp',
        systemInstruction: {
          parts: [{
            text: SYSTEM_PROMPT
          }]
        },
        tools: [{
          functionDeclarations: FUNCTION_DECLARATIONS
        }]
      }
    };

    this.send(config);
  }

  handleMessage(message) {
    // Handle tool calls (transcription or stop)
    if (message.candidates?.[0]?.content?.parts) {
      const parts = message.candidates[0].content.parts;
      
      for (const part of parts) {
        if (part.functionCall) {
          this.handleFunctionCall(part.functionCall);
        }
        if (part.text) {
          // Screen narration or other text responses
          this.emit('narration', part.text);
        }
      }
    }

  }

  handleFunctionCall(functionCall) {
    const { name, args } = functionCall;
    
    switch (name) {
      case 'transcription':
        console.log('[GEMINI] Transcription:', args.text);
        this.emit('transcription', args.text);
        this.sendFunctionResponse(functionCall.id);
        break;
        
      case 'stop':
        console.log('[GEMINI] Stop requested');
        this.emit('stop');
        this.disconnect();
        break;
        
      default:
        console.warn('[GEMINI] Unknown function call:', name);
    }
  }

  sendFunctionResponse(id, response) {
    this.send({
      toolResponse: {
        id,
        functionResponses: [{
          response
        }]
      }
    });
  }

  sendAudio(audioData) {
    if (!this.isConnected) {
      return;
    }

    const message = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: 'audio/pcm',
          data: audioData.toString('base64')
        }]
      }
    };

    this.send(message);
  }

  sendText(text) {
    if (!this.isConnected) {
      console.warn('[GEMINI] Not connected');
      return;
    }

    const message = {
      clientContent: {
        parts: [{
          text
        }]
      }
    };

    this.send(message);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}