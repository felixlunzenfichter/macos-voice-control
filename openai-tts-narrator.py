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
import pygame
import time
import io
import websockets
import logging
import threading

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
        # Initialize pygame mixer for audio playback
        pygame.mixer.init(frequency=24000, size=-16, channels=1, buffer=512)
        self.tts_enabled = True  # TTS is enabled by default
        self.file_positions = {}
        # Available voices: alloy, echo, fable, onyx, nova, shimmer
        self.voice = "fable"  # British accent
        self.websocket = None
        self.backend_url = "ws://localhost:8080"  # Local backend
        self.audio_lock = threading.Lock()  # Lock for audio playback
        self.current_channel = None  # Track current playing channel
        
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
            
    def play_audio_with_pygame(self, audio_data):
        """Play PCM audio data using pygame (supports immediate stop)"""
        try:
            with self.audio_lock:
                # Stop any currently playing audio
                if self.current_channel and self.current_channel.get_busy():
                    self.current_channel.stop()
                pygame.mixer.stop()  # Stop all channels
                pygame.mixer.music.stop()
                
                # Convert raw PCM to pygame Sound
                sound = pygame.mixer.Sound(buffer=audio_data)
                
                # Play the sound
                self.current_channel = sound.play()
                
                # Wait for playback to complete, but check TTS status
                while self.current_channel and self.current_channel.get_busy():
                    if not self.tts_enabled:
                        # Stop immediately if TTS is disabled
                        self.current_channel.set_volume(0)  # Mute first
                        self.current_channel.stop()
                        pygame.mixer.stop()  # Stop all sounds
                        pygame.mixer.music.stop()
                        print("🔇 Audio playback stopped - TTS disabled")
                        break
                    pygame.time.wait(10)  # Check every 10ms
                
                # Clear channel reference when done
                self.current_channel = None
            
        except Exception as e:
            print(f"Error playing audio: {e}")
            
    def check_airpods_connected(self):
        """Check if AirPods Max are connected"""
        # With pygame, we don't need to check specific devices
        # Audio will play through the default output device
        # Return True to indicate we can play audio
        return True
    
    def narrate_text(self, text):
        """Convert text to speech and play it"""
        # Check if TTS is enabled
        if not self.tts_enabled:
            print("🔇 TTS is disabled - skipping narration")
            return
            
        print(f"🗣️ Narrating: {text[:100]}..." if len(text) > 100 else f"🗣️ Narrating: {text}")
        
        # Generate speech
        audio_data = self.text_to_speech(text)
        
        if audio_data:
            # Play the audio using pygame (supports immediate stop)
            self.play_audio_with_pygame(audio_data)
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
            
    async def connect_to_backend(self):
        """Connect to backend WebSocket server"""
        try:
            self.websocket = await websockets.connect(self.backend_url)
            
            # Identify as TTS Narrator
            await self.websocket.send(json.dumps({
                "type": "identify",
                "clientType": "receiver",
                "clientName": "TTS Narrator"
            }))
            
            print(f"✅ Connected to backend at {self.backend_url}")
            
        except Exception as e:
            print(f"⚠️  Could not connect to backend: {e}")
            self.websocket = None
    
    async def handle_backend_messages(self):
        """Handle messages from backend (mainly pings)"""
        if not self.websocket:
            return
            
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    
                    # Respond to pings
                    if data.get('type') == 'ping':
                        ping_id = data.get('pingId')
                        pong_response = {
                            "type": "pong",
                            "pingId": ping_id
                        }
                        await self.websocket.send(json.dumps(pong_response))
                    
                    # Handle TTS toggle
                    elif data.get('type') == 'ttsToggle':
                        self.tts_enabled = data.get('enabled', True)
                        status = "enabled" if self.tts_enabled else "disabled"
                        print(f"🔊 TTS {status} via toggle command")
                        
                        # If TTS is being disabled, stop any currently playing audio
                        if not self.tts_enabled:
                            with self.audio_lock:
                                # Stop the specific channel if it's playing
                                if self.current_channel and self.current_channel.get_busy():
                                    self.current_channel.set_volume(0)  # Mute first
                                    self.current_channel.stop()
                                pygame.mixer.stop()  # Stop all playing sounds
                                pygame.mixer.music.stop()  # Also stop music channel
                                print("🔇 Stopped all playing audio")
                        
                        # Send confirmation back to backend
                        confirmation = {
                            "type": "ttsStateConfirm",
                            "enabled": self.tts_enabled
                        }
                        await self.websocket.send(json.dumps(confirmation))
                        print(f"✅ Sent TTS state confirmation: {self.tts_enabled}")
                        
                except json.JSONDecodeError:
                    continue
                    
        except websockets.exceptions.ConnectionClosed:
            print("⚠️  Backend connection closed")
            self.websocket = None
        except Exception as e:
            print(f"⚠️  Error handling backend messages: {e}")
            self.websocket = None
    
    async def run(self):
        """Main event loop"""
        print("OpenAI TTS Narrator")
        print(f"Using voice: {self.voice} (tts-1 model @ $15/1M chars)")
        print("Connecting to backend...")
        
        # Connect to backend for status monitoring
        await self.connect_to_backend()
        
        print("Ready to narrate Claude messages...")
        print()
        
        try:
            # Run both tasks concurrently
            if self.websocket:
                await asyncio.gather(
                    self.monitor_transcripts(),
                    self.handle_backend_messages()
                )
            else:
                # Just monitor transcripts if no backend connection
                await self.monitor_transcripts()
        except KeyboardInterrupt:
            print("\nShutting down narrator...")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            if self.websocket:
                await self.websocket.close()
            pygame.mixer.quit()


async def main():
    """Entry point"""
    narrator = OpenAITTSNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())