#!/usr/bin/env python3
"""
Gemini Live API Narrator for Claude Code - Simple Connect-Per-Message Version

This script provides voice narration for Claude Code output using the Gemini Live API.
It connects to Gemini for each message, avoiding timeout issues.

Requirements:
- Set GOOGLE_API_KEY environment variable
- Use headphones to prevent echo/feedback
- pip install google-genai pyaudio

Usage:
    python gemini-narrator-simple.py
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

# Check for API key
api_key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_AI_API_KEY")
if not api_key:
    print("Please set the GOOGLE_API_KEY or GOOGLE_AI_API_KEY environment variable")
    sys.exit(1)

os.environ["GOOGLE_API_KEY"] = api_key

# Audio configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 512

# Model configuration
MODEL = "models/gemini-2.0-flash-exp"

# System instruction
SYSTEM_INSTRUCTION = """You are a voice narrator for Claude Code. Keep narrations brief and focused on what was accomplished. The developer is looking away from their screen to preserve eyesight, so be their eyes."""


class SimpleGeminiNarrator:
    """Simple narrator that connects per message"""
    
    def __init__(self):
        self.pya = pyaudio.PyAudio()
        self.file_positions = {}
        self.client = genai.Client()
        
    async def narrate_message(self, message: str):
        """Connect to Gemini, send message, play response, disconnect"""
        print(f"Narrating message ({len(message)} chars)...")
        
        config = {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}},
            },
            "system_instruction": SYSTEM_INSTRUCTION,
        }
        
        audio_stream = self.pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        
        try:
            # Connect, send, receive, disconnect
            async with self.client.aio.live.connect(model=MODEL, config=config) as session:
                # Send the message
                await session.send(input=f"Claude just said: {message}", end_of_turn=True)
                
                # Receive and play audio response
                async for response in session.receive():
                    if response.server_content and response.server_content.model_turn:
                        for part in response.server_content.model_turn.parts:
                            if part.inline_data and part.inline_data.mime_type.startswith("audio"):
                                audio_stream.write(part.inline_data.data)
                            if part.text:
                                print(f"Gemini: {part.text}")
                        
                        # Stop after first complete response
                        if response.server_content.turn_complete:
                            break
                            
        except Exception as e:
            print(f"Error narrating: {e}")
        finally:
            audio_stream.stop_stream()
            audio_stream.close()
                
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
                    latest_transcript = transcript_files[0]
                    
                    # Extract only NEW messages
                    new_messages = self.extract_new_messages(latest_transcript)
                    
                    # Narrate each new message
                    for message in new_messages:
                        # Truncate if too long
                        if len(message) > 2000:
                            message = message[:2000] + "..."
                        
                        # Connect, narrate, disconnect
                        await self.narrate_message(message)
                        
                        # Small delay between messages
                        await asyncio.sleep(0.5)
                        
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                
            # Check every second
            await asyncio.sleep(1)
            
    async def run(self):
        """Main event loop"""
        print("Initializing Simple Gemini narrator...")
        print("Narrator is ready. Monitoring for NEW Claude messages...")
        print()
        
        try:
            await self.monitor_transcripts()
        except KeyboardInterrupt:
            print("\nShutting down narrator...")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.pya.terminate()


async def main():
    """Entry point"""
    narrator = SimpleGeminiNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())