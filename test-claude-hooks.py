#!/usr/bin/env python3
"""
Test script to demonstrate Claude Code hooks

This script shows what data is available when Claude Code triggers hooks.
"""

import os
import json
import sys
from datetime import datetime

# Log file for hook events
LOG_FILE = "/tmp/claude-hook-events.log"

def log_hook_event():
    """Log all environment variables and data when a hook is triggered"""
    
    # Get all CLAUDE_* environment variables
    claude_vars = {k: v for k, v in os.environ.items() if k.startswith('CLAUDE_')}
    
    # Create log entry
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "hook_type": os.environ.get("CLAUDE_HOOK_TYPE", "unknown"),
        "event": os.environ.get("CLAUDE_HOOK_EVENT", ""),
        "message": os.environ.get("CLAUDE_MESSAGE", ""),
        "tool_name": os.environ.get("CLAUDE_TOOL_NAME", ""),
        "tool_input": os.environ.get("CLAUDE_TOOL_INPUT", ""),
        "tool_output": os.environ.get("CLAUDE_TOOL_OUTPUT", ""),
        "all_claude_vars": claude_vars,
        "all_env_vars": dict(os.environ)  # For debugging
    }
    
    # Write to log file
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(log_entry, indent=2) + "\n\n")
    
    # Also print to stdout for immediate feedback
    print(f"Hook triggered: {log_entry['hook_type']}")
    print(f"Message: {log_entry['message']}")
    
    # If this is a Notification hook saying Claude is done, trigger narration
    if log_entry['hook_type'] == 'Notification' and 'done' in log_entry['message'].lower():
        print("Claude is done and waiting for input!")
        # You could trigger your Gemini narrator here
        os.system("say 'Claude is done'")

if __name__ == "__main__":
    log_hook_event()