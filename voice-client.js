#!/usr/bin/env node

import { spawn } from 'child_process';
import { GeminiLiveClient } from './src/gemini-client.js';
import dotenv from 'dotenv';

dotenv.config();

class VoiceControl {
  constructor() {
    this.apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!this.apiKey) {
      console.error('[ERROR] GOOGLE_AI_API_KEY not set in .env file');
      process.exit(1);
    }
    
    this.geminiClient = new GeminiLiveClient(this.apiKey);
    this.audioCapture = null;
  }

  async start() {
    console.log('[VOICE] Starting macOS Voice Control...');
    
    // Set up Gemini event handlers
    this.geminiClient.on('connected', () => {
      console.log('[VOICE] Connected to Gemini Live API');
      this.startAudioCapture();
    });
    
    this.geminiClient.on('transcription', (text) => {
      console.log(`[TRANSCRIPTION] ${text}`);
    });
    
    this.geminiClient.on('narration', (text) => {
      console.log(`[NARRATION] ${text}`);
    });
    
    this.geminiClient.on('stop', () => {
      console.log('[VOICE] Stop requested by user');
      this.stop();
    });
    
    this.geminiClient.on('error', (error) => {
      console.error('[ERROR]', error);
    });
    
    this.geminiClient.on('disconnected', () => {
      console.log('[VOICE] Disconnected from Gemini');
      this.stop();
    });
    
    // Connect to Gemini
    await this.geminiClient.connect();
  }

  startAudioCapture() {
    console.log('[VOICE] Starting audio capture...');
    
    this.audioCapture = spawn('sox', [
      '-d',                    // default audio device (microphone)
      '-r', '16000',          // sample rate 16kHz
      '-c', '1',              // mono
      '-b', '16',             // 16-bit
      '-e', 'signed-integer', // encoding
      '-t', 'raw',            // raw PCM output
      '-'                     // output to stdout
    ]);
    
    this.audioCapture.stdout.on('data', (chunk) => {
      // Send audio chunks to Gemini
      this.geminiClient.sendAudio(chunk);
    });
    
    this.audioCapture.stderr.on('data', (data) => {
      if (process.env.DEBUG) {
        console.error('[AUDIO]', data.toString());
      }
    });
    
    this.audioCapture.on('error', (error) => {
      console.error('[AUDIO] Failed to start audio capture:', error);
      console.log('[AUDIO] Make sure sox is installed: brew install sox');
    });
    
    console.log('[VOICE] Audio capture started - speak now!');
  }

  stop() {
    console.log('[VOICE] Stopping...');
    
    if (this.audioCapture) {
      this.audioCapture.kill();
      this.audioCapture = null;
    }
    
    if (this.geminiClient) {
      this.geminiClient.disconnect();
    }
    
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[VOICE] Received SIGINT, shutting down...');
  if (voiceControl) {
    voiceControl.stop();
  }
});

// Start the voice control
const voiceControl = new VoiceControl();
voiceControl.start().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});