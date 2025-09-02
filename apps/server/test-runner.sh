#!/bin/bash

# Crypto Stream Backend Test Runner
# This script tests all backend streaming endpoints

set -e

echo "============================================"
echo "    Crypto Stream Backend Test Suite"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SERVER_DIR="$(dirname "$0")"
SERVER_CMD="pnpm dev"
SERVER_PID=""

# Function to cleanup
cleanup() {
    echo -e "\n${YELLOW}Cleaning up...${NC}"
    if [ ! -z "$SERVER_PID" ]; then
        echo "Stopping server (PID: $SERVER_PID)..."
        kill $SERVER_PID 2>/dev/null || true
        wait $SERVER_PID 2>/dev/null || true
    fi
}

# Set trap for cleanup on exit
trap cleanup EXIT

# Function to wait for server
wait_for_server() {
    local port=$1
    local max_attempts=30
    local attempt=0
    
    echo -n "Waiting for server on port $port..."
    while ! nc -z localhost $port 2>/dev/null; do
        if [ $attempt -eq $max_attempts ]; then
            echo -e " ${RED}FAILED${NC}"
            echo "Server failed to start on port $port"
            exit 1
        fi
        echo -n "."
        sleep 1
        attempt=$((attempt + 1))
    done
    echo -e " ${GREEN}OK${NC}"
}

# Start the server
echo -e "${YELLOW}Starting backend server...${NC}"
cd "$SERVER_DIR"
$SERVER_CMD &
SERVER_PID=$!

# Wait for server to be ready
wait_for_server 4000

echo ""
echo -e "${GREEN}✓ Server is running${NC}"
echo "  - HTTP/WebSocket + ConnectRPC: http://localhost:4000"
echo ""

# Test health endpoint
echo -e "${YELLOW}Testing health endpoint...${NC}"
if curl -s http://localhost:4000/health | grep -q "ok"; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed${NC}"
    exit 1
fi

echo ""
echo "============================================"
echo "       Running Integration Tests"
echo "============================================"
echo ""

# Test 1: WebSocket Connection
echo -e "${YELLOW}Test 1: WebSocket Streaming${NC}"
echo "Testing tickers: BTCUSD, ETHUSD"
echo "Duration: 20 seconds"
echo ""

DURATION=20000 TICKERS=BTCUSD,ETHUSD node test-websocket.js &
WS_TEST_PID=$!
wait $WS_TEST_PID
WS_EXIT=$?

if [ $WS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ WebSocket test passed${NC}"
else
    echo -e "${RED}✗ WebSocket test failed${NC}"
fi

echo ""
echo "--------------------------------------------"
echo ""

# Test 2: ConnectRPC Stream
echo -e "${YELLOW}Test 2: ConnectRPC Bidirectional Streaming${NC}"
echo "Testing tickers: ETHUSD, ADAUSD"
echo "Duration: 20 seconds"
echo ""

DURATION=20000 TICKERS=ETHUSD,ADAUSD node test-connectrpc.js &
CONNECT_TEST_PID=$!
wait $CONNECT_TEST_PID
CONNECT_EXIT=$?

if [ $CONNECT_EXIT -eq 0 ]; then
    echo -e "${GREEN}✓ ConnectRPC test passed${NC}"
else
    echo -e "${RED}✗ ConnectRPC test failed${NC}"
fi

echo ""
echo "============================================"
echo "           Test Summary"
echo "============================================"
echo ""

# Summary
TOTAL_TESTS=2
PASSED_TESTS=0

[ $WS_EXIT -eq 0 ] && PASSED_TESTS=$((PASSED_TESTS + 1))
[ $CONNECT_EXIT -eq 0 ] && PASSED_TESTS=$((PASSED_TESTS + 1))

if [ $PASSED_TESTS -eq $TOTAL_TESTS ]; then
    echo -e "${GREEN}✓ All tests passed! ($PASSED_TESTS/$TOTAL_TESTS)${NC}"
    echo ""
    echo "Backend is ready for frontend integration!"
    EXIT_CODE=0
else
    echo -e "${RED}✗ Some tests failed ($PASSED_TESTS/$TOTAL_TESTS passed)${NC}"
    EXIT_CODE=1
fi

echo ""
echo "============================================"

exit $EXIT_CODE
