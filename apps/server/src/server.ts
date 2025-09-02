import { ConnectRouter } from '@connectrpc/connect';
import { TickerService } from '@crypto-streamer/protobuf/gen/proto/ticker_connect';
import { 
  ClientAction, 
  ServerStreamResponse, 
  PriceUpdate, 
  Action,
  SubscribeRequest,
  SubscribeResponse,
  UnsubscribeRequest,
  UnsubscribeResponse,
  WatchRequest
} from '@crypto-streamer/protobuf/gen/proto/ticker_pb';
import manager from './core/TickerSubscriptionManager';

// Store per-connection subscriptions (using a WeakMap would be better in production)
const connectionSubscriptions = new Map<string, Set<string>>();
let connectionIdCounter = 0;

export function buildConnectRouter(router: ConnectRouter) {
  router.service(TickerService, {
    async *streamPrices(clientActions: AsyncIterable<ClientAction>) {
      const subscribed = new Set<string>();
      const pending: ServerStreamResponse[] = [];
      let resolveNext: ((v: ServerStreamResponse | null) => void) | null = null;

      const tryDequeue = async (): Promise<ServerStreamResponse | null> => {
        if (pending.length > 0) return pending.shift()!;
        return new Promise<ServerStreamResponse | null>((resolve) => (resolveNext = resolve));
      };

      const onUpdate = (update: { ticker: string; price: number; ts: number }) => {
        if (!subscribed.has(update.ticker)) return;
        const priceUpdate = new PriceUpdate({
          ticker: update.ticker,
          price: String(update.price),
          timestamp: BigInt(update.ts)
        });
        const msg = new ServerStreamResponse();
        msg.message = {
          case: 'priceUpdate',
          value: priceUpdate
        };
        if (resolveNext) {
          resolveNext(msg);
          resolveNext = null;
        } else {
          pending.push(msg);
        }
      };

      const offMap = new Map<string, () => void>();

      const actionsTask = (async () => {
        for await (const action of clientActions) {
          const ticker = (action.ticker ?? '').trim().toUpperCase();
          if (!ticker) continue;
          if (action.action === Action.SUBSCRIBE) {
            if (!subscribed.has(ticker)) {
              await manager.subscribe(ticker);
              const off = manager.onPrice(ticker, (u) => onUpdate(u));
              offMap.set(ticker, off);
              subscribed.add(ticker);
            }
          } else if (action.action === Action.UNSUBSCRIBE) {
            if (subscribed.has(ticker)) {
              offMap.get(ticker)?.();
              offMap.delete(ticker);
              await manager.unsubscribe(ticker);
              subscribed.delete(ticker);
            }
          }
        }
      })();

      try {
        while (true) {
          const next = await tryDequeue();
          if (next == null) break;
          yield next;
        }
      } finally {
        for (const [ticker, off] of offMap) {
          try { off(); } catch {}
          await manager.unsubscribe(ticker).catch(() => {});
        }
        offMap.clear();
        subscribed.clear();
      }
    },

    // Unary method for subscribing to tickers
    async subscribe(req: SubscribeRequest): Promise<SubscribeResponse> {
      const connectionId = req.tickers.join(','); // Simple connection ID based on tickers
      const subscribed: string[] = [];
      
      for (const tickerRaw of req.tickers) {
        const ticker = tickerRaw.trim().toUpperCase();
        if (ticker) {
          await manager.subscribe(ticker);
          subscribed.push(ticker);
        }
      }
      
      // Store the subscriptions for this connection
      if (!connectionSubscriptions.has(connectionId)) {
        connectionSubscriptions.set(connectionId, new Set());
      }
      const subs = connectionSubscriptions.get(connectionId)!;
      subscribed.forEach(t => subs.add(t));
      
      return new SubscribeResponse({
        success: true,
        subscribed
      });
    },

    // Unary method for unsubscribing from tickers
    async unsubscribe(req: UnsubscribeRequest): Promise<UnsubscribeResponse> {
      const connectionId = req.tickers.join(','); // Simple connection ID
      const unsubscribed: string[] = [];
      
      for (const tickerRaw of req.tickers) {
        const ticker = tickerRaw.trim().toUpperCase();
        if (ticker) {
          await manager.unsubscribe(ticker);
          unsubscribed.push(ticker);
          
          // Remove from connection subscriptions
          const subs = connectionSubscriptions.get(connectionId);
          if (subs) {
            subs.delete(ticker);
            if (subs.size === 0) {
              connectionSubscriptions.delete(connectionId);
            }
          }
        }
      }
      
      return new UnsubscribeResponse({
        success: true,
        unsubscribed
      });
    },

    // Server streaming method for watching prices
    async *watchPrices(req: WatchRequest, context: any): AsyncGenerator<ServerStreamResponse> {
      console.log('[watchPrices] Stream started');
      const subscribed = new Set<string>();
      const pending: ServerStreamResponse[] = [];
      let resolveNext: ((v: ServerStreamResponse) => void) | null = null;
      const offMap = new Map<string, () => void>();
      let streamClosed = false;

      const tryDequeue = async (): Promise<ServerStreamResponse | null> => {
        if (pending.length > 0) {
          const msg = pending.shift()!;
          console.log(`[watchPrices] Dequeuing message for ${(msg.message as any)?.value?.ticker}`);
          return msg;
        }
        if (streamClosed) return null;
        return new Promise<ServerStreamResponse | null>((resolve) => {
          resolveNext = (msg) => resolve(msg);
        });
      };

      const onUpdate = (update: { ticker: string; price: number; ts: number }) => {
        console.log(`[watchPrices] Price update for ${update.ticker}: ${update.price}`);
        const priceUpdate = new PriceUpdate({
          ticker: update.ticker,
          price: String(update.price),
          timestamp: BigInt(update.ts)
        });
        const msg = new ServerStreamResponse();
        msg.message = {
          case: 'priceUpdate',
          value: priceUpdate
        };
        if (resolveNext) {
          resolveNext(msg);
          resolveNext = null;
        } else {
          pending.push(msg);
        }
      };

      const subscribeToTicker = (ticker: string) => {
        if (!subscribed.has(ticker)) {
          console.log(`[watchPrices] Subscribing to ${ticker}`);
          const off = manager.onPrice(ticker, onUpdate);
          offMap.set(ticker, off);
          subscribed.add(ticker);
        }
      };

      // Subscribe to all active tickers
      const activeTickers = manager.getActiveTickers();
      console.log(`[watchPrices] Active tickers on start: ${activeTickers.join(', ') || 'none'}`);
      for (const ticker of activeTickers) {
        subscribeToTicker(ticker);
      }

      // Check for new subscriptions more frequently
      const checkInterval = setInterval(() => {
        const currentTickers = manager.getActiveTickers();
        for (const ticker of currentTickers) {
          if (!subscribed.has(ticker)) {
            console.log(`[watchPrices] New ticker detected: ${ticker}`);
            subscribeToTicker(ticker);
          }
        }
        // Also clean up removed tickers
        for (const ticker of subscribed) {
          if (!currentTickers.includes(ticker)) {
            console.log(`[watchPrices] Ticker removed: ${ticker}`);
            const off = offMap.get(ticker);
            if (off) {
              off();
              offMap.delete(ticker);
            }
            subscribed.delete(ticker);
          }
        }
      }, 100); // Check every 100ms instead of 1000ms

      try {
        // Keep the stream alive and yield messages as they come
        while (!streamClosed) {
          const next = await tryDequeue();
          if (next == null) {
            // Stream has been closed
            break;
          }
          console.log(`[watchPrices] Yielding message for ${(next.message as any)?.value?.ticker}`);
          yield next;
        }
      } finally {
        streamClosed = true;
        clearInterval(checkInterval);
        for (const [ticker, off] of offMap) {
          try { off(); } catch {}
        }
        offMap.clear();
        subscribed.clear();
      }
    }
  });
}
