#!/usr/bin/env python3
"""
Google Cloud TTS Narrator for Claude Code

This script provides voice narration for Claude Code output using Google Cloud Text-to-Speech.
Uses standard voices for cost efficiency ($4 per million characters).

Requirements:
- Set GOOGLE_APPLICATION_CREDENTIALS or use gcloud auth
- pip install google-cloud-texttospeech pyaudio

Usage:
    python google-tts-narrator.py
"""

import asyncio
import os
import sys
import json
from pathlib import Path
from google.cloud import texttospeech
import pyaudio
import io
import wave

# Audio configuration for playback
CHUNK_SIZE = 1024

class GoogleTTSNarrator:
    """Simple narrator using Google Cloud Text-to-Speech"""
    
    def __init__(self):
        # Initialize TTS client with default credentials
        self.tts_client = texttospeech.TextToSpeechClient()
        
        # Configure voice (using standard voice for cost efficiency)
        self.voice = texttospeech.VoiceSelectionParams(
            language_code="en-US",
            name="en-US-Standard-J",  # Male voice, you can change to -C for female
            ssml_gender=texttospeech.SsmlVoiceGender.MALE
        )
        
        # Configure audio output
        self.audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.LINEAR16
        )
        
        # PyAudio for playback
        self.pya = pyaudio.PyAudio()
        self.file_positions = {}
        
    def text_to_speech(self, text):
        """Convert text to speech and return audio data"""
        try:
            # Create synthesis input
            synthesis_input = texttospeech.SynthesisInput(text=text)
            
            # Perform the text-to-speech request
            response = self.tts_client.synthesize_speech(
                input=synthesis_input,
                voice=self.voice,
                audio_config=self.audio_config
            )
            
            return response.audio_content
            
        except Exception as e:
            print(f"Error generating speech: {e}")
            return None
            
    def play_audio(self, audio_data):
        """Play audio data through speakers"""
        try:
            # Convert audio data to wave format for playback
            audio_stream = io.BytesIO(audio_data)
            
            # Google returns LINEAR16 which is raw PCM, so we need to add WAV headers
            with wave.open(audio_stream, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(24000)  # Google's default sample rate
                wav_file.writeframes(audio_data)
            
            audio_stream.seek(0)
            
            # Open audio stream for playback
            with wave.open(audio_stream, 'rb') as wf:
                stream = self.pya.open(
                    format=self.pya.get_format_from_width(wf.getsampwidth()),
                    channels=wf.getnchannels(),
                    rate=wf.getframerate(),
                    output=True,
                    frames_per_buffer=CHUNK_SIZE
                )
                
                # Play audio
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
        print(f"Narrating: {text[:100]}..." if len(text) > 100 else f"Narrating: {text}")
        
        # Generate speech
        audio_data = self.text_to_speech(text)
        
        if audio_data:
            # Play the audio
            self.play_audio(audio_data)
            print("✓ Narration complete")
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
                        # Create a concise summary for narration
                        if len(message) > 500:
                            # For long messages, just summarize what Claude did
                            summary = self.summarize_message(message)
                            self.narrate_text(summary)
                        else:
                            # For short messages, narrate as is
                            self.narrate_text(f"Claude says: {message}")
                        
                        # Small delay between messages
                        await asyncio.sleep(0.5)
                        
            except Exception as e:
                print(f"Error monitoring transcripts: {e}")
                
            # Check every second
            await asyncio.sleep(1)
            
    def summarize_message(self, message):
        """Create a concise summary of Claude's action"""
        # Simple heuristic-based summarization
        if "created" in message.lower() or "wrote" in message.lower():
            return "Claude created a new file"
        elif "updated" in message.lower() or "modified" in message.lower():
            return "Claude updated the code"
        elif "error" in message.lower():
            return "Claude encountered an error"
        elif "running" in message.lower() or "started" in message.lower():
            return "Claude started a process"
        elif "installed" in message.lower():
            return "Claude installed dependencies"
        else:
            # For other messages, extract first sentence
            first_sentence = message.split('.')[0]
            if len(first_sentence) > 100:
                return "Claude completed an action"
            return f"Claude says: {first_sentence}"
            
    async def run(self):
        """Main event loop"""
        print("Initializing Google Cloud TTS narrator...")
        print("Using standard voice for cost efficiency ($4/million chars)")
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
    narrator = GoogleTTSNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())