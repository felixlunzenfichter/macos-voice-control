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
from pathlib import Path
from google import genai

# Load .env file if it exists
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value

# Check for API key (supports both names)
api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_AI_API_KEY")
if not api_key:
    print("Please set the GOOGLE_API_KEY or GOOGLE_AI_API_KEY environment variable")
    sys.exit(1)

# Set the API key for the Google AI SDK
os.environ["GOOGLE_API_KEY"] = api_key

# Audio configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
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


class GeminiNarrator:
    """Handles Gemini Live API connection and narration"""
    
    def __init__(self):
        self.session = None
        self.audio_queue = None
        self.pya = pyaudio.PyAudio()
        
    async def play_audio(self):
        """Play audio responses from Gemini"""
        stream = self.pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        
        try:
            while True:
                audio_data = await self.audio_queue.get()
                stream.write(audio_data)
        except Exception as e:
            print(f"Error in play_audio: {e}")
        finally:
            stream.stop_stream()
            stream.close()
            
    async def receive_audio(self):
        """Receive audio from Gemini and put in queue"""
        try:
            async for response in self.session.receive():
                if response.server_content:
                    if response.server_content.model_turn:
                        for part in response.server_content.model_turn.parts:
                            if part.inline_data and part.inline_data.mime_type.startswith("audio"):
                                self.audio_queue.put_nowait(part.inline_data.data)
                                
                            if part.text:
                                print(f"Gemini: {part.text}")
        except Exception as e:
            print(f"Error in receive_audio: {e}")
            
    async def send_text(self, text: str):
        """Send text to Gemini for narration"""
        if self.session:
            try:
                await self.session.send_client_content(genai.ClientContent([text]))
            except Exception as e:
                print(f"Error sending text: {e}")
                
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
            
    async def run(self):
        """Main event loop"""
        print("Initializing Gemini narrator...")
        
        # Initialize the client
        client = genai.Client()
        
        # Create configuration
        config = {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}},
            },
            "system_instruction": SYSTEM_INSTRUCTION,
        }
        
        # Connect to Gemini Live API
        try:
            async with client.aio.live.connect(model=MODEL, config=config) as session:
                self.session = session
                self.audio_queue = asyncio.Queue()
                
                print("Connected to Gemini Live API")
                print("Narrator is ready. Waiting for Claude transcripts...")
                print()
                
                # Start tasks
                async with asyncio.TaskGroup() as tg:
                    tg.create_task(self.receive_audio())
                    tg.create_task(self.play_audio())
                    tg.create_task(self.monitor_transcripts())
                    
        except KeyboardInterrupt:
            print("\nShutting down narrator...")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.pya.terminate()


async def main():
    """Entry point"""
    narrator = GeminiNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())