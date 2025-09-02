"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { TickerService } from '@crypto-streamer/protobuf/gen/proto/ticker_connect';
import { 
  SubscribeRequest,
  UnsubscribeRequest,
  WatchRequest 
} from '@crypto-streamer/protobuf/gen/proto/ticker_pb';

type TickerItem = {
  symbol: string;
  price: number | null;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [tickers, setTickers] = useState<TickerItem[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [allowedPairs, setAllowedPairs] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [validationError, setValidationError] = useState<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const clientRef = useRef<ReturnType<typeof createClient<typeof TickerService>> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const normalized = (s: string) => s.trim().toUpperCase();

  // Load allowed trading pairs from file
  useEffect(() => {
    fetch('/usd-trading-pairs.txt')
      .then(res => res.text())
      .then(text => {
        const pairs = text.split('\n').filter(line => line.trim()).map(line => line.trim());
        setAllowedPairs(pairs);
        console.log(`Loaded ${pairs.length} allowed trading pairs`);
      })
      .catch(err => {
        console.error('Failed to load trading pairs:', err);
        // Fallback to some common pairs if file fails to load
        setAllowedPairs(['BTCUSD', 'ETHUSD', 'ADAUSD', 'SOLUSD', 'DOTUSD']);
      });
  }, []);

  // Update suggestions when input changes
  useEffect(() => {
    const normalizedInput = normalized(input);
    if (normalizedInput.length > 0 && allowedPairs.length > 0) {
      const matches = allowedPairs
        .filter(pair => pair.startsWith(normalizedInput))
        .slice(0, 5); // Top 5 matches
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
      
      // Validate input
      if (normalizedInput.length >= 3) {
        const isValid = allowedPairs.includes(normalizedInput);
        if (!isValid) {
          setValidationError(`"${normalizedInput}" is not a supported trading pair`);
        } else {
          setValidationError("");
        }
      } else {
        setValidationError("");
      }
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
      setValidationError("");
    }
  }, [input, allowedPairs]);

  const addTicker = async () => {
    const sym = normalized(input);
    if (!sym) return;
    
    // Validate against allowed pairs
    if (!allowedPairs.includes(sym)) {
      setValidationError(`"${sym}" is not a supported trading pair`);
      return;
    }
    
    if (tickers.some((t) => t.symbol === sym)) {
      setInput("");
      setValidationError("");
      setShowSuggestions(false);
      return;
    }
    
    // Add to local state immediately
    setTickers((prev) => [...prev, { symbol: sym, price: null }]);
    setInput("");
    setValidationError("");
    setShowSuggestions(false);
    
    // Send subscribe request to server
    if (clientRef.current) {
      try {
        const req = new SubscribeRequest({ tickers: [sym] });
        await clientRef.current.subscribe(req);
        console.log(`Subscribed to ${sym}`);
      } catch (error) {
        console.error('Failed to subscribe:', error);
      }
    }
  };

  const selectSuggestion = (suggestion: string) => {
    setInput(suggestion);
    setShowSuggestions(false);
    setValidationError("");
    // Focus back on input
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const removeTicker = async (sym: string) => {
    setTickers((prev) => prev.filter((t) => t.symbol !== sym));
    
    // Send unsubscribe request to server
    if (clientRef.current) {
      try {
        const req = new UnsubscribeRequest({ tickers: [sym] });
        await clientRef.current.unsubscribe(req);
        console.log(`Unsubscribed from ${sym}`);
      } catch (error) {
        console.error('Failed to unsubscribe:', error);
      }
    }
  };

  // Setup ConnectRPC client and price watching stream
  useEffect(() => {
    const startWatching = async () => {
      // Cancel any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setConnectionStatus('connecting');

      try {
        const transport = createConnectTransport({
          baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
        });
        
        const client = createClient(TickerService, transport);
        clientRef.current = client;

        // Start watching prices (server streaming)
        const stream = client.watchPrices(
          new WatchRequest(),
          { signal: abortController.signal }
        );
        
        setConnectionStatus('connected');
        
        for await (const response of stream) {
          if (abortController.signal.aborted) break;
          
          console.log('[watchPrices] Received response:', response);
          
          // Handle the oneof structure from ServerStreamResponse
          let priceUpdate = null;
          if ((response as any).message?.case === 'priceUpdate') {
            priceUpdate = (response as any).message.value;
            console.log('[watchPrices] Price update extracted:', priceUpdate);
          } else {
            console.log('[watchPrices] Response structure:', {
              hasMessage: !!(response as any).message,
              messageCase: (response as any).message?.case,
              fullResponse: JSON.stringify(response)
            });
          }
          
          if (priceUpdate) {
            console.log(`[watchPrices] Updating price for ${priceUpdate.ticker}: ${priceUpdate.price}`);
            setTickers((prev) => {
              const updated = prev.map((t) =>
                t.symbol === priceUpdate.ticker
                  ? { ...t, price: Number(priceUpdate.price) }
                  : t
              );
              console.log('[watchPrices] Updated tickers:', updated);
              return updated;
            });
          }
        }
      } catch (error) {
        if (!abortController.signal.aborted) {
          console.error('Stream error:', error);
          setConnectionStatus('error');
          // Retry after a delay
          setTimeout(() => startWatching(), 3000);
        }
      }
    };

    startWatching();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []); // Only run once on mount

  // Subscribe to existing tickers when client is ready
  useEffect(() => {
    if (clientRef.current && tickers.length > 0 && connectionStatus === 'connected') {
      const subscribeAll = async () => {
        const tickerSymbols = tickers.map(t => t.symbol);
        if (tickerSymbols.length > 0) {
          try {
            const req = new SubscribeRequest({ tickers: tickerSymbols });
            await clientRef.current.subscribe(req);
            console.log('Subscribed to all tickers:', tickerSymbols);
          } catch (error) {
            console.error('Failed to subscribe to tickers:', error);
          }
        }
      };
      subscribeAll();
    }
  }, [connectionStatus]); // Re-subscribe when connection is established

  return (
    <div className="min-h-dvh bg-gray-50 p-8">
      <div className="mx-auto max-w-xl">
        {/* Connection status indicator */}
        <div className="mb-4 text-xs text-gray-600 flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'connecting' ? 'bg-yellow-500' :
            'bg-red-500'
          }`} />
          <span>
            {connectionStatus === 'connected' ? 'Connected to server' :
             connectionStatus === 'connecting' ? 'Connecting...' :
             'Connection error (retrying...)'}
          </span>
        </div>
        
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                className={`w-full rounded border ${
                  validationError ? 'border-red-500' : 'border-gray-300'
                } bg-gray-200 px-3 py-3 text-sm text-black outline-none focus:ring-2 focus:ring-black`}
                placeholder="Enter trading pair (e.g., BTCUSD)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !validationError) addTicker();
                  if (e.key === "Escape") setShowSuggestions(false);
                  if (e.key === "ArrowDown" && suggestions.length > 0) {
                    e.preventDefault();
                    // Focus first suggestion
                    const firstSuggestion = document.querySelector('[data-suggestion="0"]') as HTMLElement;
                    firstSuggestion?.focus();
                  }
                }}
                onFocus={() => {
                  if (suggestions.length > 0) setShowSuggestions(true);
                }}
                onBlur={() => {
                  // Delay to allow clicking on suggestions
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
              />
              
              {/* Autocomplete dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      data-suggestion={index}
                                             className="w-full px-3 py-2 text-left text-sm text-black hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                      onClick={() => selectSuggestion(suggestion)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          selectSuggestion(suggestion);
                        }
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          const next = document.querySelector(`[data-suggestion="${index + 1}"]`) as HTMLElement;
                          next?.focus();
                        }
                        if (e.key === "ArrowUp") {
                          e.preventDefault();
                          if (index === 0) {
                            inputRef.current?.focus();
                          } else {
                            const prev = document.querySelector(`[data-suggestion="${index - 1}"]`) as HTMLElement;
                            prev?.focus();
                          }
                        }
                        if (e.key === "Escape") {
                          setShowSuggestions(false);
                          inputRef.current?.focus();
                        }
                      }}
                    >
                      <span className="font-medium">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <button
              className="rounded bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={addTicker}
              disabled={!input.trim() || !!validationError || !allowedPairs.includes(normalized(input))}
            >
              Add
            </button>
          </div>
          
          {/* Validation error message */}
          {validationError && (
            <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {validationError}
            </div>
          )}
        </div>

        <div className="mt-6 space-y-3">
          {tickers.map((t) => (
            <div key={t.symbol} className="flex items-center justify-between rounded-lg bg-gray-200 px-4 py-3 shadow">
              <div className="text-sm font-semibold tracking-wide text-black">{t.symbol}</div>
              <div className="flex items-center gap-4">
                <div className="tabular-nums text-sm text-gray-900 min-w-24 text-right">
                  {t.price == null ? "—" : Number(t.price).toFixed(2)}
                </div>
                <button
                  aria-label={`remove ${t.symbol}`}
                  className="text-gray-400 hover:text-gray-700"
                  onClick={() => removeTicker(t.symbol)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
