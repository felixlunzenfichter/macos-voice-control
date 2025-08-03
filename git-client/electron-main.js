// ====================================================================================
// ELECTRON MAIN PROCESS - Git Client Application Launcher
// ====================================================================================
// This file creates and manages the main Electron application window
// It also provides secure shell command execution for git operations

// Import required Electron modules
const { app, BrowserWindow, ipcMain } = require('electron');  // Core Electron components
const { exec } = require('child_process');                     // Node.js child process for shell commands
const path = require('path');                                  // Node.js path utilities
const chokidar = require('chokidar');                         // Efficient file system watching
const fs = require('fs');                                      // File system operations

// ====================================================================================
// CONFIGURATION
// ====================================================================================
const LOG_PATH = '/Users/felixlunzenfichter/Documents/macos-voice-control/logs/git-client-logs.log';

// Get repository path from command line argument - REQUIRED
let REPO_PATH = process.argv[2];

// Check if repository path was provided
if (!REPO_PATH) {
    console.error('ERROR: Repository path is required');
    console.error('Usage: npx electron electron-main.js /path/to/repository');
    process.exit(1);
}

// Resolve to absolute path
REPO_PATH = path.resolve(REPO_PATH);

// Verify the path exists
if (!fs.existsSync(REPO_PATH)) {
    console.error(`ERROR: Repository path does not exist: ${REPO_PATH}`);
    process.exit(1);
}

// Verify it's a git repository
if (!fs.existsSync(path.join(REPO_PATH, '.git'))) {
    console.error(`ERROR: Not a git repository: ${REPO_PATH}`);
    console.error('The specified path must be a git repository (contain a .git directory)');
    process.exit(1);
}

// Log startup to file
if (!fs.existsSync(path.dirname(LOG_PATH))) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
}
fs.writeFileSync(LOG_PATH, `${new Date().toISOString()} - 🚀 Git Client starting with repository: ${REPO_PATH}\n`);

// ====================================================================================
// WINDOW CREATION FUNCTION
// ====================================================================================
// Creates the main application window with specific security and display settings
function createWindow() {
    // Create main browser window with these exact specifications:
    const mainWindow = new BrowserWindow({
        width: 1920,          // Window width in pixels (standard 1080p width)
        height: 1080,         // Window height in pixels (standard 1080p height)
        fullscreen: true,     // Start in fullscreen mode immediately
        webPreferences: {
            // SECURITY SETTINGS - Critical for safe shell command execution
            nodeIntegration: false,     // Disable Node.js in renderer (security best practice)
            contextIsolation: true,     // Isolate main world from isolated world (security)
            preload: path.join(__dirname, 'preload.js')  // Load preload script for secure IPC
        }
    });

    // Load the main HTML file (the actual git client interface)
    mainWindow.loadFile('git-client-ui.html');
    
    // FULLSCREEN ENFORCEMENT - Ensures window stays fullscreen
    // Uses a delay because some systems need time to properly set fullscreen
    mainWindow.once('ready-to-show', () => {        // Wait until window is ready
        setTimeout(() => {                           // 500ms delay for stability
            mainWindow.setFullScreen(true);          // Force fullscreen mode
        }, 500);
    });
    
    return mainWindow; // CRITICAL: Return the window so it can be assigned to global variable
}

// ====================================================================================
// SECURE SHELL COMMAND HANDLER
// ====================================================================================
// This IPC handler allows the renderer process to execute git commands safely
// Commands come from git-client-ui.html via the preload script
ipcMain.handle('execute-command', async (event, command) => {
    return new Promise((resolve, reject) => {
        // Execute the shell command in the repository directory
        exec(command, { cwd: REPO_PATH }, (error, stdout, stderr) => {
            if (error) {
                // CRITICAL: Return empty string instead of throwing error
                // This prevents the UI from crashing when git commands fail
                // (e.g., when not in a git repository or git command doesn't exist)
                resolve('');
                return;
            }
            // Return the command output (git diff, git status, etc.)
            resolve(stdout);
        });
    });
});

