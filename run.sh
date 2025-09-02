#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   Crypto Price Streamer - Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check for required tools
echo -e "\n${YELLOW}Checking prerequisites...${NC}"

if ! command_exists node; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

if ! command_exists pnpm; then
    echo -e "${RED}Error: pnpm is not installed${NC}"
    echo "Please install pnpm: npm install -g pnpm"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
pnpm install --recursive
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install dependencies${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Install Playwright browsers
echo -e "\n${YELLOW}Installing Playwright browsers...${NC}"
cd apps/server
pnpm run playwright:install
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install Playwright browsers${NC}"
    exit 1
fi
cd ../..
echo -e "${GREEN}✓ Playwright browsers installed${NC}"

# Generate protobuf files
echo -e "\n${YELLOW}Generating protobuf files...${NC}"
cd packages/protobuf

# Check if buf is available
if ! npx @bufbuild/buf --version >/dev/null 2>&1; then
    echo -e "${YELLOW}Installing buf CLI...${NC}"
    npm install --no-save @bufbuild/buf
fi

npx @bufbuild/buf generate
if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to generate protobuf files${NC}"
    exit 1
fi
cd ../..
echo -e "${GREEN}✓ Protobuf files generated${NC}"

# Kill any existing instances
echo -e "\n${YELLOW}Cleaning up existing processes...${NC}"
pkill -f "tsx" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

# Start the application
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}   Starting Application${NC}"
echo -e "${GREEN}========================================${NC}"

# Use pnpm dev which starts both frontend and backend
echo -e "\n${YELLOW}Starting servers...${NC}"
echo -e "${GREEN}Backend will run on: http://localhost:4000${NC}"
echo -e "${GREEN}Frontend will run on: http://localhost:3000${NC}"
echo -e "\n${YELLOW}Press Ctrl+C to stop all servers${NC}\n"

# Start both servers using pnpm dev
pnpm dev

# Cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down servers...${NC}"
    pkill -f "tsx" 2>/dev/null || true
    pkill -f "next dev" 2>/dev/null || true
    echo -e "${GREEN}Servers stopped. Goodbye!${NC}"
    exit 0
}

trap cleanup INT TERM
