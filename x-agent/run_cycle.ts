import { chromium, Locator, Page } from "playwright";
import axios from "axios";
import {
  authorContext,
  alreadyProcessed,
  loadMemory,
  markDailyPost,
  markProcessed,
  markRadarSeen,
  postTextAlreadyPublished,
  saveMemory,
  textAlreadyHandled,
  XoshiMemory
} from "./memory";

const XOSHI_HANDLE = (process.env.XOSHI_HANDLE || "xoshi_Si").replace(/^@/, "");
const FASTAPI_URL = (process.env.FASTAPI_URL || "").replace(/\/$/, "");
const X_BASE_URL = (process.env.X_BASE_URL || "https://x.com").replace(/\/$/, "");
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.DRY_RUN || "");
const MAX_MENTION_REPLIES = positiveInteger(process.env.MAX_MENTION_REPLIES, 2);
const MAX_RADAR_REPLIES = positiveInteger(process.env.MAX_RADAR_REPLIES, 3);

const RADAR_QUERIES = [
  "$XOSHI",
  '"Stock Tokens"',
  '"tokenized stocks"',
  '"Robinhood Chain"',
  "RWA AI agents",
  "DeFi AI agents",
  '"onchain finance" AI agents'
];

const EDITOR_SELECTOR = [
  '[data-testid="tweetTextarea_0"][contenteditable="true"]',
  '[data-testid="tweetTextarea_0"]',
  '[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][aria-label*="Post"]',
  'div[contenteditable="true"][aria-label*="Tweet"]'
].join(", ");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type TweetCard = { id: string; author: string; text: string };
type PublishResult = "sent" | "simulated" | "failed";

