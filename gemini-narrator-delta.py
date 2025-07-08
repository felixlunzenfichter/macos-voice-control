#!/usr/bin/env python3
"""
Gemini Live API Narrator for Claude Code - Delta Version

This script provides voice narration for Claude Code output using the Gemini Live API.
It monitors Claude's transcript files and only narrates NEW messages (delta).

Requirements:
- Set GOOGLE_API_KEY environment variable
- Use headphones to prevent echo/feedback
- pip install google-genai pyaudio

Usage:
    python gemini-narrator-delta.py
"""

import asyncio
import os
import sys
import pyaudio
import json
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
        # Track file positions for each transcript
        self.file_positions = {}
        # Track startup time
        self.startup_time = None
        
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
                await self.session.send(input=text, end_of_turn=True)
            except Exception as e:
                print(f"Error sending text: {e}")
                
    def extract_new_messages(self, jsonl_path):
        """Extract only NEW assistant messages from JSONL transcript"""
        new_messages = []
        file_path_str = str(jsonl_path)
        
        # Get the last position we read from this file
        last_position = self.file_positions.get(file_path_str, 0)
        
        try:
            with open(jsonl_path, 'r') as f:
                # Seek to last position
                f.seek(last_position)
                
                # Read new lines
                for line in f:
                    if line.strip():
                        try:
                            entry = json.loads(line)
                            if entry.get('type') == 'assistant':
                                message = entry.get('message', {})
                                content = message.get('content', [])
                                for item in content:
                                    if item.get('type') == 'text' and item.get('text'):
                                        new_messages.append(item['text'])
                        except json.JSONDecodeError:
                            continue
                
                # Update file position
                self.file_positions[file_path_str] = f.tell()
                
        except Exception as e:
            print(f"Error reading transcript: {e}")
            
        return new_messages
        
    async def monitor_transcripts(self):
        """Monitor Claude transcript files for NEW messages only"""
        transcript_dir = Path.home() / '.claude' / 'projects' / '-Users-felixlunzenfichter'
        
        # Initialize file positions to END of all current files on startup
        print("Initializing file positions to current end...")
        for transcript_file in transcript_dir.glob('*.jsonl'):
            with open(transcript_file, 'rb') as f:
                # Seek to end of file
                f.seek(0, 2)
                self.file_positions[str(transcript_file)] = f.tell()
        print(f"Tracking {len(self.file_positions)} transcript files")
        
        while True:
            try:
                # Find the most recent transcript file
                transcript_files = sorted(transcript_dir.glob('*.jsonl'), 
                                        key=lambda p: p.stat().st_mtime, 
                                        reverse=True)
                
                if transcript_files:
                    # Check the most recent transcript file
                    latest_transcript = transcript_files[0]
                    
                    # Extract only NEW messages
                    new_messages = self.extract_new_messages(latest_transcript)
                    
                    # Send each new message
                    for message in new_messages:
                        # Truncate if too long
                        if len(message) > 2000:
                            message = message[:2000] + "..."
                            
                        print(f"New assistant message detected ({len(message)} chars)")
                        await self.send_text(f"Claude just said: {message}")
                        
                        # Small delay between messages to avoid overwhelming
                        await asyncio.sleep(0.5)
                        
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
                print("Narrator is ready. Monitoring for NEW Claude messages...")
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