const fs = require('fs');
const path = require('path');

// Path to the log file
const logFile = path.join(__dirname, 'logs', 'logs.json');

// Create a test error entry
const testError = {
    timestamp: new Date().toISOString(),
    level: "ERROR",
    service: "test-service",
    class: "TestClass",
    function: "testErrorInjection",
    message: "This is a test error to verify error injection is working",
    error: {
        code: "TEST_ERROR",
        details: "Testing the error injection system"
    }
};

// Append the error to the log file
fs.appendFileSync(logFile, JSON.stringify(testError) + '\n');

console.log('Test error written to log file');
console.log('The error should be injected into the orchestrator within 5 seconds');