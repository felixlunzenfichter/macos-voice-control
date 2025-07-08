#!/usr/bin/env python3
"""
Gemini Live API Narrator for Claude Code

This script provides voice narration for Claude Code output using the Gemini Live API.
It receives text transcripts from Claude hooks and narrates what Claude has done.

Requirements:
- Set GOOGLE_API_KEY environment variable
- Use headphones to prevent echo/feedback
- pip install google-genai pyaudio

Usage:
    python gemini-narrator.py
"""

import asyncio
import os
import sys
import pyaudio
from typing import AsyncIterator
from google import genai

# Check for API key
if "GOOGLE_API_KEY" not in os.environ:
    print("Please set the GOOGLE_API_KEY environment variable")
    sys.exit(1)

# Audio configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 512

# Model configuration
MODEL = "models/gemini-2.0-flash-exp"

# System instruction for the narrator
SYSTEM_INSTRUCTION = """You are a voice narrator for Claude Code, an AI coding assistant. Your role is to:

1. Narrate what Claude has just completed when you receive transcript updates
2. Keep narrations concise and focused on what was accomplished
3. Answer questions about the code or Claude's work when asked
4. Be conversational but brief - developers want quick updates, not long explanations

You will receive HTML transcripts showing Claude's work. Focus on:
- What files were created or modified
- What functionality was implemented
- Any errors or issues encountered
- The overall task completion status

Remember: The developer is looking away from their screen to preserve eyesight, so be their eyes."""


class AudioLoop:
    """Handles bidirectional audio streaming with Gemini Live API"""
    
    def __init__(self):
        self.audio_in_queue = None
        self.audio_out_queue = None
        self.session = None
        self.send_text_task = None
        
    async def send_text(self, text: str):
        """Send text to Gemini for narration"""
        if self.session and self.session._send_queue:
            await self.session._send_queue.put({"text": text})
            
    async def listen_audio(self) -> AsyncIterator[bytes]:
        """Capture audio from microphone"""
        pya = pyaudio.PyAudio()
        
        stream = pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        
        try:
            while True:
                data = await asyncio.to_thread(stream.read, CHUNK_SIZE)
                yield data
        finally:
            stream.stop_stream()
            stream.close()
            pya.terminate()
            
    async def receive_audio(self):
        """Play audio responses from Gemini"""
        pya = pyaudio.PyAudio()
        
        stream = pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        
        try:
            while True:
                async for response in self.session.receive():
                    if response.audio:
                        stream.write(response.audio.data)
                        
                    if response.text:
                        print(f"Gemini: {response.text}")
        except Exception as e:
            print(f"Error in receive_audio: {e}")
        finally:
            stream.stop_stream()
            stream.close()
            pya.terminate()
            
    async def run(self):
        """Main event loop"""
        print("Initializing Gemini narrator...")
        
        # Initialize the client
        client = genai.Client()
        
        # Create configuration with system instruction
        config = {
            "generation_config": {
                "response_modalities": ["AUDIO"],
                "speech_config": {
                    "voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}},
                },
            },
            "system_instruction": SYSTEM_INSTRUCTION,
        }
        
        # Connect to Gemini Live API
        async with client.aio.live.connect(model=MODEL, config=config) as session:
            self.session = session
            print("Connected to Gemini Live API")
            print("Narrator is ready. Waiting for Claude transcripts...")
            print("You can also speak to ask questions.\n")
            
            # Start audio tasks
            async def send_audio():
                async for chunk in self.listen_audio():
                    await session.send({"audio": chunk})
                    
            send_task = asyncio.create_task(send_audio())
            receive_task = asyncio.create_task(self.receive_audio())
            
            # Create a task for monitoring transcript updates
            monitor_task = asyncio.create_task(self.monitor_transcripts())
            
            try:
                # Wait for tasks (they run forever unless cancelled)
                await asyncio.gather(send_task, receive_task, monitor_task)
            except KeyboardInterrupt:
                print("\nShutting down narrator...")
            finally:
                send_task.cancel()
                receive_task.cancel()
                monitor_task.cancel()
                
    async def monitor_transcripts(self):
        """Monitor for new Claude transcripts"""
        transcript_path = "/Users/felixlunzenfichter/Documents/claude-transcripts/latest.html"
        last_mtime = 0
        
        while True:
            try:
                # Check if transcript file has been updated
                if os.path.exists(transcript_path):
                    mtime = os.path.getmtime(transcript_path)
                    if mtime > last_mtime:
                        last_mtime = mtime
                        
                        # Read the transcript
                        with open(transcript_path, 'r') as f:
                            content = f.read()
                            
                        # Send to Gemini for narration
                        print("New transcript detected, sending to narrator...")
                        await self.send_text(f"New Claude transcript update:\n{content}")
                        
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                
            # Check every second
            await asyncio.sleep(1)


async def main():
    """Entry point"""
    audio_loop = AudioLoop()
    await audio_loop.run()


if __name__ == "__main__":
    asyncio.run(main())