# Spectacles App Deployment Guide

## Solution: Preview Lens Button

### Problem
- Spectacles app needed proper startup execution to trigger JavaScript code
- Scripts using "Lens Initialized" event weren't executing automatically
- Manual intervention required to start lens preview mode

### Solution Found
**The Preview Lens button is the key to triggering script execution in Spectacles apps.**

### Implementation Steps

1. **Locate Preview Lens Button**
   - Found via accessibility API in Lens Studio UI
   - Button name: "Preview Lens" 
   - Type: AXButton (Accessibility Button)
   - No sub-menus or dropdown options

2. **Click Preview Lens Button**
   ```bash
   osascript -e '
   tell application "System Events"
       tell process "Lens Studio"
           set allWindows to every window
           repeat with w in allWindows
               try
                   set windowElements to every UI element of w
                   repeat with elem in windowElements
                       try
                           if role of elem is "AXButton" and name of elem is "Preview Lens" then
                               click elem
                               return "Preview Lens button clicked successfully"
                           end if
                       end try
                   end repeat
               end try
           end repeat
       end tell
   end tell'
   ```

3. **Expected Behavior**
   - Clicking Preview Lens triggers lens preview mode
   - Scripts with "Lens Initialized" event should execute
   - JavaScript code including Hello World display should run

### All Available Buttons in Lens Studio UI

1. Asset Library
2. Home
3. Project Settings
4. Package Manager
5. GenAI Suite
6. Publish
7. My Lenses
8. **Preview Lens** ⭐ (Primary deployment button)

### Test Results

- ✅ **First Green Light**: Successfully detects real Lens Studio startup via "Lens has been reset" message
- ⏳ **Second Green Light**: Waiting for Hello World script execution after Preview Lens click
- ✅ **Real Verification**: No longer using fake log entries, monitoring actual Lens Studio output

### Technical Details

- **Event Used**: "Lens Initialized" event in JavaScript
- **Modified Files**: 
  - `UIController.js` - Uses Lens Initialized event for Hello World display
  - `FileLogger.js` - Uses console output instead of Node.js fs module
- **Test Monitoring**: Captures both log files and tmux session output from Lens Studio
- **Script Execution**: Depends on Preview Lens button click to trigger preview mode

### Status
- Preview Lens button identified and clickable ✅
- Real startup verification working ✅
- Script execution pending verification after Preview Lens click ⏳

Date: August 18, 2025