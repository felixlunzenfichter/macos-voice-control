const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// Helper function to get calling function and class info using proper Node.js stack parsing
function getCallerInfo() {
  try {
    const originalStackTrace = Error.prepareStackTrace;
    let callerframe;
    
    Error.prepareStackTrace = function (_, stack) {
      return stack;
    };
    
    const err = new Error();
    Error.captureStackTrace(err, getCallerInfo);
    const stack = err.stack;
    
    Error.prepareStackTrace = originalStackTrace;
    
    // Stack: [0] = _writeLog, [1] = log/error method, [2] = actual caller
    if (stack && stack.length > 2) {
      callerframe = stack[2];
      const functionName = callerframe.getFunctionName() || callerframe.getMethodName() || 'anonymous';
      const className = callerframe.getTypeName() || '';
      
      return {
        functionName: functionName,
        className: className
      };
    }
    
    return { functionName: 'anonymous', className: '' };
  } catch (e) {
    // Fallback to string parsing if prepareStackTrace fails
    try {
      const stack = new Error().stack;
      const lines = stack.split('\n');
      
      // Skip: Error line, getCallerInfo, _writeLog, log/error method, find actual caller  
      if (lines.length > 4) {
        const line = lines[4];
        const match = line.match(/at (?:(\w+)\.)?(\w+)\s*\(/);
        if (match) {
          return {
            functionName: match[2] || 'anonymous',
            className: match[1] || ''
          };
        }
      }
    } catch (fallbackError) {
      // Ignore fallback errors
    }
    
    return { functionName: 'unknown', className: '' };
  }
}

/**
 * Shared Logger with automatic function and class name detection
 * 
 * Features:
 * - Automatic function name detection via Error.stack parsing
 * - Automatic class name detection via Error.stack parsing
 * - Single message parameter - no manual function/class names needed
 * - Pluggable logging callback for different environments
 * - Default file logging for mac-server, forwarding callback for backend
 * - Consistent format: LEVEL | service | class | function | message
 * 
 * Usage:
 *   // Mac-server (default file logging)
 *   const logger = new Logger('mac-server');
 *   
 *   // Backend (forwarding to mac-server)
 *   const logger = new Logger('backend', (logEntry) => {
 *     // Forward to mac-server via WebSocket
 *     sendToMacServer(logEntry);
 *   });
 *   
 *   logger.log('Something happened');        // LOG | service | ClassName | functionName | Something happened
 *   logger.error('Error occurred');          // ERROR | service | ClassName | functionName | Error occurred
 */
class Logger {
  constructor(service, loggingCallback = null) {
    this.service = service;
    this.logPath = path.join(__dirname, 'logs.json');
    this.loggingCallback = loggingCallback || this._defaultFileLogging.bind(this);
  }

  _writeLog(level, message) {
    const callerInfo = getCallerInfo();
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      class: callerInfo.className,
      function: callerInfo.functionName,
      message
    };

    // Always console log first (can't fail)
    console.log(`${level} | ${this.service} | ${callerInfo.className} | ${callerInfo.functionName} | ${message}`);
    
    // Use callback for actual logging (file or forwarding)
    this.loggingCallback(logEntry);
  }

  _defaultFileLogging(logEntry) {
    const logLine = JSON.stringify(logEntry) + '\n';
    
    fs.appendFile(this.logPath, logLine, (err) => {
      if (err) {
        console.error('Failed to write log:', err);
      }
    });
  }

  // Public method to allow external access to default file logging
  defaultFileLogging(logEntry) {
    return this._defaultFileLogging(logEntry);
  }

  log(message, metadata = {}) {
    this._writeLog('LOG', message);
  }

  error(message, metadata = {}) {
    this._writeLog('ERROR', message);
  }



}

module.exports = Logger;