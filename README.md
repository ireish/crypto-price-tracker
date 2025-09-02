# Crypto Price Streamer - Submission Ready

## Overview
A real-time cryptocurrency price streaming application built with:
- **Frontend**: Next.js 15 with TypeScript
- **Backend**: Node.js with ConnectRPC (HTTP/1.1 with CORS)
- **Data Source**: TradingView via Playwright browser automation
- **Protocol**: ConnectRPC with Protobuf for type-safe communication
- **Architecture**: Unary + Server-streaming RPC for browser compatibility

## Prerequisites
- Node.js 18+ 
- pnpm package manager (`npm install -g pnpm`)

## Quick Start

### 1. Install Dependencies
```bash
pnpm install --recursive
```

### 2. Run the Application
```bash
./run.sh
```

This script will:
- ✅ Check prerequisites
- ✅ Install all dependencies
- ✅ Install Playwright browsers
- ✅ Generate protobuf files (`buf generate`)
- ✅ Start both frontend and backend servers
- ✅ Handle graceful shutdown on Ctrl+C

### 3. Access the Application
Open http://localhost:3000 in your web browser

## Features

### 1. Real-time Price Streaming
- Live cryptocurrency prices from TradingView
- Automatic price updates via server-streaming RPC
- Visual connection status indicator

### 2. Trading Pair Validation
- **575 supported USD trading pairs** loaded from `/public/usd-trading-pairs.txt`
- Input validation with error messages
- Prevents adding unsupported pairs

### 3. Autocomplete
- Top 5 suggestions as you type
- Keyboard navigation (Arrow keys, Enter, Escape)
- Click to select suggestions

### 4. User Interface
- Add/remove multiple tickers
- Real-time price display with proper formatting
- Responsive design with Tailwind CSS
- Connection status indicator

## Architecture

### Data Flow
```
TradingView (Browser) 
    ↓ (Playwright Scraping)
Backend Server (Node.js)
    ↓ (ConnectRPC - Server Streaming)
Frontend (Next.js)
    ↓ (React State)
UI Components
```

### Communication Protocol
- **Subscribe/Unsubscribe**: Unary RPC calls for managing subscriptions
- **WatchPrices**: Server-streaming RPC for receiving price updates
- **Transport**: HTTP/1.1 with CORS for browser compatibility

## Testing Instructions

1. **Add a Ticker**:
   - Type "BTC" in the input field
   - See autocomplete suggestions (BTCUSD, BTCSTUSD, etc.)
   - Select or type "BTCUSD" and press Enter or click Add
   - Watch real-time price updates

2. **Validation Test**:
   - Try typing "INVALID" 
   - See error message: "INVALID is not a supported trading pair"
   - Add button will be disabled

3. **Remove a Ticker**:
   - Click the × button next to any ticker
   - Server will stop streaming prices for that pair

4. **Multiple Tickers**:
   - Add multiple pairs: BTCUSD, ETHUSD, ADAUSD
   - All prices update independently in real-time

## Project Structure

```
.
├── apps/
│   ├── server/         # Backend Node.js server
│   │   └── src/
│   │       ├── index.ts              # HTTP/1.1 server with CORS
│   │       ├── server.ts             # ConnectRPC service implementation
│   │       └── core/
│   │           └── TickerSubscriptionManager.ts  # Playwright scraping
│   └── web/            # Frontend Next.js application
│       ├── src/
│       │   └── app/
│       │       └── page.tsx         # Main UI with autocomplete
│       └── public/
│           └── usd-trading-pairs.txt # Allowed trading pairs
├── packages/
│   └── protobuf/       # Shared protobuf definitions
│       ├── proto/
│       │   └── ticker.proto          # Service definitions
│       └── gen/                      # Generated TypeScript code
├── run.sh              # Single script to run everything
└── package.json        # Root package configuration
```

## Key Files

- `run.sh` - Main execution script
- `apps/web/src/app/page.tsx` - Frontend with autocomplete and validation
- `apps/server/src/server.ts` - ConnectRPC service implementation
- `packages/protobuf/proto/ticker.proto` - Protocol definitions
- `apps/web/public/usd-trading-pairs.txt` - Supported trading pairs

## Troubleshooting

### Port Already in Use
If you see port conflicts:
```bash
pkill -f "tsx" 
pkill -f "next dev"
./run.sh
```

### Playwright Issues
If Playwright browsers aren't installed:
```bash
cd apps/server
pnpm run playwright:install
```

### Protobuf Generation Issues
If protobuf files need regeneration:
```bash
cd packages/protobuf
npx @bufbuild/buf generate
```

## Technical Highlights

1. **Pure ConnectRPC Architecture**: No SSE layer, direct RPC communication
2. **Browser-Compatible Streaming**: Unary + Server-streaming pattern
3. **Type Safety**: End-to-end TypeScript with Protobuf
4. **Real-time Updates**: Efficient WebSocket-like streaming over HTTP
5. **Input Validation**: Client-side validation with 575 allowed pairs
6. **Autocomplete**: Fuzzy search with keyboard navigation
7. **Error Handling**: Graceful error messages and retry logic