type StatusLink = { id: string; author: string };

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function xUrl(path: string): string {
  return `${X_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function usesRealXDomain(): boolean {
  try {
    const host = new URL(X_BASE_URL).hostname.toLowerCase();
    return host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com");
  } catch {
    return false;
  }
}

function errorSummary(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response ? `HTTP ${error.response.status}` : error.code || "network error";
  }
  return error instanceof Error ? error.name : "unknown error";
}

function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return true;
  const status = error.response?.status;
  return !status || status === 408 || status === 429 || status >= 500;
}

async function withLimitedRetry<T>(label: string, action: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      const retry = attempt < 2 && isRetryable(error);
      console.log(`${label} failed (${errorSummary(error)})${retry ? "; retrying once." : "."}`);
      if (retry) await sleep(750);
      else break;
    }
  }
  throw lastError;
}

async function firstVisible(page: Page, selector: string): Promise<Locator | null> {
  const candidates = page.locator(selector);
  const count = Math.min(await candidates.count().catch(() => 0), 10);
  for (let index = 0; index < count; index++) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

/**
 * Dismiss only a known dialog before opening an editor. Escape is deliberately
 * avoided whenever an editor is visible, so a reply/post composer is never
 * closed by overlay handling.
 */
async function clearOverlays(page: Page): Promise<void> {
  if (await firstVisible(page, EDITOR_SELECTOR)) return;

  const closeButton = await firstVisible(
    page,
    '[role="dialog"] [aria-label="Close"], [data-testid="sheetDialog"] [aria-label="Close"]'
  );
  if (closeButton && await safeClick(closeButton)) {
    await page.waitForTimeout(150);
    return;
  }

  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  } catch {
    // A missing keyboard target is not actionable; selector diagnostics follow.
  }
}

/**
 * Uses a normal user-like click only. Forced clicks can act through an overlay
 * and can target an editor or button that is not actually available to the user.
 */
async function safeClick(locator: Locator): Promise<boolean> {
  try {
    if (!(await locator.isVisible())) return false;
    if ((await locator.getAttribute("aria-disabled")) === "true") return false;
    await locator.scrollIntoViewIfNeeded();
    await locator.click({ timeout: 3500 });
    return true;
  } catch {
    return false;
  }
}

async function waitForEditor(page: Page, timeoutMs = 6500): Promise<Locator | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const editor = await firstVisible(page, EDITOR_SELECTOR);
    if (editor) return editor;
    await page.waitForTimeout(200);
  }
  return null;
}

async function waitForTweetCards(page: Page, label: string): Promise<void> {
  const primary = page.locator('article[data-testid="tweet"], article[role="article"]').first();
  await primary.waitFor({ state: "visible", timeout: 7000 }).catch(() => undefined);
  await page.waitForTimeout(350);
  console.log(
    `${label} diagnostics: articles=${await page.locator("article").count()}, ` +
    `tweetCards=${await page.locator('article[data-testid="tweet"]').count()}, ` +
    `statusLinks=${await page.locator('a[href*="/status/"]').count()}`
  );
}

async function backendHealth(): Promise<boolean> {
  if (!FASTAPI_URL) {
    if (DRY_RUN) {
      console.log("DRY_RUN: FASTAPI_URL missing; generation calls will be skipped.");
      return false;
    }
    throw new Error("FASTAPI_URL missing");
  }

  const response = await withLimitedRetry("Backend health check", () =>
    axios.get(`${FASTAPI_URL}/health`, { timeout: 10000 })
  );
  if (!response.data?.ok) throw new Error("Backend health check failed");
  console.log("Backend alive.");
  return true;
}

async function generateReply(tweetText: string, author: string, previous: unknown[]): Promise<string> {
  if (!FASTAPI_URL) return "";
  try {
    const response = await withLimitedRetry("Reply generation", () =>
      axios.post(
        `${FASTAPI_URL}/api/reading/reply`,
        { tweet: tweetText, author, previous_interactions: previous },
        { timeout: 30000 }
      )
    );
    return String(response.data?.reply || "").trim();
  } catch (error) {
    console.log(`Reply generation skipped (${errorSummary(error)}).`);
    return "";
  }
}

async function generateMarketPost(memory: XoshiMemory): Promise<string> {
  if (!FASTAPI_URL) return "";
  try {
    const response = await withLimitedRetry("Market post generation", () =>
      axios.post(
        `${FASTAPI_URL}/api/reading/market_cycle`,
        { recent_posts: memory.recentPosts.slice(-100) },
        { timeout: 45000 }
      )
    );
    const post = String(response.data?.post || "").trim();
    if (!post && response.data?.reason) console.log(`Project watch skipped: ${response.data.reason}`);
    return post;
  } catch (error) {
    console.log(`Market post generation skipped (${errorSummary(error)}).`);
    return "";
  }
}

async function validateSession(page: Page): Promise<void> {
  await page.goto(xUrl("/home"), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(700);
  if (usesRealXDomain()) {
    const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    if (body.includes("log in") || body.includes("sign in")) {
      throw new Error("X session is not authenticated.");
    }
  }
  console.log(`X session valid: @${XOSHI_HANDLE}`);
}

export function extractStatusFromHref(href: string | null): StatusLink | null {
  if (!href) return null;
  const pathname = href.split("?")[0];
  const segments = pathname.split("/").filter(Boolean);
  const statusIndex = segments.indexOf("status");
  const id = statusIndex >= 0 ? segments[statusIndex + 1] : "";
  if (!/^\d+$/.test(id)) return null;

  const possibleAuthor = segments[statusIndex - 1] || "";
  const author = possibleAuthor === "i" || possibleAuthor === "web" ? "" : possibleAuthor;
  return { id, author: /^[A-Za-z0-9_]{1,20}$/.test(author) ? author : "" };
}

export function buildSearchUrl(query: string): string {
  return xUrl(`/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`);
}

export function hasVerifiedProjectSources(post: string): boolean {
  const hasDefiLlama = /https:\/\/defillama\.com\/protocol\/[a-z0-9-]+(?:\s|$)/i.test(post);
  const hasEvmTokenScan = /https:\/\/api\.gopluslabs\.io\/api\/v1\/token_security\/\d+\?contract_addresses=0x[a-f0-9]{40}(?:\s|$)/i.test(post);
  const hasSolanaTokenScan = /https:\/\/api\.gopluslabs\.io\/api\/v1\/solana\/token_security\?contract_addresses=[1-9A-HJ-NP-Za-km-z]{32,44}(?:\s|$)/i.test(post);
  const hasTokenScan = hasEvmTokenScan || hasSolanaTokenScan;
  const hasEvmRugScan = /https:\/\/api\.gopluslabs\.io\/api\/v1\/rugpull_detecting\/\d+\?contract_addresses=0x[a-f0-9]{40}(?:\s|$)/i.test(post);
  const hasSolanaRugScan = /https:\/\/api\.rugcheck\.xyz\/v1\/tokens\/[1-9A-HJ-NP-Za-km-z]{32,44}\/report\/summary\?cacheOnly=true(?:\s|$)/i.test(post);
  const hasRugScan = hasEvmRugScan || hasSolanaRugScan;
  const hasNonEndorsement = /not (?:a buy call|an endorsement)/i.test(post);
  const hasRiskLimit = /(?:neither rules out a rug|not proof against rugs)/i.test(post);
  return hasDefiLlama && hasTokenScan && hasRugScan && hasNonEndorsement && hasRiskLimit;
}

async function tweetCardLocator(page: Page): Promise<Locator> {
  const semanticCards = page.locator('article[data-testid="tweet"], article[role="article"]');
  if (await semanticCards.count()) return semanticCards;
  return page.locator("article");
}

async function statusForCard(card: Locator): Promise<StatusLink | null> {
  const timeLinks = card.locator('a:has(time)[href*="/status/"]');
  const allLinks = card.locator('a[href*="/status/"]');
  for (const links of [timeLinks, allLinks]) {
    const count = Math.min(await links.count().catch(() => 0), 12);
    for (let index = 0; index < count; index++) {
      const status = extractStatusFromHref(await links.nth(index).getAttribute("href").catch(() => null));
      if (status) return status;
    }
  }
  return null;
}

async function authorForCard(card: Locator, status: StatusLink): Promise<string> {
  if (status.author) return status.author;
  const profileLinks = card.locator('a[href^="/"]');
  const count = Math.min(await profileLinks.count().catch(() => 0), 12);
  for (let index = 0; index < count; index++) {
    const href = await profileLinks.nth(index).getAttribute("href").catch(() => null);
    if (href && /^\/[A-Za-z0-9_]{1,20}$/.test(href)) return href.slice(1);
  }
  return "";
}

async function textForCard(card: Locator): Promise<string> {
  const tweetText = await card.locator('[data-testid="tweetText"]').allTextContents().catch(() => []);
  const text = tweetText.join(" ").replace(/\s+/g, " ").trim();
  return text || (await card.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
}

async function findTweetCards(page: Page): Promise<TweetCard[]> {
  const cards = await tweetCardLocator(page);
  const out: TweetCard[] = [];
  const ids = new Set<string>();
  const count = Math.min(await cards.count().catch(() => 0), 30);

  for (let index = 0; index < count; index++) {
    const card = cards.nth(index);
    const status = await statusForCard(card);
    if (!status || ids.has(status.id)) continue;
    const [author, text] = await Promise.all([authorForCard(card, status), textForCard(card)]);
    if (!text) continue;
    ids.add(status.id);
    out.push({ id: status.id, author, text });
  }
  return out;
}

async function editorCleared(editor: Locator, timeoutMs = 4500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await editor.isVisible().catch(() => false);
    const content = (await editor.textContent().catch(() => ""))?.trim() || "";
    if (!visible || !content) return true;
    await sleep(250);
  }
  return false;
}

async function postReply(page: Page, tweetId: string, reply: string): Promise<PublishResult> {
  console.log(`Opening tweet ${tweetId}...`);
  await page.goto(xUrl(`/i/status/${tweetId}`), { waitUntil: "domcontentloaded", timeout: 30000 });
  await clearOverlays(page);

  const replyButton = await firstVisible(page, '[data-testid="reply"], [aria-label*="Reply"]');
  if (!replyButton || !(await safeClick(replyButton))) {
    console.log(`Reply button not available. Current URL: ${page.url()}`);
    return "failed";
  }

  const editor = await waitForEditor(page);
  if (!editor) {
    console.log(`Reply editor not found. Current URL: ${page.url()}`);
    return "failed";
  }
  await editor.fill(reply);
  await page.waitForTimeout(150);

  if (DRY_RUN) {
    console.log("DRY_RUN: reply prepared; no publish attempted.");
    return "simulated";
  }

  const send = await firstVisible(page, '[data-testid="tweetButtonInline"], [data-testid="tweetButton"]');
  if (send && await safeClick(send)) {
    if (await editorCleared(editor)) {
      console.log("Reply sent and composer cleared.");
      return "sent";
    }
    console.log("Reply click completed but send could not be verified; not recording it.");
    return "failed";
  }

  await editor.press("Control+Enter").catch(() => undefined);
  if (await editorCleared(editor)) {
    console.log("Reply sent via keyboard and composer cleared.");
    return "sent";
  }

  console.log("Reply was not sent; no memory update was made.");
  return "failed";
}

async function saveVerifiedMemory(memory: XoshiMemory): Promise<void> {
  if (DRY_RUN) return;
  await saveMemory(memory);
}

async function processMentions(page: Page, memory: XoshiMemory, cycleSeen: Set<string>): Promise<number> {
  console.log("--- DIRECT MENTIONS ---");
  await page.goto(xUrl(`/${XOSHI_HANDLE}/with_replies`), { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForTweetCards(page, "Mentions");
  const candidates = await findTweetCards(page);
  console.log(`Mention candidates extracted: ${candidates.length}`);
  let replied = 0;

  for (const item of candidates) {
    if (replied >= MAX_MENTION_REPLIES) break;
    if (cycleSeen.has(item.id)) continue;
    cycleSeen.add(item.id);
    if (alreadyProcessed(memory, item.id)) {
      console.log(`Skip already processed tweet: ${item.id}`);
      continue;
    }
    if (!item.text.toLowerCase().includes(`@${XOSHI_HANDLE.toLowerCase()}`)) continue;
    if (!item.author || item.author.toLowerCase() === XOSHI_HANDLE.toLowerCase()) continue;
    if (textAlreadyHandled(memory, item.text)) {
      console.log(`Skip repeated tweet text: ${item.id}`);
      continue;
    }

    console.log(`Mention @${item.author}: ${item.text.slice(0, 220)}`);
    const reply = await generateReply(item.text, item.author, authorContext(memory, item.author));
    if (!reply) continue;
    const result = await postReply(page, item.id, reply);
    if (result === "sent") {
      markProcessed(memory, { tweetId: item.id, author: item.author, text: item.text, reply });
      await saveVerifiedMemory(memory);
      replied++;
      await sleep(800);
    } else if (result === "simulated") {
      console.log(`DRY_RUN: verified no write for mention ${item.id}.`);
    }
  }
  console.log(`Verified mention replies: ${replied}`);
  return replied;
}

async function processRadar(page: Page, memory: XoshiMemory, cycleSeen: Set<string>): Promise<number> {
  console.log("--- MARKET / CRYPTO RADAR ---");
  let replies = 0;
  for (const query of RADAR_QUERIES) {
    if (replies >= MAX_RADAR_REPLIES) break;
    console.log(`Search: ${query}`);
    await page.goto(buildSearchUrl(query), { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForTweetCards(page, "Radar");
    const candidates = await findTweetCards(page);
    console.log(`Radar tweets extracted: ${candidates.length}`);

    for (const item of candidates.slice(0, 10)) {
      if (replies >= MAX_RADAR_REPLIES) break;
      if (cycleSeen.has(item.id)) continue;
      cycleSeen.add(item.id);
      if (!item.author || item.author.toLowerCase() === XOSHI_HANDLE.toLowerCase()) continue;
      if (alreadyProcessed(memory, item.id) || memory.radarSeenTweets[item.id]) continue;
      if (textAlreadyHandled(memory, item.text)) continue;

      const reply = await generateReply(item.text, item.author, authorContext(memory, item.author));
      if (!reply) continue;
      const result = await postReply(page, item.id, reply);
      if (result === "sent") {
        markRadarSeen(memory, item.id);
        markProcessed(memory, { tweetId: item.id, author: item.author, text: item.text, reply, topic: query });
        await saveVerifiedMemory(memory);
        replies++;
        await sleep(1000);
      } else if (result === "simulated") {
        console.log(`DRY_RUN: verified no write for radar tweet ${item.id}.`);
      }
    }
  }
  return replies;
}

async function openComposer(page: Page): Promise<Locator | null> {
  for (const path of ["/compose/post", "/compose/tweet"]) {
    try {
      await page.goto(xUrl(path), { waitUntil: "domcontentloaded", timeout: 30000 });
      const editor = await waitForEditor(page, 3500);
      if (editor) return editor;
    } catch {
      // Fall through to the next documented composer route.
    }
  }

  await page.goto(xUrl("/home"), { waitUntil: "domcontentloaded", timeout: 30000 });
  await clearOverlays(page);
  const launchers = [
    '[data-testid="SideNav_NewTweet_Button"]',
    '[data-testid="createTweetButton"]',
    'a[href="/compose/post"]',
    'a[href="/compose/post/"]'
  ];
  for (const selector of launchers) {
    const launcher = await firstVisible(page, selector);
    if (launcher && await safeClick(launcher)) {
      const editor = await waitForEditor(page, 3500);
      if (editor) return editor;
    }
  }
  return null;
}

async function postDaily(page: Page, memory: XoshiMemory): Promise<PublishResult> {
  const last = memory.lastDailyPost ? Date.parse(memory.lastDailyPost) : 0;
  if (Date.now() - last < 20 * 60 * 60 * 1000) {
    console.log("Daily post cooldown active.");
    return "failed";
  }

  const post = await generateMarketPost(memory);
  if (!post) return "failed";
  if (!hasVerifiedProjectSources(post)) {
    console.log("Project post rejected: verified metrics/risk sources or risk disclaimer missing.");
    return "failed";
  }
  if (postTextAlreadyPublished(memory, post)) {
    console.log("Skip repeated daily post text.");
    return "failed";
  }
  console.log(`Daily post candidate: ${post}`);

  const editor = await openComposer(page);
  if (!editor) {
    console.log(`Post composer not found. Current URL: ${page.url()}`);
    return "failed";
  }
  await editor.fill(post);
  await page.waitForTimeout(150);

  if (DRY_RUN) {
    console.log("DRY_RUN: daily post prepared; no publish attempted.");
    return "simulated";
  }

  const send = await firstVisible(page, '[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
  if (send && await safeClick(send)) {
    if (await editorCleared(editor)) {
      markDailyPost(memory, post);
      await saveVerifiedMemory(memory);
      console.log("Daily post sent and composer cleared.");
      return "sent";
    }
    console.log("Daily post click completed but send could not be verified; not recording it.");
    return "failed";
  }

  await editor.press("Control+Enter").catch(() => undefined);
  if (await editorCleared(editor)) {
    markDailyPost(memory, post);
    await saveVerifiedMemory(memory);
    console.log("Daily post sent via keyboard and composer cleared.");
    return "sent";
  }

  console.log("Daily post was not sent; no memory update was made.");
  return "failed";
}

export async function main(): Promise<void> {
  console.log("========== XOSHI XI / MEMORY EDITION ==========");
  console.log(`DRY_RUN: ${DRY_RUN ? "ENABLED" : "DISABLED"}`);
  console.log(`FASTAPI_URL: ${FASTAPI_URL ? "SET" : "MISSING"}`);
  console.log(`X session credentials: ${process.env.TWITTER_AUTH_TOKEN && process.env.TWITTER_CT0 ? "SET" : "MISSING"}`);
  console.log(`Gist memory: ${process.env.GIST_ID && process.env.GIST_TOKEN ? "SET" : "DISABLED"}`);

  await backendHealth();
  const memory = await loadMemory();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    usesRealXDomain() && process.env.TWITTER_AUTH_TOKEN
      ? { extraHTTPHeaders: { authorization: `Bearer ${process.env.TWITTER_AUTH_TOKEN}` } }
      : {}
  );

  if (usesRealXDomain() && process.env.TWITTER_AUTH_TOKEN && process.env.TWITTER_CT0) {
    await context.addCookies([
      { name: "auth_token", value: process.env.TWITTER_AUTH_TOKEN, domain: ".x.com", path: "/", httpOnly: true, secure: true },
      { name: "ct0", value: process.env.TWITTER_CT0, domain: ".x.com", path: "/", httpOnly: false, secure: true }
    ]);
  }

  const page = await context.newPage();
  try {
    await validateSession(page);
    const cycleSeen = new Set<string>();
    await processMentions(page, memory, cycleSeen);
    console.log(`Verified radar replies: ${await processRadar(page, memory, cycleSeen)}`);
    await postDaily(page, memory);
  } finally {
    if (DRY_RUN) {
      console.log("DRY_RUN: persistent memory not updated.");
    } else {
      memory.lastCycle = new Date().toISOString();
      await saveMemory(memory);
    }
    await browser.close();
  }
  console.log("Cycle complete.");
}

if (require.main === module) {
  main().catch(error => {
    console.error("Xoshi cycle failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
