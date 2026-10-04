import { chromium, BrowserContext, Page, Locator } from "playwright";
import axios from "axios";
import { loadMemory, saveMemory, alreadyProcessed, markProcessed, markRadarSeen, authorContext, textAlreadyHandled } from "./memory";

const XOSHI_HANDLE = (process.env.XOSHI_HANDLE || "xoshi_Si").replace(/^@/, "");
const FASTAPI_URL = (process.env.FASTAPI_URL || "").replace(/\/$/, "");

const RADAR_QUERIES = [
  "$XOSHI",
  "Stock Tokens",
  "tokenized stocks",
  "Robinhood Chain",
  "RWA tokenization",
  "onchain equities",
  "AI agents crypto",
  "DeFi"
];

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function clearOverlays(page: Page) {
  try {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  } catch {}
}

async function safeClick(locator: Locator) {
  try {
    await locator.click({ timeout: 5000 });
    return true;
  } catch {
    try {
      await locator.click({ timeout: 5000, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function backendHealth() {
  if (!FASTAPI_URL) throw new Error("FASTAPI_URL missing");
  const r = await axios.get(`${FASTAPI_URL}/health`, { timeout: 10000 });
  if (!r.data?.ok) throw new Error("Backend health check failed");
  console.log("Backend alive.");
}

async function generateReply(tweetText: string, author: string, previous: any[]) {
  const r = await axios.post(`${FASTAPI_URL}/api/reading/reply`, {
    tweet: tweetText,
    author,
    previous_interactions: previous
  }, { timeout: 30000 });
  return String(r.data?.reply || "").trim();
}

async function generateMarketPost() {
  const r = await axios.post(`${FASTAPI_URL}/api/reading/market_cycle`, {}, { timeout: 30000 });
  return String(r.data?.post || "").trim();
}

async function validateSession(page: Page) {
  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  if (body.includes("log in") || body.includes("sign in")) {
    throw new Error("X session is not authenticated.");
  }
  console.log(`X session valid: @${XOSHI_HANDLE}`);
}

async function findTweetCards(page: Page): Promise<Array<{ id: string; author: string; text: string }>> {
  const cards = await page.locator('article[data-testid="tweet"]').all();
  const out: Array<{ id: string; author: string; text: string }> = [];

  for (const card of cards.slice(0, 15)) {
    try {
      const link = card.locator('a[href*="/status/"]').first();
      const href = await link.getAttribute("href");
      const m = href?.match(/\/status\/(\d+)/);
      if (!m) continue;

      const text = (await card.innerText()).replace(/\s+/g, " ").trim();
      const authorLink = card.locator('a[href^="/"][role="link"]').first();
      const authorHref = await authorLink.getAttribute("href").catch(() => null);
      const author = authorHref?.replace("/", "") || "";

      out.push({ id: m[1], author, text });
    } catch {}
  }
  return out;
}

async function postReply(page: Page, tweetId: string, reply: string): Promise<boolean> {
  console.log(`Opening tweet ${tweetId}...`);
  await page.goto(`https://x.com/i/status/${tweetId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);
  await clearOverlays(page);

  const replyButton = page.locator('[data-testid="reply"]').first();
  if (!(await safeClick(replyButton))) {
    console.log("Reply button not clickable.");
    return false;
  }

  await page.waitForTimeout(700);

  const box = page.locator('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]').first();
  if (!(await box.count())) return false;

  await box.fill(reply);
  await page.waitForTimeout(300);

  const send = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').first();
  if (await safeClick(send)) {
    await page.waitForTimeout(900);
    console.log("Reply sent.");
    return true;
  }

  await page.keyboard.press("Control+Enter").catch(() => {});
  await page.waitForTimeout(900);
  console.log("Reply sent via keyboard fallback.");
  return true;
}

async function processMentions(page: Page, memory: any) {
  console.log("--- DIRECT MENTIONS ---");
  await page.goto(`https://x.com/${XOSHI_HANDLE}/with_replies`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);

  const candidates = await findTweetCards(page);
  console.log(`Mention candidates: ${candidates.length}`);
  let replied = 0;
  const cycleSeen = new Set<string>();

  for (const item of candidates) {
    if (cycleSeen.has(item.id)) continue;
    cycleSeen.add(item.id);

    if (alreadyProcessed(memory, item.id)) {
      console.log(`Skip already processed tweet: ${item.id}`);
      continue;
    }
    if (!item.text.includes(`@${XOSHI_HANDLE}`) && !item.text.toLowerCase().includes(`@${XOSHI_HANDLE.toLowerCase()}`)) {
      continue;
    }
    if (item.author.toLowerCase() === XOSHI_HANDLE.toLowerCase()) continue;
    if (textAlreadyHandled(memory, item.text)) {
      console.log(`Skip repeated tweet text: ${item.id}`);
      continue;
    }

    console.log(`Mention @${item.author}: ${item.text.slice(0, 220)}`);
    const context = authorContext(memory, item.author);
    const reply = await generateReply(item.text, item.author, context);
    if (!reply) continue;

    const ok = await postReply(page, item.id, reply);
    if (ok) {
      markProcessed(memory, {
        tweetId: item.id,
        author: item.author,
        text: item.text,
        reply
      });
      replied++;
      await sleep(1200);
    }
  }

  console.log(`Mention replies: ${replied}`);
}

async function processRadar(page: Page, memory: any) {
  console.log("--- MARKET / CRYPTO RADAR ---");
  let replies = 0;

  for (const query of RADAR_QUERIES) {
    console.log(`Search: ${query}`);
    const url = `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1500);

    const candidates = await findTweetCards(page);
    console.log(`Tweets extracted: ${candidates.length}`);

    for (const item of candidates.slice(0, 5)) {
      if (item.author.toLowerCase() === XOSHI_HANDLE.toLowerCase()) continue;
      if (alreadyProcessed(memory, item.id) || memory.radarSeenTweets[item.id]) continue;

      markRadarSeen(memory, item.id);

      // Radar is deliberately conservative: only reply to a small number of
      // strong candidates per cycle, and never twice to the same tweet.
      const context = authorContext(memory, item.author);
      const reply = await generateReply(item.text, item.author, context);
      if (!reply) continue;

      const ok = await postReply(page, item.id, reply);
      if (ok) {
        markProcessed(memory, {
          tweetId: item.id,
          author: item.author,
          text: item.text,
          reply,
          topic: query
        });
        replies++;
        await sleep(1500);
      }
      if (replies >= 3) return replies;
    }
  }

  return replies;
}

async function postDaily(page: Page, memory: any) {
  const last = memory.lastDailyPost ? Date.parse(memory.lastDailyPost) : 0;
  if (Date.now() - last < 20 * 60 * 60 * 1000) {
    console.log("Daily post cooldown active.");
    return;
  }

  const post = await generateMarketPost();
  if (!post) return;

  console.log(`Daily post candidate: ${post}`);
  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1200);

  const box = page.locator('[data-testid="tweetTextarea_0"], [role="textbox"][contenteditable="true"]').first();
  if (!(await box.count())) {
    console.log("Post composer not found.");
    return;
  }

  await box.fill(post);
  const send = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').first();
  if (await safeClick(send)) {
    memory.lastDailyPost = new Date().toISOString();
    console.log("Daily post sent.");
  } else {
    await page.keyboard.press("Control+Enter").catch(() => {});
    memory.lastDailyPost = new Date().toISOString();
    console.log("Daily post sent via keyboard fallback.");
  }
}

async function main() {
  console.log("========== XOSHI XI / MEMORY EDITION ==========");
  console.log(`FASTAPI_URL: ${FASTAPI_URL ? "SET" : "MISSING"}`);
  console.log(`TWITTER_AUTH_TOKEN: ${process.env.TWITTER_AUTH_TOKEN ? "SET" : "MISSING"}`);
  console.log(`TWITTER_CT0: ${process.env.TWITTER_CT0 ? "SET" : "MISSING"}`);
  console.log(`GIST_ID: ${process.env.GIST_ID ? "SET" : "MISSING"}`);
  console.log(`GIST_TOKEN: ${process.env.GIST_TOKEN ? "SET" : "MISSING"}`);

  await backendHealth();
  const memory = await loadMemory();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: undefined,
    extraHTTPHeaders: {
      authorization: `Bearer ${process.env.TWITTER_AUTH_TOKEN || ""}`
    }
  });

  // X web auth is cookie based. Keep cookies only in process memory; never write a browser profile.
  await context.addCookies([
    { name: "auth_token", value: process.env.TWITTER_AUTH_TOKEN || "", domain: ".x.com", path: "/", httpOnly: true, secure: true },
    { name: "ct0", value: process.env.TWITTER_CT0 || "", domain: ".x.com", path: "/", httpOnly: false, secure: true }
  ]);

  const page = await context.newPage();

  try {
    await validateSession(page);
    await processMentions(page, memory);
    const radar = await processRadar(page, memory);
    console.log(`Radar replies: ${radar}`);
    await postDaily(page, memory);
  } finally {
    await saveMemory(memory);
    await browser.close();
  }

  console.log("Cycle complete.");
}

main().catch(err => {
  console.error("Xoshi cycle failed:", err?.stack || err);
  process.exit(1);
});
