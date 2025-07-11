#!/bin/bash

# Voice Control System Test Suite
# This runs all critical tests to ensure the voice control system is working

echo "🧪 VOICE CONTROL SYSTEM TEST SUITE"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

TESTS_PASSED=0
TESTS_FAILED=0

# Function to run a test
run_test() {
    local test_name=$1
    local test_file=$2
    
    echo "Running: $test_name"
    if node "$test_file"; then
        echo -e "${GREEN}✅ PASSED${NC}: $test_name\n"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC}: $test_name\n"
        ((TESTS_FAILED++))
    fi
}

# Run all tests
run_test "Help Button Emergency Recovery" "test-help-button.js"

# Add more tests here as we create them:
# run_test "Voice Transcription" "test-voice-transcription.js"
# run_test "TTS Toggle" "test-tts-toggle.js"
# run_test "Network Reconnection" "test-network-reconnection.js"

# Summary
echo "=================================="
echo "TEST SUMMARY"
echo "Passed: $TESTS_PASSED"
echo "Failed: $TESTS_FAILED"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ALL TESTS PASSED!${NC}"
    exit 0
else
    echo -e "${RED}❌ SOME TESTS FAILED${NC}"
    exit 1
fi