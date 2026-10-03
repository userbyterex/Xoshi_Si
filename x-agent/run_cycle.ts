import { chromium, Page, BrowserContext } from "playwright";
import axios from "axios";
import * as dotenv from "dotenv";
import { loadMemory, saveMemoryRemote } from "./gist_memory";

dotenv.config();

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8080";
const HANDLE = (process.env.XOSHI_HANDLE || "xoshi").toLowerCase();
const EXCLUDE = HANDLE.replace("@", "");

const SEARCH_QUERIES = [
  '("AI agents" OR "AI agent" OR agentic) -filter:replies -filter:links',
  '("onchain" OR "on-chain" OR DeFi OR RWA) -filter:replies -filter:links',
  '("stablecoin" OR "tokenized" OR "autonomous finance") -filter:replies -filter:links',
  '("Bitcoin" OR "Ethereum" OR crypto) ("agent" OR "AI") -filter:replies',
];

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function wakeBackend() {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await axios.get(`${FASTAPI_URL}/health`, { timeout: 10000 });
      if (r.status === 200) return true;
    } catch {}
    await delay(3000);
  }
  return false;
}

async function createContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const auth = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;

  if (auth && ct0) {
    await context.addCookies([
      { name: "auth_token", value: auth, domain: ".x.com", path: "/", secure: true, httpOnly: true },
      { name: "ct0", value: ct0, domain: ".x.com", path: "/", secure: true, httpOnly: false },
    ]);
  }
  return context;
}

async function loggedIn(page: Page) {
  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 });
    await delay(3000);
    return !page.url().includes("/login") && !page.url().includes("/flow/login");
  } catch {
    return false;
  }
}

function parseEngagement(text: string): number {
  const m = text.match(/([0-9,.]+)\s*([KM])?/i);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if ((m[2] || "").toUpperCase() === "K") n *= 1000;
  if ((m[2] || "").toUpperCase() === "M") n *= 1000000;
  return Math.round(n);
}

async function analyze(handle: string, text: string, engagement: number, memory: any) {
  const r = await axios.post(`${FASTAPI_URL}/api/intelligence/analyze`, {
    user_handle: handle,
    text,
    engagement,
    context: {
      previous_interactions: memory.agents?.[handle]?.interactions || 0,
      agent_type: memory.agents?.[handle]?.author_type || "UNKNOWN"
    }
  }, { timeout: 60000 });
  return r.data;
}

async function replyToTweet(page: Page, tweet: any, reply: string) {
  await tweet.locator('[data-testid="reply"]').first().click({ timeout: 6000 });
  await delay(1200);

  const box = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"]').last();
  await box.waitFor({ state: "visible", timeout: 7000 });
  await box.click();
  await box.pressSequentially(reply.slice(0, 275), { delay: 25 });

  const btn = page.locator('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]').last();
  await btn.waitFor({ state: "visible", timeout: 7000 });
  await btn.click({ force: true });
  await delay(3500);
}


async function directMentionReply(author: string, text: string, memory: MemoryState): Promise<string> {
  try {
    const r = await axios.post(`${FASTAPI_URL}/api/intelligence/mention`, {
      author,
      text,
      handle: XOSHI_HANDLE,
      previous_interactions: memory.repliedTweets.slice(-20)
    }, { timeout: 20000 });
    if (r.data?.reply) return String(r.data.reply).slice(0, 270);
  } catch {}

  // Safe fallback: never ignore a direct mention if the backend is unavailable.
  return `@${author} I'm here 👀 What do you want to know about $XOSHI, Stock Tokens, onchain finance or AI agents?`;
}

async function scanMentions(page: Page, memory: any) {
  await page.goto("https://x.com/notifications/mentions", { waitUntil: "domcontentloaded", timeout: 30000 });
  await delay(3500);

  const tweets = page.locator('article[data-testid="tweet"]');
  const count = await tweets.count();

  for (let i = 0; i < Math.min(count, 6); i++) {
    const tweet = tweets.nth(i);
    const text = (await tweet.locator('[data-testid="tweetText"]').first().textContent().catch(() => "")) || "";
    const href = await tweet.locator("time").first().locator("..").getAttribute("href").catch(() => null);
    const id = href?.match(/status\/(\d+)/)?.[1];
    const author = ((await tweet.locator('div[dir="ltr"]').filter({ hasText: "@" }).first().textContent().catch(() => "")) || "")
      .replace("@", "").trim();

    if (!id || !author || !text || author.toLowerCase() === EXCLUDE) continue;
    if (memory.repliedTweets.includes(id)) continue;

    const result = await analyze(author, text, 0, memory);
    memory.agents[author] ||= { interactions: 0 };
    memory.agents[author].author_type = result.author_type;
    memory.agents[author].interactions++;

    if (["REPLY", "QUESTION"].includes(result.decision) && result.reply) {
      try {
        await replyToTweet(page, tweet, result.reply);
        memory.repliedTweets.push(id);
        console.log(`Mention replied: @${author}`);
      } catch (e: any) {
        console.error("Mention reply failed:", e.message);
      }
    } else {
      memory.repliedTweets.push(id);
    }
  }
}

