import { EventEmitter } from 'node:events';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { buildSymbolUrl, PRICE_SELECTORS } from './utils/tradingview';

type PriceUpdate = {
  ticker: string;
  price: number;
  ts: number;
  source: 'tradingview';
};

export class TickerSubscriptionManager {
  private static instance: TickerSubscriptionManager | null = null;

  static getInstance(): TickerSubscriptionManager {
    if (!this.instance) this.instance = new TickerSubscriptionManager();
    return this.instance;
  }

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private emitter = new EventEmitter();
  private pages = new Map<string, Page>();
  private refCounts = new Map<string, number>();
  private starting = new Map<string, Promise<void>>();
  private closing = new Map<string, Promise<void>>();
  private lastPrices = new Map<string, PriceUpdate>();

  private constructor() {
    this.emitter.setMaxListeners(0);
  }

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({
      headless: true,  // Run in headed mode to show browser activity
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    this.context = await this.browser.newContext({
      bypassCSP: true,
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    });
  }

  async shutdown(): Promise<void> {
    for (const [ticker] of this.pages) {
      await this.stopPage(ticker).catch(() => {});
    }
    this.pages.clear();
    this.refCounts.clear();
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  getActiveTickers(): string[] {
    return Array.from(this.pages.keys());
  }

  onPrice(ticker: string, handler: (u: PriceUpdate) => void): () => void {
    const key = this.topicKey(ticker);
    this.emitter.on(key, handler);
    
    // Send last known price immediately if available
    const lastPrice = this.lastPrices.get(ticker);
    if (lastPrice) {
      console.log(`[manager] sending cached price for ${ticker}: ${lastPrice.price}`);
      // Use setImmediate to send it asynchronously
      setImmediate(() => handler(lastPrice));
    }
    
    return () => this.emitter.off(key, handler);
  }

  async subscribe(tickerRaw: string): Promise<void> {
    const ticker = tickerRaw.trim().toUpperCase();
    const current = this.refCounts.get(ticker) ?? 0;
    this.refCounts.set(ticker, current + 1);
    console.log(`[manager] subscribe ${ticker} -> count ${current + 1}`);
    if (current === 0) {
      await this.ensurePage(ticker);
    }
  }

  async unsubscribe(tickerRaw: string): Promise<void> {
    const ticker = tickerRaw.trim().toUpperCase();
    const current = this.refCounts.get(ticker) ?? 0;
    if (current <= 1) {
      this.refCounts.delete(ticker);
      console.log(`[manager] unsubscribe ${ticker} -> count 0 (closing page)`);
      await this.stopPage(ticker);
    } else {
      this.refCounts.set(ticker, current - 1);
      console.log(`[manager] unsubscribe ${ticker} -> count ${current - 1}`);
    }
  }

  private topicKey(ticker: string): string {
    return `price-update:${ticker}`;
  }

  private async ensurePage(ticker: string): Promise<void> {
    if (this.pages.has(ticker)) return;

    if (this.starting.has(ticker)) {
      return this.starting.get(ticker)!;
    }

    const p = (async () => {
      if (!this.browser || !this.context) {
        await this.start();
      }
      if (!this.context) throw new Error('Browser context not ready');

      const url = buildSymbolUrl(ticker);
      const page = await this.context.newPage();
      console.log(`[manager] starting page for ${ticker} -> ${url}`);
      page.on('console', (msg) => {
        try {
          const type = msg.type();
          const text = msg.text();
          if (type === 'error' || text.startsWith('[inject]')) {
            console.log(`[page ${ticker} ${type}] ${text}`);
          }
        } catch {}
      });

      // Bridge updates from page -> Node
      await page.exposeBinding(
        'pushPriceUpdate',
        (_source, payload: { price: number; ts: number }) => {
          if (Number.isFinite(payload?.price)) {
            const update: PriceUpdate = {
              ticker,
              price: payload.price,
              ts: payload.ts || Date.now(),
              source: 'tradingview'
            };
            console.log(`[manager] price ${ticker}: ${update.price} @ ${new Date(update.ts).toISOString()}`);
            this.lastPrices.set(ticker, update);  // Cache the latest price
            this.emitter.emit(this.topicKey(ticker), update);
          }
        }
      );

      page.on('close', () => {
        this.pages.delete(ticker);
        console.log(`[manager] page closed for ${ticker}`);
      });

      page.on('pageerror', (err) => {
        console.error(`[manager] page error for ${ticker}`, err);
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      // Attach observer inside the page to watch price node changes
      await this.attachPriceObserver(page, ticker);
      console.log(`[manager] observer attached for ${ticker}`);

      this.pages.set(ticker, page);
    })()
      .catch(async (err) => {
        // If startup failed, decrement the ref count that triggered this open
        // and rethrow so callers can handle the error.
        this.refCounts.set(ticker, Math.max(0, (this.refCounts.get(ticker) ?? 1) - 1));
        try {
          await this.pages.get(ticker)?.close();
        } catch {}
        this.pages.delete(ticker);
        throw err;
      })
      .finally(() => {
        this.starting.delete(ticker);
      });

    this.starting.set(ticker, p);
    return p;
  }

  private async stopPage(ticker: string): Promise<void> {
    if (!this.pages.has(ticker)) return;
    if (this.closing.has(ticker)) return this.closing.get(ticker)!;

    const p = (async () => {
      const page = this.pages.get(ticker);
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
      this.pages.delete(ticker);
    })().finally(() => this.closing.delete(ticker));

    this.closing.set(ticker, p);
    return p;
  }

  private async attachPriceObserver(page: Page, ticker: string): Promise<void> {
    const selectors = PRICE_SELECTORS;
    const selector = await this.resolveFirstSelector(page, selectors, 30_000);
    if (!selector) {
      throw new Error(`Price element not found for ${ticker}`);
    }
    console.log(`[manager] ${ticker} selector: ${selector}`);

    // Kick off initial read + watch for changes (inject as a string to avoid dev-time bundler helpers)
    await page.evaluate(`(() => {
      const sel = ${JSON.stringify(selector)};
      const target = document.querySelector(sel);
      if (!target) return;
      console.log('[inject]', 'target found for', sel);
      const toNumber = (text) => {
        const cleaned = text.replace(/[^\\d.,\\-]/g, '').replace(/,/g, '');
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : null;
      };
      const publish = (text) => {\n\
        if (!text) return;\n\
        console.log('[inject]', 'raw text', text);\n\
        const price = toNumber(text);\n\
        console.log('[inject]', 'parsed', price);\n\
        if (price != null && window.pushPriceUpdate) {\n\
          window.pushPriceUpdate({ price, ts: Date.now() });\n\
        }\n\
      };\n\
      publish(target.textContent || target.innerText);\n\
      const obs = new MutationObserver((muts) => {\n\
        for (const m of muts) {\n\
          if (m.type === 'characterData' || m.type === 'childList' || m.type === 'attributes') {\n\
            const txt = target.innerText ?? target.textContent ?? (m.target && m.target.textContent) ?? '';\n\
            publish(txt);\n\
          }\n\
        }\n\
      });\n\
      obs.observe(target, { characterData: true, childList: true, subtree: true, attributes: true });\n\
      const iv = setInterval(() => publish(target.textContent || target.innerText), 60000);\n\
      window.__tvPriceCleanup = function() {\n\
        try { obs.disconnect(); } catch (e) {}\n\
        try { clearInterval(iv); } catch (e) {}\n\
      };\n\
    })();`);
  }

  private async resolveFirstSelector(page: Page, selectors: string[], timeoutMs: number): Promise<string | null> {
    const start = Date.now();
    for (const sel of selectors) {
      const timeLeft = Math.max(0, timeoutMs - (Date.now() - start));
      try {
        await page.waitForSelector(sel, { timeout: Math.min(10_000, timeLeft), state: 'attached' });
        return sel;
      } catch {
        console.log(`Selector ${sel} not found`);
      }
    }
    return null;
  }
}

export default TickerSubscriptionManager.getInstance();