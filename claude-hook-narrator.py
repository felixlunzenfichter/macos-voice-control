#!/usr/bin/env python3
"""
Claude Hook Narrator - Triggered by Claude Code hooks

This script is called by Claude Code when it needs attention.
It can either use macOS 'say' command or send to Gemini Live API.
"""

import os
import sys
import json
from datetime import datetime

def narrate_claude_event():
    """Narrate what Claude has done based on hook data"""
    
    # Get hook information from environment
    hook_type = os.environ.get("CLAUDE_HOOK_TYPE", "")
    message = os.environ.get("CLAUDE_MESSAGE", "")
    event = os.environ.get("CLAUDE_HOOK_EVENT", "")
    
    # Determine what to say
    narration = ""
    
    if hook_type == "Notification":
        if "done" in message.lower() or "waiting" in message.lower():
            narration = "Claude is done and waiting for your input"
        elif "error" in message.lower():
            narration = "Claude encountered an error"
        elif "completed" in message.lower():
            narration = "Claude completed the task"
        else:
            narration = f"Claude says: {message}"
    
    elif hook_type == "PostToolUse":
        tool_name = os.environ.get("CLAUDE_TOOL_NAME", "")
        if tool_name:
            narration = f"Claude finished using {tool_name}"
    
    # Narrate using macOS say command (simple approach)
    if narration:
        os.system(f'say "{narration}"')
        
        # Log for debugging
        with open("/tmp/claude-narration.log", "a") as f:
            f.write(f"[{datetime.now().isoformat()}] {narration}\n")
    
    # For Gemini integration, you would send to your narrator here:
    # send_to_gemini_narrator(narration)

if __name__ == "__main__":
    narrate_claude_event()