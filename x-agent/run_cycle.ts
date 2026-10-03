import "dotenv/config";
import axios from "axios";
import { chromium, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";

const FASTAPI_URL = process.env.FASTAPI_URL!;
const HANDLE = (process.env.XOSHI_HANDLE || "xoshi_Si").replace(/^@/, "");
const PROFILE = path.resolve(process.env.XOSHI_PROFILE_DIR || "./profiles/xoshi-main");
const AUTH = process.env.TWITTER_AUTH_TOKEN;
const CT0 = process.env.TWITTER_CT0;

type Memory = {
  repliedTweets: string[];
  lastDailyPost?: string;
  lastRun?: string;
};

const DEFAULT_MEMORY: Memory = { repliedTweets: [] };

async function loadMemory(): Promise<Memory> {
  if (!process.env.GIST_ID || !process.env.GIST_TOKEN) return DEFAULT_MEMORY;
  try {
    const r = await axios.get(`https://api.github.com/gists/${process.env.GIST_ID}`, {
      headers: { Authorization: `Bearer ${process.env.GIST_TOKEN}` }
    });
    const file = r.data.files?.["xoshi_memory.json"];
    return file ? JSON.parse(file.content) : DEFAULT_MEMORY;
  } catch { return DEFAULT_MEMORY; }
}

async function saveMemory(memory: Memory) {
  if (!process.env.GIST_ID || !process.env.GIST_TOKEN) return;
  await axios.patch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
    files: { "xoshi_memory.json": { content: JSON.stringify(memory, null, 2) } }
  }, { headers: { Authorization: `Bearer ${process.env.GIST_TOKEN}` } }).catch(() => {});
}

function detectLanguage(text: string): string {
  const t = text.toLowerCase();
  if (/[а-яё]/.test(t)) return "ru";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";
  if (/[\u3040-\u30ff]/.test(t)) return "ja";
  if (/[\uac00-\ud7af]/.test(t)) return "ko";
  if (/\b(el|la|los|las|que|qué|para|como|cómo|una|está|estás|quiero|sobre)\b/.test(t)) return "es";
  if (/\b(le|les|des|une|avec|pour|comment|quoi|est)\b/.test(t)) return "fr";
  if (/\b(der|die|das|und|für|wie|was|ist)\b/.test(t)) return "de";
  if (/\b(o|os|as|para|como|que|uma|sobre|está)\b/.test(t)) return "pt";
  if (/\b(il|lo|gli|per|come|cosa|una|sulla)\b/.test(t)) return "it";
  if (/\b(el|la|els|les|per|com|què|una|sobre)\b/.test(t)) return "ca";
  return "en";
}

async function backend(pathname: string, data: any) {
  return axios.post(`${FASTAPI_URL}${pathname}`, data, { timeout: 30000 });
}

async function loginWithSecrets(context: BrowserContext) {
  if (!AUTH || !CT0) return;
  await context.addCookies([
    { name: "auth_token", value: AUTH, domain: ".x.com", path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    { name: "ct0", value: CT0, domain: ".x.com", path: "/", httpOnly: false, secure: true, sameSite: "Lax" }
  ]);
}

async function findTweetIds(page: Page, query: string, limit: number) {
  await page.goto(`https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
    { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2500);
  return await page.locator('article[data-testid="tweet"]').evaluateAll((articles, lim) => {
    const out: any[] = [];
    for (const article of articles.slice(0, lim as number)) {
      const a = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
      const text = (article.textContent || "").trim();
      if (!a || !text) continue;
      const m = a.href.match(/status\/(\d+)/);
      if (m) out.push({ id: m[1], text, href: a.href });
    }
    return out;
  }, limit);
}

async function replyTo(page: Page, url: string, reply: string) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1800);
  const replyButton = page.locator('[data-testid="reply"]').first();
  if (await replyButton.count()) await replyButton.click();
  await page.waitForTimeout(800);
  const box = page.locator('[data-testid="tweetTextarea_0"]').first();
  if (!await box.count()) return false;
  await box.fill(reply);
  const send = page.locator('[data-testid="tweetButton"]').first();
  if (!await send.count()) return false;
  await send.click();
  await page.waitForTimeout(1200);
  return true;
}

async function post(page: Page, text: string) {
  await page.goto("https://x.com/compose/post", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const box = page.locator('[data-testid="tweetTextarea_0"]').first();
  if (!await box.count()) return false;
  await box.fill(text.slice(0, 280));
  const send = page.locator('[data-testid="tweetButton"]').first();
  if (!await send.count()) return false;
  await send.click();
  await page.waitForTimeout(1200);
  return true;
}

async function main() {
  if (!FASTAPI_URL) throw new Error("FASTAPI_URL is required");
  fs.mkdirSync(PROFILE, { recursive: true });

  const memory = await loadMemory();
  memory.lastRun = new Date().toISOString();

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1440, height: 900 }
  });

  try {
    await loginWithSecrets(context);
    const page = await context.newPage();
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 30000 });

    // Direct mentions: highest priority.
    const mentions = await findTweetIds(page, `@${HANDLE}`, 8);
    for (const tweet of mentions) {
      if (memory.repliedTweets.includes(tweet.id)) continue;
      const language = detectLanguage(tweet.text);
      const analysis = await backend("/api/intelligence/mention", {
        author: HANDLE,
        text: tweet.text,
        detected_language: language
      }).then(r => r.data).catch(() => null);

      if (analysis?.reply) {
        const ok = await replyTo(page, tweet.href, analysis.reply);
        if (ok) memory.repliedTweets.push(tweet.id);
      }
    }

    // Hourly proactive radar.
    const queries = [
      "$XOSHI",
      "\"Stock Tokens\"",
      "\"tokenized stocks\"",
      "\"Robinhood Chain\"",
      "RWA AI agents",
      "onchain finance AI agents",
      "crypto AI agents"
    ];

    let actions = 0;
    for (const query of queries) {
      if (actions >= 2) break;
      const tweets = await findTweetIds(page, query, 5);
      for (const tweet of tweets) {
        if (actions >= 2 || memory.repliedTweets.includes(tweet.id)) continue;
        const language = detectLanguage(tweet.text);
        const result = await backend("/api/intelligence/analyze", {
          author: "unknown",
          text: tweet.text,
          engagement: {},
          previous_interactions: memory.repliedTweets.slice(-20),
          detected_language: language
        }).then(r => r.data).catch(() => null);

        if (result?.decision === "REPLY" && Number(result.confidence || 0) >= 0.68 && result.reply) {
          const ok = await replyTo(page, tweet.href, result.reply);
          if (ok) {
            memory.repliedTweets.push(tweet.id);
            actions++;
          }
        }
      }
    }

    // Daily post: the workflow runs hourly, but posting remains ~12h apart.
    const last = memory.lastDailyPost ? Date.parse(memory.lastDailyPost) : 0;
    if (Date.now() - last >= 12 * 60 * 60 * 1000) {
      const postData = await backend("/api/reading/daily", { language: "en" })
        .then(r => r.data).catch(() => null);
      if (postData?.text && await post(page, postData.text)) {
        memory.lastDailyPost = new Date().toISOString();
      }
    }

    memory.repliedTweets = memory.repliedTweets.slice(-500);
    await saveMemory(memory);
  } finally {
    await context.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
