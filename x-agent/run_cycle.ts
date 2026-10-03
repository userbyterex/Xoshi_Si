/**
 * Xoshi XI — Sibili-style one-shot X cycle.
 * Playwright + auth_token/ct0 cookies + GitHub Gist memory.
 * This deliberately follows the architecture that worked for Oracleofsibili.
 */
import { chromium, BrowserContext, Page } from 'playwright';
import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { loadMemory, saveMemoryRemote, XoshiMemory } from './gist_memory';

dotenv.config();

const FASTAPI_URL = process.env.FASTAPI_URL || 'http://127.0.0.1:8081';
const HANDLE = (process.env.XOSHI_HANDLE || 'xoshi_Si').replace(/^@/, '');
const EXCLUDE_HANDLE = HANDLE.toLowerCase();
const BACKEND_TIMEOUT = 90000;
const MAX_MENTION_REPLIES = 5;
const MAX_RADAR_REPLIES = 4;
const POST_INTERVAL = 12 * 60 * 60 * 1000;

async function wakeUpBackend(): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await axios.get(`${FASTAPI_URL}/health`, { timeout: 15000 });
      if (r.status === 200) { console.log(`Backend alive: ${JSON.stringify(r.data)}`); return true; }
    } catch { console.log(`Backend attempt ${i + 1}/5 failed`); await new Promise(r => setTimeout(r, 3000)); }
  }
  return false;
}

async function createContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });
  const auth = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;
  if (!auth || !ct0) throw new Error('TWITTER_AUTH_TOKEN and TWITTER_CT0 are required');
  await context.addCookies([
    { name: 'auth_token', value: auth, domain: '.x.com', path: '/', secure: true, httpOnly: true },
    { name: 'ct0', value: ct0, domain: '.x.com', path: '/', secure: true, httpOnly: false },
    { name: 'auth_token', value: auth, domain: '.twitter.com', path: '/', secure: true, httpOnly: true },
    { name: 'ct0', value: ct0, domain: '.twitter.com', path: '/', secure: true, httpOnly: false },
  ]);
  return context;
}

async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const url = page.url();
    if (/\/login|\/flow\/login|\/account\/access/i.test(url)) return false;
    const body = await page.locator('body').innerText().catch(() => '');
    return !/sign in|log in/i.test(body.slice(0, 1000));
  } catch (e: any) { console.log(`Session check failed: ${e.message}`); return false; }
}

function detectLanguage(text: string): string {
  const t = text.toLowerCase();
  if (/[а-яё]/.test(t)) return 'ru';
  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';
  if (/[\u3040-\u30ff]/.test(t)) return 'ja';
  if (/\b(el|la|los|las|que|qué|para|como|cómo|una|está|estás|quiero|sobre)\b/.test(t)) return 'es';
  if (/\b(le|les|des|une|avec|pour|comment|quoi|est)\b/.test(t)) return 'fr';
  if (/\b(der|die|das|und|für|wie|was|ist)\b/.test(t)) return 'de';
  if (/\b(o|os|as|para|como|que|uma|sobre|está)\b/.test(t)) return 'pt';
  if (/\b(il|lo|gli|per|come|cosa|una|sulla)\b/.test(t)) return 'it';
  if (/\b(els|les|per|com|què|una|sobre)\b/.test(t)) return 'ca';
  return 'en';
}

async function backend(pathname: string, data: any) {
  return axios.post(`${FASTAPI_URL}${pathname}`, data, { timeout: BACKEND_TIMEOUT });
}

