#!/usr/bin/env python3
"""
Google Text-to-Speech Simple Narrator for Claude Code

Uses Google's REST API with API key (simpler than Cloud SDK).

Requirements:
- Set GOOGLE_API_KEY environment variable
- pip install requests pyaudio

Usage:
    python google-tts-simple.py
"""

import asyncio
import os
import sys
import json
import requests
import base64
from pathlib import Path
import pyaudio
import io
import wave

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
    print("Please set the GOOGLE_API_KEY environment variable")
    sys.exit(1)

# Audio configuration
CHUNK_SIZE = 1024
TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize"

class SimpleGoogleTTSNarrator:
    """Simple narrator using Google TTS REST API"""
    
    def __init__(self):
        self.pya = pyaudio.PyAudio()
        self.file_positions = {}
        self.api_key = api_key
        
    def text_to_speech(self, text):
        """Convert text to speech using REST API"""
        try:
            # Prepare the request
            request_body = {
                "input": {"text": text},
                "voice": {
                    "languageCode": "en-US",
                    "name": "en-US-Standard-J",  # Standard male voice (cheap)
                    "ssmlGender": "MALE"
                },
                "audioConfig": {
                    "audioEncoding": "LINEAR16"  # WAV format
                }
            }
            
            # Make the request
            response = requests.post(
                f"{TTS_ENDPOINT}?key={self.api_key}",
                json=request_body,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                # Decode the audio content from base64
                audio_content = base64.b64decode(response.json()['audioContent'])
                return audio_content
            else:
                print(f"TTS Error: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            print(f"Error generating speech: {e}")
            return None
            
    def play_audio(self, audio_data):
        """Play audio data through speakers"""
        try:
            # Create a wave file in memory
            audio_stream = io.BytesIO()
            
            with wave.open(audio_stream, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(24000)  # Standard rate
                wav_file.writeframes(audio_data)
            
            audio_stream.seek(0)
            
            # Play the audio
            with wave.open(audio_stream, 'rb') as wf:
                stream = self.pya.open(
                    format=self.pya.get_format_from_width(wf.getsampwidth()),
                    channels=wf.getnchannels(),
                    rate=wf.getframerate(),
                    output=True,
                    frames_per_buffer=CHUNK_SIZE
                )
                
                data = wf.readframes(CHUNK_SIZE)
                while data:
                    stream.write(data)
                    data = wf.readframes(CHUNK_SIZE)
                
                stream.stop_stream()
                stream.close()
                
        except Exception as e:
            print(f"Error playing audio: {e}")
            
    def narrate_text(self, text):
        """Convert text to speech and play it"""
        # Limit text length to save costs
        if len(text) > 200:
            text = text[:197] + "..."
            
        print(f"🗣️ Narrating: {text}")
        
        # Generate speech
        audio_data = self.text_to_speech(text)
        
        if audio_data:
            # Play the audio
            self.play_audio(audio_data)
        else:
            print("✗ Failed to generate speech")
            
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
                        # Create a concise summary
                        summary = self.summarize_message(message)
                        self.narrate_text(summary)
                        
                        # Small delay between messages
                        await asyncio.sleep(0.5)
                        
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                
            # Check every second
            await asyncio.sleep(1)
            
    def summarize_message(self, message):
        """Create a concise summary of Claude's action"""
        # Keep it short to save costs
        if "error" in message.lower():
            return "Error occurred"
        elif "created" in message.lower() or "wrote" in message.lower():
            return "File created"
        elif "updated" in message.lower() or "modified" in message.lower():
            return "Code updated"
        elif "running" in message.lower() or "started" in message.lower():
            return "Process started"
        elif "checking" in message.lower():
            return "Checking status"
        elif "?" in message:
            return "Claude asked a question"
        else:
            # Extract key action words
            words = message.split()[:10]  # First 10 words
            return " ".join(words)
            
    async def run(self):
        """Main event loop"""
        print("Google TTS Simple Narrator")
        print("Using standard voice ($4/million chars)")
        print("Ready to narrate Claude messages...")
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
    narrator = SimpleGoogleTTSNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())