// ====================================================================================
// GIT REPOSITORY WATCHING WITH CHOKIDAR
// ====================================================================================
// Set up efficient file system watching for Git repository changes

let mainWindow = null; // Store window reference for sending events

function startGitWatching() {
    // Watch the repository's .git directory
    const gitDir = path.join(REPO_PATH, '.git');
    const gitObjects = path.join(gitDir, 'objects');
    const gitIndex = path.join(gitDir, 'index');
    
    // Ensure log directory exists
    const logDir = path.dirname(LOG_PATH);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Append to existing log (don't clear)
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 🔍 Starting chokidar git watcher\n`);
    
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 🔍 Starting efficient Git repository watching...\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📂 Repository directory: ${REPO_PATH}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📁 Git dir: ${gitDir}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 🗂️ Git objects: ${gitObjects}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📋 Git index: ${gitIndex}\n`);
    
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📂 Repository directory: ${REPO_PATH}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 🗂️ Watching: ${gitObjects}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📋 Watching: ${gitIndex}\n`);
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - 📁 Watching working directory: ${REPO_PATH}\n`);
    
    // Watch git objects, index AND working directory for complete change detection
    const watcher = chokidar.watch([gitObjects, gitIndex, REPO_PATH], {
        ignored: [
            /\.lock$/,          // Ignore lock files
            /\.DS_Store$/,      // Ignore macOS files
            /\.git\/(?!index$|objects)/,  // Ignore .git except index and objects
            /node_modules/,     // Ignore node_modules
            /\.log$/,           // Ignore log files
            /logs\//            // Ignore logs directory to prevent feedback loop
        ],
        persistent: true,
        ignoreInitial: true    // Don't emit events for existing files
    });
    
    // Handle Git repository changes
    watcher
        .on('change', (filePath) => {
            const logMsg = `${new Date().toISOString()} - 📝 Git change detected: ${path.relative(REPO_PATH, filePath)}`;
            fs.appendFileSync(LOG_PATH, logMsg + '\n');
            
            if (mainWindow) {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ✅ Sending IPC event to renderer\n`);
                mainWindow.webContents.send('git-change-detected');
            } else {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ❌ No mainWindow available for IPC\n`);
            }
        })
        .on('add', (filePath) => {
            const logMsg = `${new Date().toISOString()} - ➕ File added: ${path.relative(REPO_PATH, filePath)}`;
            fs.appendFileSync(LOG_PATH, logMsg + '\n');
            
            if (mainWindow) {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ✅ Sending IPC event to renderer\n`);
                mainWindow.webContents.send('git-change-detected');
            } else {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ❌ No mainWindow available for IPC\n`);
            }
        })
        .on('unlink', (filePath) => {
            const logMsg = `${new Date().toISOString()} - 🗑️ File removed: ${path.relative(REPO_PATH, filePath)}`;
            fs.appendFileSync(LOG_PATH, logMsg + '\n');
            
            if (mainWindow) {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ✅ Sending IPC event to renderer\n`);
                mainWindow.webContents.send('git-change-detected');
            } else {
                fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ❌ No mainWindow available for IPC\n`);
            }
        })
        .on('error', (error) => {
            fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ❌ Git watcher error: ${error}\n`);
        })
        .on('ready', () => {
            fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - ✅ Git repository watcher ready - efficient change detection active!\n`);
        });
    
    return watcher;
}

// ====================================================================================
// ELECTRON APP LIFECYCLE MANAGEMENT
// ====================================================================================

// IPC handler for renderer logging
ipcMain.handle('log-message', async (event, message) => {
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} - [RENDERER] ${message}\n`);
});

// Start the application when Electron is ready
app.whenReady().then(() => {
    mainWindow = createWindow();
    startGitWatching(); // Start efficient Git watching
});

// Handle all windows being closed
app.on('window-all-closed', () => {
    // On macOS, keep app running even when all windows are closed
    // On other platforms (Windows/Linux), quit the app
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle app activation (macOS specific)
app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    // and no other windows are open
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});