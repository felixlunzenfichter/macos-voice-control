// ====================================================================================
// ELECTRON PRELOAD SCRIPT - Security Bridge Between Main and Renderer
// ====================================================================================
// This script runs in a sandboxed environment with limited Node.js API access
// It creates a secure bridge for the HTML interface to communicate with the main process

// Import Electron's context isolation and IPC modules
const { contextBridge, ipcRenderer } = require('electron');

// ====================================================================================
// SECURE API EXPOSURE
// ====================================================================================
// Create a secure API that the HTML page can access via window.electronAPI
// This prevents the renderer from having direct access to Node.js/Electron APIs
contextBridge.exposeInMainWorld('electronAPI', {
    // Function to exit fullscreen mode (currently not used in the UI)
    exitFullscreen: () => ipcRenderer.send('exit-fullscreen'),
    
    // CRITICAL FUNCTION: Execute shell commands securely
    // This is how git-client-ui.html runs git commands like "git diff", "git status"
    // Returns a Promise that resolves with the command output
    executeCommand: (command) => ipcRenderer.invoke('execute-command', command),
    
    // Logging function to send logs to main process
    logMessage: (message) => ipcRenderer.invoke('log-message', message),
    
    // EXPOSE IPC RENDERER - Allow renderer to listen for events from main process
    // This enables the chokidar file system events to reach the HTML interface
    ipcRenderer: {
        on: (channel, callback) => {
            // Only allow specific channels for security
            const validChannels = ['git-change-detected'];
            if (validChannels.includes(channel)) {
                ipcRenderer.on(channel, callback);
            }
        },
        removeListener: (channel, callback) => {
            const validChannels = ['git-change-detected'];
            if (validChannels.includes(channel)) {
                ipcRenderer.removeListener(channel, callback);
            }
        }
    }
});

// ====================================================================================
// INITIALIZATION LOG
// ====================================================================================
// Log when the preload script is ready and DOM is loaded
window.addEventListener('DOMContentLoaded', () => {
    // No console.log - logging handled through IPC
});