#!/usr/bin/env python3
"""
Gemini Live API Interactive Narrator for Claude Code

This script provides voice narration for Claude Code output and allows
voice conversations with Gemini using microphone input.

Requirements:
- Set GOOGLE_API_KEY environment variable
- Use headphones to prevent echo/feedback
- pip install google-genai pyaudio

Usage:
    python gemini-narrator-interactive.py
"""

import asyncio
import os
import sys
import pyaudio
import json
from pathlib import Path
from google import genai
import threading
import queue

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
SEND_SAMPLE_RATE = 16000  # Microphone input rate
RECEIVE_SAMPLE_RATE = 24000  # Speaker output rate
CHUNK_SIZE = 512

# Model configuration
MODEL = "models/gemini-2.0-flash-exp"

# System instruction
SYSTEM_INSTRUCTION = """You are a voice assistant helping a developer who is using Claude Code. 
Your role is to:
1. Narrate what Claude has done when you receive updates
2. Answer questions about the code or Claude's work
3. Have natural conversations to assist with development
4. Be concise but helpful

The developer is looking away from their screen to preserve eyesight, so be their eyes."""


class InteractiveGeminiNarrator:
    """Interactive narrator with microphone input and speaker output"""
    
    def __init__(self):
        self.pya = pyaudio.PyAudio()
        self.file_positions = {}
        self.client = genai.Client()
        self.session = None
        self.audio_out_queue = queue.Queue()
        self.audio_in_queue = queue.Queue()
        self.mic_stream = None
        self.speaker_stream = None
        self.running = False
        
    def setup_audio_streams(self):
        """Setup microphone and speaker streams"""
        # Microphone stream
        self.mic_stream = self.pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=SEND_SAMPLE_RATE,
            input=True,
            stream_callback=self.mic_callback,
            frames_per_buffer=CHUNK_SIZE,
        )
        
        # Speaker stream
        self.speaker_stream = self.pya.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RECEIVE_SAMPLE_RATE,
            output=True,
            frames_per_buffer=CHUNK_SIZE,
        )
        
    def mic_callback(self, in_data, frame_count, time_info, status):
        """Callback for microphone input"""
        if self.session and self.running:
            # Queue audio data to be sent in the main event loop
            if hasattr(self, 'audio_in_queue'):
                self.audio_in_queue.put_nowait(in_data)
                # Debug: Show we're receiving audio
                if not hasattr(self, '_audio_received'):
                    self._audio_received = True
                    print("🎙️ Microphone is receiving audio data...")
        return (None, pyaudio.paContinue)
        
    async def send_audio(self, audio_data):
        """Send audio data to Gemini"""
        try:
            if self.session:
                # Send audio in the correct format
                await self.session.send(input={"data": audio_data, "mime_type": "audio/pcm"})
                # Debug: Show first send
                if not hasattr(self, '_first_audio_sent'):
                    self._first_audio_sent = True
                    print(f"📤 Sending audio to Gemini (chunk size: {len(audio_data)} bytes)")
        except Exception as e:
            print(f"Error sending audio: {e}")
            
    async def process_audio_input(self):
        """Process audio from the input queue"""
        while self.running:
            try:
                # Get audio from queue with timeout
                audio_data = await asyncio.get_event_loop().run_in_executor(
                    None, self.audio_in_queue.get, True, 0.1
                )
                await self.send_audio(audio_data)
            except queue.Empty:
                await asyncio.sleep(0.01)
            except Exception as e:
                if self.running:
                    print(f"Error processing audio input: {e}")
            
    def play_audio_thread(self):
        """Thread for playing audio from queue"""
        while self.running:
            try:
                audio_data = self.audio_out_queue.get(timeout=0.1)
                if audio_data and self.speaker_stream:
                    self.speaker_stream.write(audio_data)
                    if not hasattr(self, '_audio_played'):
                        self._audio_played = True
                        print(f"🔈 Playing audio ({len(audio_data)} bytes)")
            except queue.Empty:
                continue
            except Exception as e:
                print(f"Error playing audio: {e}")
                
    async def receive_from_gemini(self):
        """Receive responses from Gemini"""
        try:
            async for response in self.session.receive():
                if response.server_content and response.server_content.model_turn:
                    for part in response.server_content.model_turn.parts:
                        if part.inline_data and part.inline_data.mime_type.startswith("audio"):
                            # Queue audio for playback
                            self.audio_out_queue.put(part.inline_data.data)
                            if not hasattr(self, '_first_audio_response'):
                                self._first_audio_response = True
                                print("🔊 Receiving audio response from Gemini")
                        if part.text:
                            print(f"\nGemini: {part.text}")
        except Exception as e:
            print(f"Error receiving from Gemini: {e}")
            
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
        
        while self.running:
            try:
                # Find the most recent transcript file
                transcript_files = sorted(transcript_dir.glob('*.jsonl'), 
                                        key=lambda p: p.stat().st_mtime, 
                                        reverse=True)
                
                if transcript_files:
                    latest_transcript = transcript_files[0]
                    
                    # Extract only NEW messages
                    new_messages = self.extract_new_messages(latest_transcript)
                    
                    # Send each new message to Gemini
                    for message in new_messages:
                        # Truncate if too long
                        if len(message) > 2000:
                            message = message[:2000] + "..."
                        
                        print(f"\nNew Claude message detected ({len(message)} chars)")
                        
                        # Send to Gemini for narration
                        if self.session:
                            await self.session.send(
                                input=f"Claude just completed this action: {message}",
                                end_of_turn=True
                            )
                        
                        # Small delay between messages
                        await asyncio.sleep(0.5)
                        
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                
            # Check every second
            await asyncio.sleep(1)
            
    async def run(self):
        """Main event loop"""
        print("Initializing Interactive Gemini narrator...")
        print("Setting up audio streams...")
        
        self.setup_audio_streams()
        self.running = True
        
        # Start audio playback thread
        audio_thread = threading.Thread(target=self.play_audio_thread)
        audio_thread.start()
        
        config = {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {"prebuilt_voice_config": {"voice_name": "Aoede"}},
            },
            "system_instruction": SYSTEM_INSTRUCTION,
        }
        
        try:
            # Connect to Gemini Live API
            async with self.client.aio.live.connect(model=MODEL, config=config) as session:
                self.session = session
                
                print("\n✅ Connected to Gemini Live API")
                print("🎤 Microphone is active - you can speak anytime")
                print("📝 Monitoring Claude transcripts for narration")
                print("\nSpeak to have a conversation or ask questions!")
                print("Press Ctrl+C to stop\n")
                
                # Start microphone stream
                self.mic_stream.start_stream()
                
                # Start concurrent tasks
                await asyncio.gather(
                    self.receive_from_gemini(),
                    self.monitor_transcripts(),
                    self.process_audio_input()
                )
                    
        except KeyboardInterrupt:
            print("\n\nShutting down narrator...")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            self.running = False
            
            # Cleanup
            if self.mic_stream:
                self.mic_stream.stop_stream()
                self.mic_stream.close()
            if self.speaker_stream:
                self.speaker_stream.stop_stream()
                self.speaker_stream.close()
            self.pya.terminate()
            
            # Wait for audio thread
            audio_thread.join()


async def main():
    """Entry point"""
    narrator = InteractiveGeminiNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())