# Git Client

Simple fullscreen git diff viewer with newspaper-style columns.

## Quick Start
```bash
# Repository path is REQUIRED - no default
npx electron electron-main.js /path/to/your/repo

# Examples:
npx electron electron-main.js /Users/john/my-project
npx electron electron-main.js ~/Documents/website
npx electron electron-main.js .  # Current directory (must be explicit)
```

## What It Does
- Shows `git diff` output in newspaper-style columns
- Efficient file system watching for instant git change detection
- Plays Japanese gong sound when repository changes detected
- Fullscreen interface with instant column jumping

Test change to verify event detection.
- Real-time column position preservation during git changes

## Files
- `git-client-ui.html`: Main interface
- `electron-main.js`: Electron app launcher
- `preload.js`: Security bridge for git commands

## Configuration
- **Column layout**: Configurable lines per column in source code
- **Change detection**: Efficient file system watching with chokidar
- **Display**: Automatic column generation based on content length

## Requirements
- Node.js
- Git repository
- Electron (`npm install electron`)

## Logs
Git change detection logs are written to:
`/Users/felixlunzenfichter/Documents/macos-voice-control/logs/git-client-logs.log`
