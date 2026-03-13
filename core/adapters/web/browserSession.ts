import puppeteer from 'puppeteer-core';
import * as cheerio from 'cheerio';

import type { Browser, BrowserContext, Page } from 'puppeteer-core';

type PageContent = {
  url: string;
  title: string;
  text: string;
  links: { index: number; text: string; href: string }[];
};

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_SESSIONS = 3;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 min
const CLEANUP_INTERVAL = 60 * 1000; // 1 min

class BrowserSession {
  readonly roomId: string;
  private context: BrowserContext;
  private page: Page;
  lastActivity: number;

  constructor(roomId: string, context: BrowserContext, page: Page) {
    this.roomId = roomId;
    this.context = context;
    this.page = page;
    this.lastActivity = Date.now();
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  async navigate(url: string): Promise<void> {
    this.touch();
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 });
  }

  async click(target: string): Promise<string> {
    this.touch();
    // Try CSS selector first
    try {
      await this.page.waitForSelector(target, { timeout: 3000 });
      await this.page.click(target);
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
      return `Clicked "${target}"`;
    } catch {
      // Fall back to text content match via JS string (avoids DOM type issues)
    }

    const escapedTarget = target.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const clicked = await this.page.evaluate(`(() => {
      const searchText = '${escapedTarget}';
      const lower = searchText.toLowerCase();
      const candidates = Array.from(document.querySelectorAll('a, button, [role="button"], input[type="submit"], input[type="button"], [onclick]'));
      for (const el of candidates) {
        const text = (el.innerText || '').trim().toLowerCase();
        const value = (el.value || '').toLowerCase();
        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes(lower) || value.includes(lower) || ariaLabel.includes(lower)) {
          el.click();
          return (el.innerText || '').trim() || el.tagName;
        }
      }
      return null;
    })()`) as string | null;

    if (!clicked) throw new Error(`No element found matching "${target}"`);
    await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 5000 }).catch(() => {});
    return `Clicked "${clicked}"`;
  }

  async type(selector: string, text: string): Promise<void> {
    this.touch();
    await this.page.waitForSelector(selector, { timeout: 3000 });
    await this.page.click(selector);
    await this.page.type(selector, text, { delay: 30 });
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    this.touch();
    const delta = direction === 'down' ? 600 : -600;
    await this.page.evaluate(`window.scrollBy(0, ${delta})`);
  }

  async back(): Promise<void> {
    this.touch();
    await this.page.goBack({ waitUntil: 'networkidle2', timeout: 10_000 }).catch(() => {});
  }

  async forward(): Promise<void> {
    this.touch();
    await this.page.goForward({ waitUntil: 'networkidle2', timeout: 10_000 }).catch(() => {});
  }

  async extract(): Promise<PageContent> {
    this.touch();
    const html = await this.page.content();
    const currentUrl = this.page.url();
    const $ = cheerio.load(html);

    $('script, style, nav, footer, header, noscript, iframe, svg, [role="navigation"], [role="banner"]').remove();

    const title = $('title').first().text().trim() || $('h1').first().text().trim() || currentUrl;
    const mainContent = $('article, main, [role="main"]');
    const contentRoot = mainContent.length > 0 ? mainContent.first() : $('body');
    const rawText = contentRoot.text().replace(/\s+/g, ' ').trim();
    const text = rawText.substring(0, 8000);

    const links: PageContent['links'] = [];
    contentRoot.find('a[href]').each((i, el) => {
      if (i >= 30) return false;
      const linkText = $(el).text().trim();
      let href = $(el).attr('href') || '';
      if (!linkText || !href) return;
      if (href.startsWith('/')) {
        try { href = new URL(href, currentUrl).href; } catch { /* skip */ }
      }
      if (href.startsWith('http')) {
        links.push({ index: links.length + 1, text: linkText.substring(0, 80), href });
      }
    });

    return { url: currentUrl, title, text, links };
  }

  async screenshot(): Promise<string> {
    this.touch();
    const buffer = await this.page.screenshot({ type: 'jpeg', quality: 75 });
    return Buffer.from(buffer).toString('base64');
  }

  async wait(seconds: number): Promise<void> {
    this.touch();
    const ms = Math.min(seconds, 10) * 1000;
    await new Promise((r) => setTimeout(r, ms));
  }

  getUrl(): string {
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    try { return await this.page.title(); } catch { return ''; }
  }

  async close(): Promise<void> {
    try { await this.context.close(); } catch { /* ignore */ }
  }
}

class BrowserSessionManager {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private onSessionClosed: ((roomId: string) => void) | null = null;

  setOnSessionClosed(cb: (roomId: string) => void): void {
    this.onSessionClosed = cb;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      this.startCleanup();
    }
    return this.browser;
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [roomId, session] of this.sessions) {
      if (now - session.lastActivity > INACTIVITY_TIMEOUT) {
        console.log(`[BrowserSession] Closing idle session for room ${roomId}`);
        this.destroy(roomId);
      }
    }
    if (this.sessions.size === 0 && this.browser) {
      this.browser.close().catch(() => {});
      this.browser = null;
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }
  }

  private evictLRU(): void {
    let oldest: string | null = null;
    let oldestTime = Infinity;
    for (const [roomId, session] of this.sessions) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldest = roomId;
      }
    }
    if (oldest) {
      console.log(`[BrowserSession] Evicting LRU session for room ${oldest}`);
      this.destroy(oldest);
    }
  }

  async getOrCreate(roomId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(roomId);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictLRU();
    }

    const browser = await this.ensureBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(USER_AGENT);
    // Anti-bot
    await page.evaluateOnNewDocument(`Object.defineProperty(navigator, 'webdriver', { get: () => false })`);

    const session = new BrowserSession(roomId, context, page);
    this.sessions.set(roomId, session);
    console.log(`[BrowserSession] Created session for room ${roomId} (${this.sessions.size}/${MAX_SESSIONS})`);
    return session;
  }

  get(roomId: string): BrowserSession | undefined {
    return this.sessions.get(roomId);
  }

  destroy(roomId: string): void {
    const session = this.sessions.get(roomId);
    if (session) {
      session.close().catch(() => {});
      this.sessions.delete(roomId);
      if (this.onSessionClosed) this.onSessionClosed(roomId);
    }
  }

  async destroyAll(): Promise<void> {
    for (const roomId of this.sessions.keys()) {
      this.destroy(roomId);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  activeCount(): number {
    return this.sessions.size;
  }
}

const browserSessionManager = new BrowserSessionManager();

export { browserSessionManager, BrowserSession };
export type { PageContent };
