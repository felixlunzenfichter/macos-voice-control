const Logger = require('./logs/logger');

// Create a logger instance
const logger = new Logger('test-service', 'TestClass');

console.log('Testing transparent error injection...');
console.log('This will log an error that should automatically appear in the ERROR_HANDLER_WORKER');

// Log a test error
logger.error('testFunction', 'This is a test error for transparent injection', {
  error: {
    code: 'TEST_ERROR_001',
    message: 'Testing automatic error injection to error handler worker'
  },
  status: 500,
  details: 'This error should appear in the error handler worker without controller involvement'
});

console.log('\nError logged. Check the ERROR_HANDLER_WORKER pane to see if it received the error.');
console.log('The error should appear immediately without any manual intervention.');