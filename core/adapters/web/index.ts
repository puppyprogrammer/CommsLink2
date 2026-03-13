import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer-core';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type PageContent = {
  url: string;
  title: string;
  text: string;
  links: { index: number; text: string; href: string }[];
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Search Brave and return top results.
 */
const search = async (query: string, maxResults = 8): Promise<SearchResult[]> => {
  const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(10_000),
    });

    const html = await response.text();
    const $ = cheerio.load(html);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    // Brave wraps each result link in a parent with class containing "result-content"
    $('a').each((_, el) => {
      if (results.length >= maxResults) return false;
      const parentClass = $(el).parent().attr('class') || '';
      if (!parentClass.includes('result-content')) return;
      const href = $(el).attr('href') || '';
      if (!href.startsWith('http') || seen.has(href)) return;
      seen.add(href);
      const title = $(el).text().trim().split('\n')[0].trim();
      // Description is in a sibling .snippet-description
      const snippet = $(el).closest('.snippet').find('.snippet-description').text().trim();
      if (title) results.push({ title, url: href, snippet });
    });

    return results;
  } catch {
    return [];
  }
};

/**
 * Fetch a web page and extract readable text content.
 */
const fetchPage = async (url: string): Promise<PageContent> => {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status >= 400) {
    throw new Error(`Failed to fetch ${url} (${response.status})`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/xhtml')) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, noscript, iframe, svg, [role="navigation"], [role="banner"]').remove();

  // Extract title
  const title = $('title').first().text().trim() || $('h1').first().text().trim() || url;

  // Extract text — prefer article/main content if available
  const mainContent = $('article, main, [role="main"]');
  const contentRoot = mainContent.length > 0 ? mainContent.first() : $('body');

  // Get text, collapse whitespace
  const rawText = contentRoot.text().replace(/\s+/g, ' ').trim();
  // Cap at ~8000 chars for AI context
  const text = rawText.substring(0, 8000);

  // Extract links with indices for navigation
  const links: PageContent['links'] = [];
  contentRoot.find('a[href]').each((i, el) => {
    if (i >= 30) return false; // Cap at 30 links
    const linkText = $(el).text().trim();
    let href = $(el).attr('href') || '';
    if (!linkText || !href) return;

    // Resolve relative URLs
    if (href.startsWith('/')) {
      try {
        const base = new URL(url);
        href = `${base.origin}${href}`;
      } catch { /* skip */ }
    }

    if (href.startsWith('http')) {
      links.push({ index: links.length + 1, text: linkText.substring(0, 80), href });
    }
  });

  return { url, title, text, links };
};

/**
 * Search within extracted page text for a specific query.
 * Returns matching paragraphs/sections with surrounding context.
 */
const findInPage = (pageText: string, query: string, maxMatches = 5): string[] => {
  const lower = pageText.toLowerCase();
  const queryLower = query.toLowerCase();
  const matches: string[] = [];
  let startPos = 0;

  while (matches.length < maxMatches) {
    const idx = lower.indexOf(queryLower, startPos);
    if (idx === -1) break;

    // Extract ~200 chars of context around the match
    const contextStart = Math.max(0, idx - 100);
    const contextEnd = Math.min(pageText.length, idx + query.length + 100);
    const snippet = (contextStart > 0 ? '...' : '') +
      pageText.substring(contextStart, contextEnd) +
      (contextEnd < pageText.length ? '...' : '');

    matches.push(snippet);
    startPos = idx + query.length;
  }

  return matches;
};

/**
 * Take a screenshot of a web page using Puppeteer.
 * Returns a base64-encoded JPEG image.
 */
const screenshotPage = async (url: string): Promise<string> => {
  const chromiumPath =
    process.env.CHROMIUM_PATH || '/usr/bin/chromium';

  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent(USER_AGENT);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15_000 });
    const buffer = await page.screenshot({ type: 'jpeg', quality: 80 });
    return Buffer.from(buffer).toString('base64');
  } finally {
    await browser.close();
  }
};

export { browserSessionManager } from './browserSession';
export type { SearchResult, PageContent };
export default { search, fetchPage, findInPage, screenshotPage };
