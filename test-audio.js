#!/usr/bin/env node

import { spawn } from 'child_process';
import fs from 'fs';
import { GeminiLiveClient } from './src/gemini-client.js';
import dotenv from 'dotenv';

dotenv.config();

// Use macOS say command to generate test speech
console.log('[TEST] Generating test audio...');
const sayProcess = spawn('say', [
  '-o', 'test-speech.aiff',
  '-r', '150', // Slower speech rate
  'Hello, this is a test of the voice transcription system. I am speaking slowly and clearly. This is a longer message to ensure we have enough audio data. Can you transcribe what I am saying? Please respond with the transcription of this audio message. Thank you.'
]);

sayProcess.on('close', () => {
  console.log('[TEST] Converting to correct format...');
  
  // Convert to the exact format we need: 16kHz, mono, 16-bit PCM
  const soxProcess = spawn('sox', [
    'test-speech.aiff',
    '-r', '16000',
    '-c', '1', 
    '-b', '16',
    '-e', 'signed-integer',
    '-t', 'raw',
    'test-speech.raw'
  ]);
  
  soxProcess.on('close', () => {
    console.log('[TEST] Audio ready, starting Gemini client...');
    
    // Read the raw audio file
    const audioData = fs.readFileSync('test-speech.raw');
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
          console.log(`[TEST] Sending chunk: ${chunk.length} bytes`);
          geminiClient.sendAudio(chunk);
          offset += chunkSize;
          setTimeout(sendChunk, 100); // Send chunks with small delay
        } else {
          console.log('[TEST] All audio sent, waiting for response...');
        }
      };
      
      sendChunk();
    });
    
    geminiClient.on('transcription', (text) => {
      console.log(`[SUCCESS] Transcription received: ${text}`);
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
  });
});