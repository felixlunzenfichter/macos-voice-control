#!/usr/bin/env python3
"""
OpenAI TTS Narrator for Claude Code - Version 2
Uses macOS afplay for instant audio stopping capability
"""

import asyncio
import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path
from openai import OpenAI
import time
import websockets
import threading

# Load .env file if it exists
env_path = Path(__file__).parent / '.env'
if env_path.exists():
    with open(env_path) as f:
        for line in f:
            if line.strip() and not line.startswith('#'):
                key, value = line.strip().split('=', 1)
                os.environ[key] = value

class OpenAITTSNarrator:
    def __init__(self):
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            print("⚠️  OPENAI_API_KEY not found in environment variables")
            sys.exit(1)
            
        self.client = OpenAI(api_key=api_key)
        self.voice = "fable"
        self.file_positions = {}
        self.websocket = None
        self.backend_url = "ws://localhost:8080"
        self.tts_enabled = True
        self.current_process = None
        self.process_lock = threading.Lock()
        
    def text_to_speech(self, text):
        """Convert text to speech using OpenAI TTS API"""
        try:
            # Make API call to OpenAI
            response = self.client.audio.speech.create(
                model="tts-1",
                voice=self.voice,
                input=text,
                response_format="mp3"
            )
            
            # Save to temporary file
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tmp_file:
                tmp_file.write(response.read())
                return tmp_file.name
                
        except Exception as e:
            print(f"Error generating speech: {e}")
            return None
    
    def play_audio_with_afplay(self, audio_file):
        """Play audio file using macOS afplay (can be killed instantly)"""
        try:
            with self.process_lock:
                # Kill any existing playback
                if self.current_process and self.current_process.poll() is None:
                    self.current_process.terminate()
                    self.current_process.wait()
                
                # Check if TTS is still enabled
                if not self.tts_enabled:
                    print("🔇 TTS disabled - not starting playback")
                    return
                
                # Start new playback
                self.current_process = subprocess.Popen(['afplay', audio_file])
                print(f"▶️  Started afplay process PID: {self.current_process.pid}")
                
                # Wait for completion or interruption
                while self.current_process.poll() is None:
                    if not self.tts_enabled:
                        # Kill the process immediately with SIGKILL
                        print(f"🛑 Killing afplay PID {self.current_process.pid} due to TTS disable")
                        self.current_process.kill()  # SIGKILL
                        try:
                            self.current_process.wait(timeout=1)
                        except subprocess.TimeoutExpired:
                            os.kill(self.current_process.pid, 9)
                        print("🔇 Audio playback killed - TTS disabled")
                        break
                    time.sleep(0.01)  # Check every 10ms
                
                # Clean up
                self.current_process = None
                os.unlink(audio_file)  # Delete temp file
                
        except Exception as e:
            print(f"Error playing audio: {e}")
            if os.path.exists(audio_file):
                os.unlink(audio_file)
    
    def narrate_text(self, text):
        """Convert text to speech and play it"""
        # Check if TTS is enabled
        if not self.tts_enabled:
            print("🔇 TTS is disabled - skipping narration")
            return
            
        print(f"🗣️ Narrating: {text[:100]}..." if len(text) > 100 else f"🗣️ Narrating: {text}")
        
        # Generate speech
        audio_file = self.text_to_speech(text)
        
        if audio_file:
            # Play the audio using afplay
            self.play_audio_with_afplay(audio_file)
        else:
            print("✗ Failed to generate speech")
    
    def summarize_message(self, message):
        """Create a brief summary of Claude's message"""
        # Skip very short messages
        if len(message) < 50:
            return message
            
        # Extract key information
        if "created" in message.lower() or "wrote" in message.lower():
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
                        
                        # If TTS is being disabled, kill any playing audio
                        if not self.tts_enabled:
                            with self.process_lock:
                                if self.current_process and self.current_process.poll() is None:
                                    print(f"🔇 Killing afplay process PID: {self.current_process.pid}")
                                    # Use kill -9 for immediate termination
                                    self.current_process.kill()  # SIGKILL instead of SIGTERM
                                    try:
                                        self.current_process.wait(timeout=1)
                                    except subprocess.TimeoutExpired:
                                        # Force kill if still running
                                        os.kill(self.current_process.pid, 9)
                                    print("🔇 Killed audio playback process immediately")
                                    self.current_process = None
                                else:
                                    print("🔇 No active audio process to kill")
                        
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
        print("\nInitializing file positions to current end...")
        jsonl_files = list(transcript_dir.rglob('*.jsonl'))
        for jsonl_file in jsonl_files:
            try:
                file_path_str = str(jsonl_file)
                with open(jsonl_file, 'r') as f:
                    # Seek to end
                    f.seek(0, 2)
                    self.file_positions[file_path_str] = f.tell()
            except:
                pass
                
        print(f"Tracking {len(self.file_positions)} transcript files")
        
        while True:
            try:
                # Find all JSONL files
                jsonl_files = list(transcript_dir.rglob('*.jsonl'))
                
                for jsonl_file in jsonl_files:
                    # Extract only new messages
                    new_messages = self.extract_new_messages(jsonl_file)
                    
                    # Narrate each new message
                    for message in new_messages:
                        if self.websocket:  # Only narrate if backend is connected
                            # Use full message, not summary
                            self.narrate_text(message)
                            
                await asyncio.sleep(0.5)  # Check every 500ms
                
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                await asyncio.sleep(1)
    
    async def run(self):
        """Main event loop"""
        print("OpenAI TTS Narrator - Version 2 (afplay)")
        print(f"Using voice: {self.voice} (tts-1 model @ $15/1M chars)")
        print("Connecting to backend...")
        
        # Connect to backend for status monitoring
        await self.connect_to_backend()
        
        print("Ready to narrate Claude messages...")
        print("")
        
        # Create tasks for monitoring
        tasks = []
        
        if self.websocket:
            tasks.append(asyncio.create_task(self.handle_backend_messages()))
            
        tasks.append(asyncio.create_task(self.monitor_transcripts()))
        
        # Run all tasks
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    narrator = OpenAITTSNarrator()
    asyncio.run(narrator.run())