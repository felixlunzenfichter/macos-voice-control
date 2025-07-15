const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class Logger {
  constructor(service, className = '') {
    this.service = service;
    this.className = className;
    this.logPath = path.join(__dirname, 'logs.json');
  }

  _writeLog(level, functionName, message, metadata = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      class: this.className,
      function: functionName,
      message,
      ...metadata
    };

    const logLine = JSON.stringify(logEntry) + '\n';
    
    fs.appendFile(this.logPath, logLine, (err) => {
      if (err) {
        console.error('Failed to write log:', err);
      }
    });

    console.log(`[${level}] ${message}`, metadata);
  }

  log(functionName, message, metadata = {}) {
    this._writeLog('LOG', functionName, message, metadata);
  }

  error(functionName, message, metadata = {}) {
    this._writeLog('ERROR', functionName, message, metadata);
    this._injectErrorToHandler(functionName, message, metadata);
  }

  _injectErrorToHandler(functionName, message, metadata) {
    // Check if error handler worker exists
    exec('tmux list-panes -a -F "#{pane_id} #{session_name}" | grep ERROR_HANDLER_WORKER', (err, stdout) => {
      if (err || !stdout.trim()) {
        // No error handler worker found, skip injection
        return;
      }

      // Get the pane ID from the tracking file
      fs.readFile('/tmp/claude_workers.jsonl', 'utf8', (err, data) => {
        if (err) return;

        const lines = data.trim().split('\n').filter(line => line);
        for (const line of lines) {
          try {
            const worker = JSON.parse(line);
            if (worker.name === 'ERROR_HANDLER_WORKER' && worker.paneId) {
              // Format error message for injection
              const errorMsg = this._formatErrorForInjection(functionName, message, metadata);
              
              // Escape message for shell
              const escapedMsg = errorMsg.replace(/'/g, "'\\''");
              
              // Inject into error handler worker
              exec(`tmux send-keys -t ${worker.paneId} 'ERROR: [${this.service}:${functionName}] ${escapedMsg}' Enter`, (err) => {
                if (err) {
                  console.error('Failed to inject error to handler:', err);
                }
              });
              
              break;
            }
          } catch (parseErr) {
            // Skip invalid lines
          }
        }
      });
    });
  }

  _formatErrorForInjection(functionName, message, metadata) {
    let formattedMsg = message;
    
    // Add error details if present
    if (metadata.error) {
      if (typeof metadata.error === 'string') {
        formattedMsg += ` | Details: ${metadata.error}`;
      } else if (metadata.error.message) {
        formattedMsg += ` | Details: ${metadata.error.message}`;
      }
    }
    
    // Add status code if present
    if (metadata.status) {
      formattedMsg += ` | Status: ${metadata.status}`;
    }
    
    return formattedMsg;
  }

  forClass(className) {
    return new Logger(this.service, className);
  }
}

module.exports = Logger;