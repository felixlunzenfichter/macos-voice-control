#!/usr/bin/env node

import fs from 'fs';
import { GeminiLiveClient } from './src/gemini-client.js';
import dotenv from 'dotenv';

dotenv.config();

console.log('[TEST] Starting Gemini test with recorded audio...');

// Read the recorded audio file
const audioData = fs.readFileSync('test-speech-proper.raw');
console.log(`[TEST] Audio size: ${audioData.length} bytes`);

// Connect to Gemini
const geminiClient = new GeminiLiveClient(process.env.GOOGLE_AI_API_KEY);

geminiClient.on('connected', () => {
  console.log('[TEST] Connected, sending audio in chunks...');
  
  // Send audio in chunks like the real app would
  let offset = 0;
  const chunkSize = 8192;
  
  const sendChunk = () => {
    if (offset < audioData.length) {
      const chunk = audioData.slice(offset, offset + chunkSize);
      console.log(`[TEST] Sending chunk: ${chunk.length} bytes (offset: ${offset})`);
      geminiClient.sendAudio(chunk);
      offset += chunkSize;
      setTimeout(sendChunk, 50); // Send chunks with small delay
    } else {
      console.log('[TEST] All audio sent, waiting for response...');
    }
  };
  
  setTimeout(sendChunk, 1000); // Wait for setup to complete
});

geminiClient.on('transcription', (text) => {
  console.log(`\n[SUCCESS] Transcription received: "${text}"\n`);
  process.exit(0);
});

geminiClient.on('narration', (text) => {
  console.log(`[NARRATION] ${text}`);
});

geminiClient.on('error', (error) => {
  console.error('[ERROR]', error);
});

geminiClient.on('disconnected', () => {
  console.log('[TEST] Disconnected');
  process.exit(1);
});

// Connect
geminiClient.connect();

// Timeout after 30 seconds
setTimeout(() => {
  console.log('[TEST] Timeout - no transcription received');
  process.exit(1);
}, 30000);