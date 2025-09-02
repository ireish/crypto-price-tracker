#!/usr/bin/env node

import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-node';
import { TickerService } from '../../packages/protobuf/gen/proto/ticker_connect.ts';
import { ClientAction, Action } from '../../packages/protobuf/gen/proto/ticker_pb.ts';

const CONNECT_URL = process.env.CONNECT_URL || 'http://localhost:4000';
const TICKERS = process.env.TICKERS?.split(',') || ['BTCUSD', 'ETHUSD'];
const DURATION = parseInt(process.env.DURATION || '30000'); // 30 seconds default

console.log('=== ConnectRPC Bidirectional Stream Test ===');
console.log(`Server: ${CONNECT_URL}`);
console.log(`Tickers: ${TICKERS.join(', ')}`);
console.log(`Duration: ${DURATION}ms`);
console.log('');

// Create transport and client
const transport = createConnectTransport({
    baseUrl: CONNECT_URL,
    httpVersion: '2'
});

const client = createClient(TickerService, transport);

// Track price updates
const priceUpdates = new Map();
let messageCount = 0;
const startTime = Date.now();

async function runTest() {
    try {
        console.log('🚀 Starting bidirectional stream...\n');
        
        // Create async iterable for client actions
        async function* actionStream() {
            for (let i = 0; i < TICKERS.length; i++) {
                const ticker = TICKERS[i];
                yield new ClientAction({ action: Action.SUBSCRIBE, ticker });
                await new Promise(r => setTimeout(r, 500));
            }
            await new Promise(r => setTimeout(r, DURATION));
            for (const ticker of TICKERS) {
                yield new ClientAction({ action: Action.UNSUBSCRIBE, ticker });
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        // Start the stream
        const stream = client.streamPrices(actionStream());
        
        // Handle responses in background
        const responseHandler = (async () => {
            try {
                for await (const response of stream) {
                    messageCount++;
                    
                    if (response.message?.case === 'priceUpdate') {
                        const update = response.message.value;
                        const ticker = update.ticker;
                        const price = parseFloat(update.price);
                        const timestamp = Number(update.timestamp);
                        
                        if (!priceUpdates.has(ticker)) {
                            priceUpdates.set(ticker, []);
                        }
                        
                        priceUpdates.get(ticker).push({
                            price,
                            ts: timestamp
                        });
                        
                        console.log(`💰 ${ticker}: $${price.toFixed(2)} @ ${new Date(timestamp).toLocaleTimeString()}`);
                    }
                }
            } catch (err) {
                console.error('❌ Stream error:', err.message);
            }
        })();
        
        console.log('📊 Subscribing to tickers...\n');
        await responseHandler;
        printReport();
        
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

function printReport() {
    const elapsed = Date.now() - startTime;
    
    console.log('\n📈 Final Report:');
    console.log('═'.repeat(50));
    
    priceUpdates.forEach((updates, ticker) => {
        if (updates.length > 0) {
            const latest = updates[updates.length - 1];
            const first = updates[0];
            const change = latest.price - first.price;
            const changePercent = ((change / first.price) * 100).toFixed(2);
            const avgInterval = updates.length > 1 
                ? Math.round((latest.ts - first.ts) / (updates.length - 1))
                : 0;
            
            console.log(`\n${ticker}:`);
            console.log(`  Latest Price:     $${latest.price.toFixed(2)}`);
            console.log(`  Updates Received: ${updates.length}`);
            console.log(`  Price Change:     $${change.toFixed(2)} (${changePercent}%)`);
            console.log(`  First Update:     $${first.price.toFixed(2)} @ ${new Date(first.ts).toLocaleTimeString()}`);
            console.log(`  Last Update:      $${latest.price.toFixed(2)} @ ${new Date(latest.ts).toLocaleTimeString()}`);
            if (avgInterval > 0) {
                console.log(`  Avg Interval:     ${(avgInterval / 1000).toFixed(1)}s`);
            }
        } else {
            console.log(`\n${ticker}: No updates received`);
        }
    });
    
    console.log('\n' + '─'.repeat(50));
    console.log(`Total Messages:    ${messageCount}`);
    console.log(`Total Duration:    ${(elapsed / 1000).toFixed(1)}s`);
    console.log(`Messages/Second:   ${(messageCount / (elapsed / 1000)).toFixed(1)}`);
    console.log('═'.repeat(50));
}

// Run the test
runTest().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⚡ Shutting down gracefully...');
    process.exit(0);
});