async function scanRadar(page: Page, memory: any) {
  const query = SEARCH_QUERIES[Math.floor(Math.random() * SEARCH_QUERIES.length)];
  await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
    { waitUntil: "domcontentloaded", timeout: 30000 });
  await delay(4000);

  const tweets = page.locator('article[data-testid="tweet"]');
  const count = await tweets.count();

  let acted = 0;

  for (let i = 0; i < Math.min(count, 8); i++) {
    if (acted >= 2) break;

    const tweet = tweets.nth(i);
    const text = (await tweet.locator('[data-testid="tweetText"]').first().textContent().catch(() => "")) || "";
    const href = await tweet.locator("time").first().locator("..").getAttribute("href").catch(() => null);
    const id = href?.match(/status\/(\d+)/)?.[1];
    const author = ((await tweet.locator('div[dir="ltr"]').filter({ hasText: "@" }).first().textContent().catch(() => "")) || "")
      .replace("@", "").trim();

    if (!id || !author || !text || author.toLowerCase() === EXCLUDE) continue;
    if (memory.repliedTweets.includes(id)) continue;

    const result = await analyze(author, text, 0, memory);
    memory.agents[author] ||= { interactions: 0 };
    memory.agents[author].author_type = result.author_type;

    if (["REPLY", "QUESTION"].includes(result.decision) && result.reply && Number(result.confidence) >= 0.68) {
      try {
        await replyToTweet(page, tweet, result.reply);
        memory.repliedTweets.push(id);
        memory.agents[author].interactions++;
        acted++;
        console.log(`Radar reply: @${author}`);
      } catch (e: any) {
        console.error("Radar reply failed:", e.message);
      }
    } else {
      memory.repliedTweets.push(id);
    }
  }
}

async function postDaily(page: Page, memory: any) {
  const interval = 12 * 60 * 60 * 1000;
  const now = Date.now();
  if (memory.lastDailyPostTime && now - memory.lastDailyPostTime < interval) return;

  const r = await axios.post(`${FASTAPI_URL}/api/reading/daily`, {}, { timeout: 60000 });
  const text = (r.data?.text || "").slice(0, 280);
  if (!text) return;

  await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await delay(2500);

  const compose = page.locator('[data-testid="SideNav_NewTweet_Button"], a[href="/compose/post"]').first();
  if (await compose.isVisible().catch(() => false)) await compose.click();
  else await page.keyboard.press("n");

  await delay(1500);
  const box = page.locator('[data-testid="tweetTextarea_0"], div[role="textbox"]').first();
  await box.waitFor({ state: "visible", timeout: 8000 });
  await box.click();
  await box.pressSequentially(text, { delay: 25 });

  const btn = page.locator('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]').first();
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click({ force: true });
  await delay(4000);

  memory.lastDailyPostTime = now;
  memory.postedTexts ||= [];
  memory.postedTexts.push({ text, time: now });
  memory.postedTexts = memory.postedTexts.slice(-30);
  console.log("Xoshi periodic post published.");
}

async function run() {
  console.log("========== XOSHI XI CYCLE ==========");
  console.log(new Date().toISOString());

  if (!(await wakeBackend())) {
    console.error("Backend unavailable.");
    return;
  }

  if (!process.env.TWITTER_AUTH_TOKEN || !process.env.TWITTER_CT0) {
    console.error("Missing TWITTER_AUTH_TOKEN / TWITTER_CT0.");
    return;
  }

  const memory = await loadMemory();
  memory.repliedTweets ||= [];
  memory.agents ||= {};
  memory.trends ||= {};

  const context = await createContext();
  const page = await context.newPage();

  try {
    if (!(await loggedIn(page))) {
      console.error("X login failed. Check auth_token/ct0.");
      return;
    }

    await scanMentions(page, memory);
    await scanRadar(page, memory);
    await postDaily(page, memory);

    // Bound memory growth.
    memory.repliedTweets = memory.repliedTweets.slice(-500);
    await saveMemoryRemote(memory);
  } finally {
    await context.browser()?.close();
  }

  console.log("Cycle complete.");
}

run().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
