#!/usr/bin/env node

/**
 * Test: Help Button Emergency Recovery System
 * 
 * This test verifies that when a user presses the Help button on the iPhone,
 * an emergency message is typed into the terminal, allowing recovery of voice control.
 * 
 * Test Flow:
 * 1. Simulate Help button press by sending helpMessage to backend
 * 2. Verify backend receives and forwards message to mac-server
 * 3. Verify mac-server types the emergency message into terminal
 * 
 * Expected Result:
 * Terminal should show: "HELP BUTTON PRESSED: User cannot interact with system. User is locked out and can only use voice. Fix voice control immediately."
 */

const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');

const BACKEND_URL = 'ws://192.168.2.223:8080';
const EXPECTED_MESSAGE = "HELP BUTTON PRESSED: User cannot interact with system. User is locked out and can only use voice. Fix voice control immediately.";
const TEST_LOG_FILE = '/tmp/help-button-test.log';

// Clear log file
fs.writeFileSync(TEST_LOG_FILE, '');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  console.log(logMessage.trim());
  fs.appendFileSync(TEST_LOG_FILE, logMessage);
}

async function waitForServices() {
  log('Waiting for services to be ready...');
  await new Promise(resolve => setTimeout(resolve, 3000));
}

async function simulateHelpButtonPress() {
  return new Promise((resolve, reject) => {
    log('Connecting to backend...');
    const ws = new WebSocket(BACKEND_URL);
    
    ws.on('open', () => {
      log('Connected to backend');
      
      // Identify as iPhone transcriber
      ws.send(JSON.stringify({
        type: 'identify',
        clientType: 'transcriber',
        clientName: 'iPhone Test Client'
      }));
      
      // Wait a moment for identification to process
      setTimeout(() => {
        log('Sending Help message...');
        ws.send(JSON.stringify({
          type: 'helpMessage',
          message: 'Test help message from automated test'
        }));
        
        log('Help message sent');
      }, 1000);
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      log(`Received: ${message.type}`);
      
      if (message.type === 'helpMessageReceived') {
        log('✅ Backend confirmed Help message receipt');
        ws.close();
        resolve();
      }
    });
    
    ws.on('error', (error) => {
      log(`❌ WebSocket error: ${error.message}`);
      reject(error);
    });
    
    ws.on('close', () => {
      log('WebSocket closed');
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      ws.close();
      reject(new Error('Test timeout - no response from backend'));
    }, 10000);
  });
}

async function verifyMessageTyped() {
  log('Waiting for message to be typed...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if the orchestrator's last transcript contains our message
  return new Promise((resolve) => {
    exec('tmux capture-pane -t claude_orchestrator:0 -p | tail -50', (error, stdout, stderr) => {
      if (error) {
        log(`❌ Error capturing tmux pane: ${error.message}`);
        resolve(false);
        return;
      }
      
      const containsMessage = stdout.includes(EXPECTED_MESSAGE);
      if (containsMessage) {
        log('✅ Emergency message found in terminal!');
        resolve(true);
      } else {
        log('❌ Emergency message NOT found in terminal');
        log('Terminal contents (last 50 lines):');
        log(stdout);
        resolve(false);
      }
    });
  });
}

async function runTest() {
  log('=== HELP BUTTON EMERGENCY SYSTEM TEST ===');
  log(`Backend URL: ${BACKEND_URL}`);
  log(`Expected message: "${EXPECTED_MESSAGE}"`);
  
  try {
    await waitForServices();
    await simulateHelpButtonPress();
    const messageTyped = await verifyMessageTyped();
    
    if (messageTyped) {
      log('\n✅ TEST PASSED: Help button emergency system is working!');
      process.exit(0);
    } else {
      log('\n❌ TEST FAILED: Emergency message was not typed into terminal');
      process.exit(1);
    }
  } catch (error) {
    log(`\n❌ TEST FAILED: ${error.message}`);
    process.exit(1);
  }
}

// Run the test
runTest();