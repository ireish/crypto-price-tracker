export const BINANCE_EXCHANGE = 'BINANCE';

export function buildSymbolUrl(ticker: string): string {
  const clean = ticker.trim().toUpperCase();
  return `https://www.tradingview.com/symbols/${encodeURIComponent(clean)}/?exchange=${encodeURIComponent(BINANCE_EXCHANGE)}`;
}

// Candidate selectors; adjust if TradingView updates its DOM.
// We try these in order and attach a MutationObserver to the first that resolves.
export const PRICE_SELECTORS: string[] = [
  '.last-zoF9r75I.js-symbol-last',
  '.js-symbol-last',
  '.tv-symbol-price-quote__value',
  '[data-field="price"]',
  '[data-qa="quote-price"]',
  '[class*="last"], [class*="price"]'
];

export function parsePrice(input: string | null | undefined): number | null {
  if (!input) return null;
  const cleaned = input.replace(/[^\d.,\-]/g, '').replace(/,/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}