async function extractTweets(page: Page, limit: number) {
  const articles = page.locator('article[data-testid="tweet"]');
  const count = await articles.count();
  const out: any[] = [];
  for (let i = 0; i < Math.min(count, limit); i++) {
    const tweet = articles.nth(i);
    const text = await tweet.locator('div[data-testid="tweetText"]').first().textContent().catch(() => '') || '';
    let href: string | null = null;
    const links = tweet.locator('a[href*="/status/"]');
    const linkCount = await links.count();

    for (let j = 0; j < linkCount; j++) {
      const candidate = await links.nth(j).getAttribute('href').catch(() => null);
      if (candidate && /\/status\/\d+/.test(candidate)) {
        href = candidate;
        break;
      }
    }

    const id = href?.match(/\/status\/(\d+)/)?.[1];
    if (!id || !text) continue;
    const authorRaw = await tweet.locator('div[dir="ltr"]').filter({ hasText: '@' }).first().textContent().catch(() => '') || '';
    const author = authorRaw.replace('@', '').trim().split(/\s/)[0];
    out.push({ id, text, author, tweet });
  }
  return out;
}

async function postReply(
  page: Page,
  tweet: any,
  reply: string
): Promise<boolean> {
  try {
    console.log(`   Opening tweet ${tweet.id}...`);

    await page.goto(`https://x.com/i/web/status/${tweet.id}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(4000);
    await clearOverlays(page);

    const article = page.locator('article[data-testid="tweet"]').first();

    if (!(await article.count())) {
      console.log("   Tweet article not found.");
      return false;
    }

    await article.scrollIntoViewIfNeeded().catch(() => {});

    const replySelectors = [
      '[data-testid="reply"]',
      '[aria-label*="Reply"]',
      'button[aria-label*="Reply"]',
    ];

    let replyButton: Locator | null = null;

    for (const selector of replySelectors) {
      const candidate = article.locator(selector).first();

      if (
        await candidate.count() &&
        await candidate.isVisible().catch(() => false)
      ) {
        replyButton = candidate;
        break;
      }
    }

    if (!replyButton) {
      console.log("   Reply button not found.");
      return false;
    }

    if (!(await safeClick(replyButton, page, "reply button"))) {
      return false;
    }

    await page.waitForTimeout(1500);
    await clearOverlays(page);

    const boxSelectors = [
      '[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"]',
      '[contenteditable="true"]',
    ];

    let box: Locator | null = null;

    for (const selector of boxSelectors) {
      const candidates = page.locator(selector);
      const count = await candidates.count();

      for (let i = count - 1; i >= 0; i--) {
        const candidate = candidates.nth(i);

        if (await candidate.isVisible().catch(() => false)) {
          box = candidate;
          break;
        }
      }

      if (box) break;
    }

    if (!box) {
      console.log("   Reply composer not found.");
      return false;
    }

    await box.click({ timeout: 5000, force: true });

    await box.pressSequentially(reply.slice(0, 280), {
      delay: 18,
    });

    await page.waitForTimeout(1000);

    const sendSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
    ];

    let sendButton: Locator | null = null;

    for (const selector of sendSelectors) {
      const candidates = page.locator(selector);
      const count = await candidates.count();

      for (let i = count - 1; i >= 0; i--) {
        const candidate = candidates.nth(i);

        if (await candidate.isVisible().catch(() => false)) {
          sendButton = candidate;
          break;
        }
      }

      if (sendButton) break;
    }

    if (!sendButton) {
      console.log("   Reply send button not found.");
      return false;
    }

    if (!(await safeClick(sendButton, page, "reply send button"))) {
      return false;
    }

    await page.waitForTimeout(3000);

    console.log("   Reply sent.");
    return true;

  } catch (e: any) {
    console.log(`Reply failed for ${tweet.id}: ${e.message}`);
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }
}

async function postTweet(page: Page, text: string): Promise<boolean> {
  try {
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3500);
    const compose = page.locator('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]').first();
    if (await compose.count()) await compose.click(); else await page.keyboard.press('n');
    await page.waitForTimeout(1500);
    const box = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"]').first();
    await box.waitFor({ state: 'visible', timeout: 10000 });
    await box.click();
    await box.pressSequentially(text.slice(0, 280), { delay: 25 });
    const btn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"], div[role="button"]:has-text("Post")').first();
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.click({ timeout: 7000, force: true });
    await page.waitForTimeout(4000);
    return !(await btn.isVisible().catch(() => false));
  } catch (e: any) { console.log(`Post failed: ${e.message}`); return false; }
}

async function scrapeMentionsAndReply(page: Page, memory: XoshiMemory) {
  console.log('--- DIRECT MENTIONS ---');
  await page.goto('https://x.com/notifications/mentions', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  const tweets = await extractTweets(page, 10);
  let replied = 0;
  for (const tweet of tweets) {
    if (replied >= MAX_MENTION_REPLIES || memory.repliedTweets.includes(tweet.id)) continue;
    if (!tweet.author || tweet.author.toLowerCase() === EXCLUDE_HANDLE) continue;
    const result = await backend('/api/intelligence/mention', {
      author: tweet.author,
      text: tweet.text,
      detected_language: detectLanguage(tweet.text),
    }).then(r => r.data).catch(() => null);
    if (!result?.reply) continue;
    console.log(`Mention @${tweet.author}: ${tweet.text.slice(0, 80)}`);
    if (await postReply(page, tweet, result.reply)) {
      memory.repliedTweets.push(tweet.id); replied++;
    }
  }
  console.log(`Mention replies: ${replied}`);
}

async function scrapeSearchAndReply(page: Page, memory: XoshiMemory) {
  console.log('--- MARKET / CRYPTO RADAR ---');
  const queries = [
    '$XOSHI', '"Stock Tokens"', '"tokenized stocks"', '"Robinhood Chain"',
    '"RWA" "AI agents"', 'DeFi "AI agents"', '"onchain finance" "AI agents"'
  ];
  let replied = 0;
  for (const query of queries) {
    if (replied >= MAX_RADAR_REPLIES) break;
    console.log(`Search: ${query}`);
    try {
      await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
      const tweets = await extractTweets(page, 8);
      for (const tweet of tweets) {
        if (replied >= MAX_RADAR_REPLIES || memory.repliedTweets.includes(tweet.id)) continue;
        if (!tweet.author || tweet.author.toLowerCase() === EXCLUDE_HANDLE) continue;
        const result = await backend('/api/intelligence/analyze', {
          author: tweet.author,
          text: tweet.text,
          engagement: {},
          previous_interactions: memory.repliedTweets.slice(-20),
          detected_language: detectLanguage(tweet.text),
        }).then(r => r.data).catch(() => null);
        if (result?.decision !== 'REPLY' || Number(result.confidence || 0) < 0.60 || !result.reply) continue;
        console.log(`Radar @${tweet.author}: ${tweet.text.slice(0, 80)}`);
        if (await postReply(page, tweet, result.reply)) {
          memory.repliedTweets.push(tweet.id); replied++;
        }
      }
    } catch (e: any) { console.log(`Search failed: ${e.message}`); }
  }
  console.log(`Radar replies: ${replied}`);
}

async function main() {
  console.log(`========== XOSHI XI / SIBILI-STYLE CYCLE ==========`);
  const memory = await loadMemory();
  const alive = await wakeUpBackend();
  if (!alive) return;
  const context = await createContext();
  const page = await context.newPage();
  try {
    if (!await isLoggedIn(page)) throw new Error('X session is not authenticated');
    console.log(`X session valid: @${HANDLE}`);
    await scrapeMentionsAndReply(page, memory);
    await scrapeSearchAndReply(page, memory);
    const now = Date.now();
    const since = memory.lastDailyPostTime ? now - memory.lastDailyPostTime : Infinity;
    if (since >= POST_INTERVAL) {
      const daily = await backend('/api/reading/daily', { language: 'en' }).then(r => r.data).catch(() => null);
      if (daily?.text && await postTweet(page, daily.text)) {
        memory.lastDailyPostTime = now;
        memory.postedTexts = [...(memory.postedTexts || []), { text: daily.text, time: now }].slice(-20);
        console.log('XOSHI DAILY POSTED');
      }
    } else {
      console.log(`Daily post not due for ${Math.ceil((POST_INTERVAL - since) / 60000)}m`);
    }
    memory.repliedTweets = memory.repliedTweets.slice(-500);
  } finally {
    await context.browser()?.close();
  }
  await saveMemoryRemote(memory);
  console.log('Cycle complete.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
