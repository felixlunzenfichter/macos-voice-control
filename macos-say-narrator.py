#!/usr/bin/env python3
"""
macOS Say Narrator for Claude Code

Uses the built-in macOS 'say' command for text-to-speech.
Free, no API needed, works immediately.

Usage:
    python macos-say-narrator.py
"""

import asyncio
import os
import sys
import json
import subprocess
from pathlib import Path

class MacOSSayNarrator:
    """Simple narrator using macOS say command"""
    
    def __init__(self):
        self.file_positions = {}
        # You can change the voice with -v flag
        # Run 'say -v ?' to see available voices
        self.voice = "Alex"  # Default macOS voice
        
    def narrate_text(self, text):
        """Use macOS say command to speak text"""
        # Limit text length for better narration
        if len(text) > 200:
            text = text[:197] + "..."
            
        print(f"🗣️ Narrating: {text}")
        
        try:
            # Use subprocess to call say command
            subprocess.run([
                "say", 
                "-v", self.voice,
                text
            ], check=True)
        except subprocess.CalledProcessError as e:
            print(f"Error with say command: {e}")
        except Exception as e:
            print(f"Error narrating: {e}")
            
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
        # Keep it short for better narration
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
        elif "capture-pane" in message:
            return "Checking output"
        elif "tmux" in message.lower():
            return "Using tmux"
        else:
            # Extract key action words
            words = message.split()[:10]  # First 10 words
            return " ".join(words)
            
    async def run(self):
        """Main event loop"""
        print("macOS Say Narrator")
        print(f"Using voice: {self.voice}")
        print("Ready to narrate Claude messages...")
        print()
        
        # Test the voice
        subprocess.run(["say", "-v", self.voice, "Narrator ready"], check=False)
        
        try:
            await self.monitor_transcripts()
        except KeyboardInterrupt:
            print("\nShutting down narrator...")
        except Exception as e:
            print(f"Error: {e}")


async def main():
    """Entry point"""
    narrator = MacOSSayNarrator()
    await narrator.run()


if __name__ == "__main__":
    asyncio.run(main())