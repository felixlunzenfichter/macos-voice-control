#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const Logger = require('./logger');
const logger = new Logger('json-to-text', 'Converter');

async function convertJsonToText() {
  const logsJsonPath = path.join(__dirname, 'logs.json');
  const logsTextPath = path.join(__dirname, 'logs.txt');
  
  logger.log('convertJsonToText', 'Starting JSON to text conversion', { 
    source: logsJsonPath, 
    destination: logsTextPath 
  });
  
  if (!fs.existsSync(logsJsonPath)) {
    logger.error('convertJsonToText', 'logs.json file not found', { path: logsJsonPath });
    console.error('logs.json file not found');
    return;
  }
  
  const logs = [];
  
  const fileStream = fs.createReadStream(logsJsonPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });
  
  rl.on('line', (line) => {
    if (line.trim()) {
      try {
        const logEntry = JSON.parse(line);
        logs.push(logEntry);
      } catch (err) {
        logger.error('convertJsonToText', 'Failed to parse JSON line', { 
          error: err.message, 
          line: line.substring(0, 100) 
        });
      }
    }
  });
  
  await new Promise((resolve) => rl.on('close', resolve));
  
  logs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  logger.log('convertJsonToText', 'Sorted logs by timestamp', { 
    totalLogs: logs.length 
  });
  
  const textLines = logs.map(log => {
    const timestamp = new Date(log.timestamp).toLocaleString();
    const level = (log.level || 'LOG').padEnd(5);
    const service = (log.service || 'unknown').padEnd(15);
    const className = log.class ? `[${log.class}]` : '';
    const func = log.function || 'unknown';
    const message = log.message || '';
    
    let line = `${timestamp} | ${level} | ${service} | ${func}${className ? ' ' + className : ''} | ${message}`;
    
    const metadata = { ...log };
    delete metadata.timestamp;
    delete metadata.level;
    delete metadata.service;
    delete metadata.class;
    delete metadata.function;
    delete metadata.message;
    
    if (Object.keys(metadata).length > 0) {
      line += ` | ${JSON.stringify(metadata)}`;
    }
    
    return line;
  });
  
  fs.writeFileSync(logsTextPath, textLines.join('\n'));
  
  logger.log('convertJsonToText', 'Conversion complete', { 
    linesWritten: textLines.length,
    outputFile: logsTextPath
  });
  
  console.log(`Converted ${logs.length} log entries to ${logsTextPath}`);
}

if (require.main === module) {
  convertJsonToText().catch(err => {
    logger.error('main', 'Failed to convert logs', { 
      error: err.message, 
      stack: err.stack 
    });
    console.error('Failed to convert logs:', err);
    process.exit(1);
  });
}

module.exports = { convertJsonToText };