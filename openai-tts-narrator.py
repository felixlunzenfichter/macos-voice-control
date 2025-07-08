#!/usr/bin/env python3
"""
OpenAI TTS Narrator for Claude Code

Uses OpenAI's Text-to-Speech API for high-quality narration.

Requirements:
- Set OPENAI_API_KEY environment variable
- pip install openai pyaudio

Usage:
    python openai-tts-narrator.py
"""

import asyncio
import os
import sys
import json
from pathlib import Path
from openai import OpenAI
import pyaudio
import io

# Load .env file if it exists
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                if '=' in line:
                    key, value = line.strip().split('=', 1)
                    os.environ[key] = value

# Check for API key
api_key = os.environ.get("OPENAI_API_KEY")
if not api_key:
    print("Please set the OPENAI_API_KEY environment variable")
    sys.exit(1)

# Audio configuration
CHUNK_SIZE = 1024

class OpenAITTSNarrator:
    """Simple narrator using OpenAI TTS"""
    
    def __init__(self):
        self.client = OpenAI(api_key=api_key)
        self.pya = pyaudio.PyAudio()
        self.file_positions = {}
        # Available voices: alloy, echo, fable, onyx, nova, shimmer
        self.voice = "fable"  # British accent
        
    def text_to_speech(self, text):
        """Convert text to speech using OpenAI TTS"""
        try:
            response = self.client.audio.speech.create(
                model="tts-1",  # Using standard model ($15/1M chars)
                voice=self.voice,
                input=text,
                response_format="pcm"  # Raw PCM audio at 24kHz
            )
            
            # Get audio data
            audio_data = response.read()
            return audio_data
            
        except Exception as e:
            print(f"Error generating speech: {e}")
            return None
            
    def play_audio(self, audio_data):
        """Play PCM audio data through speakers"""
        try:
            # Reinitialize PyAudio to detect device changes
            self.pya.terminate()
            self.pya = pyaudio.PyAudio()
            
            # OpenAI returns 24kHz 16-bit mono PCM
            # Try to use the first output device (usually external audio)
            output_device = None
            for i in range(self.pya.get_device_count()):
                info = self.pya.get_device_info_by_index(i)
                if info['maxOutputChannels'] > 0 and 'AirPods Max' in info['name']:
                    output_device = i
                    print(f"🎧 Using output device: {info['name']} (index {i})")
                    break
            
            if output_device is None:
                print("❌ AirPods Max not found! Audio will not play.")
                print("Available output devices:")
                for i in range(self.pya.get_device_count()):
                    info = self.pya.get_device_info_by_index(i)
                    if info['maxOutputChannels'] > 0:
                        print(f"  {i}: {info['name']}")
                return  # Don't play audio if AirPods not found
            
            stream = self.pya.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=24000,
                output=True,
                output_device_index=output_device,
                frames_per_buffer=CHUNK_SIZE
            )
            
            # Play audio in chunks
            for i in range(0, len(audio_data), CHUNK_SIZE):
                chunk = audio_data[i:i + CHUNK_SIZE]
                stream.write(chunk)
            
            stream.stop_stream()
            stream.close()
            
        except Exception as e:
            print(f"Error playing audio: {e}")
            
    def narrate_text(self, text):
        """Convert text to speech and play it"""
        # Don't limit text - narrate everything
        print(f"🗣️ Narrating: {text[:100]}..." if len(text) > 100 else f"🗣️ Narrating: {text}")
        
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
                        # Narrate the full message
                        self.narrate_text(message)
                        
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
        elif "Installing" in message:
            return "Installing dependencies"
        elif "capture-pane" in message:
            return "Checking output"
        elif "?" in message:
            return "Question asked"
        else:
            # Extract key action words
            words = message.split()[:8]  # First 8 words
            return " ".join(words)
            
    async def run(self):
        """Main event loop"""
        print("OpenAI TTS Narrator")
        print(f"Using voice: {self.voice} (tts-1 model @ $15/1M chars)")
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
    narrator = OpenAITTSNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())