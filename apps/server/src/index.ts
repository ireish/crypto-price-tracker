import { createServer } from 'node:http';
import { connectNodeAdapter } from '@connectrpc/connect-node';
import { buildConnectRouter } from './server';
import manager from './core/TickerSubscriptionManager';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  await manager.start();

  const connectHandler = connectNodeAdapter({
    routes: (router) => buildConnectRouter(router),
    // Use HTTP/1.1 for browser compatibility
    httpVersion: '1.1'
  });

  // Create HTTP/1.1 server for browser compatibility
  const server = createServer();

  server.on('request', (req, res) => {
    // Add CORS headers for browser access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, Connect-Accept-Encoding, X-Connect-Protocol-Version, X-Connect-Timeout-Ms');
    res.setHeader('Access-Control-Expose-Headers', 'Connect-Accept-Encoding, Connect-Content-Encoding');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    if (req.method === 'GET' && req.url === '/tickers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ active: manager.getActiveTickers() }));
      return;
    }
    connectHandler(req, res);
  });

  server.listen(PORT, () => {
    console.log(`server listening on http://localhost:${PORT} (HTTP/1.1 with CORS)`);
    console.log(`ConnectRPC routes active`);
  });


  const shutdown = async () => {
    console.log('Shutting down...');
    server.close(() => {});
    await manager.shutdown();
    // no-op for gRPC/WebSocket shutdown (removed)
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


