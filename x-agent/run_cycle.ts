/**
 * Xoshi XI — Sibili-style autonomous X cycle
 *
 * Playwright + auth_token/ct0
 * Robust X interaction layer:
 * - Direct mentions
 * - Market / crypto radar
 * - Replies
 * - Daily posts
 * - Multi-selector fallbacks
 * - Overlay/dialog handling
 * - Radar diagnostics
 */

import { chromium, BrowserContext, Page, Locator } from "playwright";
import axios from "axios";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { loadMemory, saveMemoryRemote, XoshiMemory } from "./gist_memory";

dotenv.config();

const FASTAPI_URL =
  process.env.FASTAPI_URL || "http://127.0.0.1:8081";

const HANDLE = (process.env.XOSHI_HANDLE || "xoshi_Si").replace(
  /^@/,
  ""
);

const EXCLUDE_HANDLE = HANDLE.toLowerCase();

const BACKEND_TIMEOUT = 90000;

const MAX_MENTION_REPLIES = 5;
const MAX_RADAR_REPLIES = 4;

const POST_INTERVAL = 12 * 60 * 60 * 1000;


// ============================================================
// BACKEND
// ============================================================

async function wakeUpBackend(): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await axios.get(`${FASTAPI_URL}/health`, {
        timeout: 15000,
      });

      if (r.status === 200) {
        console.log(
          `Backend alive: ${JSON.stringify(r.data)}`
        );
        return true;
      }
    } catch (e: any) {
      console.log(
        `Backend attempt ${i + 1}/5 failed: ${e.message}`
      );

      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  return false;
}


async function backend(
  pathname: string,
  data: any
) {
  return axios.post(
    `${FASTAPI_URL}${pathname}`,
    data,
    {
      timeout: BACKEND_TIMEOUT,
    }
  );
}


// ============================================================
// LANGUAGE
// ============================================================

function detectLanguage(text: string): string {
  const t = text.toLowerCase();

  if (/[а-яё]/.test(t)) return "ru";
  if (/[\u4e00-\u9fff]/.test(t)) return "zh";
  if (/[\u3040-\u30ff]/.test(t)) return "ja";

  if (
    /\b(el|la|los|las|que|qué|para|como|cómo|una|está|estás|quiero|sobre)\b/.test(
      t
    )
  )
    return "es";

  if (
    /\b(le|les|des|une|avec|pour|comment|quoi|est)\b/.test(
      t
    )
  )
    return "fr";

  if (
    /\b(der|die|das|und|für|wie|was|ist)\b/.test(t)
  )
    return "de";

  if (
    /\b(o|os|as|para|como|que|uma|sobre|está)\b/.test(t)
  )
    return "pt";

  if (
    /\b(il|lo|gli|per|come|cosa|una|sulla)\b/.test(t)
  )
    return "it";

  if (
    /\b(els|les|per|com|què|una|sobre)\b/.test(t)
  )
    return "ca";

  return "en";
}


// ============================================================
// BROWSER
// ============================================================

async function createContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",

    viewport: {
      width: 1280,
      height: 900,
    },

    locale: "en-US",

    timezoneId: "Europe/Madrid",
  });

  const auth = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;

  if (!auth || !ct0) {
    throw new Error(
      "TWITTER_AUTH_TOKEN and TWITTER_CT0 are required"
    );
  }

  await context.addCookies([
    {
      name: "auth_token",
      value: auth,
      domain: ".x.com",
      path: "/",
      secure: true,
      httpOnly: true,
    },

    {
      name: "ct0",
      value: ct0,
      domain: ".x.com",
      path: "/",
      secure: true,
      httpOnly: false,
    },

    {
      name: "auth_token",
      value: auth,
      domain: ".twitter.com",
      path: "/",
      secure: true,
      httpOnly: true,
    },

    {
      name: "ct0",
      value: ct0,
      domain: ".twitter.com",
      path: "/",
      secure: true,
      httpOnly: false,
    },
  ]);

  return context;
}


// ============================================================
// X SESSION
// ============================================================

async function isLoggedIn(
  page: Page
): Promise<boolean> {
  try {
    await page.goto("https://x.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForTimeout(5000);

    const url = page.url();

    if (
      /\/login|\/flow\/login|\/account\/access/i.test(
        url
      )
    ) {
      return false;
    }

    const body = await page
      .locator("body")
      .innerText()
      .catch(() => "");

    return !/sign in|log in/i.test(
      body.slice(0, 1200)
    );
  } catch (e: any) {
    console.log(
      `Session check failed: ${e.message}`
    );

    return false;
  }
}


// ============================================================
// OVERLAY HANDLER
// ============================================================

async function clearOverlays(page: Page) {
  console.log("   Checking X overlays...");

  // Escape first.
  await page.keyboard.press("Escape").catch(() => {});

  await page.waitForTimeout(300);

  // Try common close buttons.
  const closeSelectors = [
    '[data-testid="app-bar-close"]',
    '[data-testid="close"]',
    '[aria-label="Close"]',
    '[aria-label="Dismiss"]',
    'button[aria-label="Close"]',
    'div[role="dialog"] button[aria-label="Close"]',
  ];

  for (const selector of closeSelectors) {
    try {
      const locator = page.locator(selector);

      const count = await locator.count();

      if (count > 0) {
        for (
          let i = 0;
          i < Math.min(count, 3);
          i++
        ) {
          try {
            await locator
              .nth(i)
              .click({
                timeout: 1500,
                force: true,
              });

            await page.waitForTimeout(300);
          } catch {}
        }
      }
    } catch {}
  }

  // Escape again.
  await page.keyboard.press("Escape").catch(() => {});

  await page.waitForTimeout(300);
}


// ============================================================
// GENERIC CLICK
// ============================================================

async function safeClick(
  locator: Locator,
  page: Page,
  label: string
): Promise<boolean> {

  try {
    await locator.scrollIntoViewIfNeeded({
      timeout: 3000,
    });
  } catch {}

  try {
    await locator.click({
      timeout: 3000,
    });

    return true;
  } catch (e: any) {
    console.log(
      `   Normal click failed (${label})`
    );
  }

  // Clear overlays.
  await clearOverlays(page);

  try {
    await locator.click({
      timeout: 3000,
      force: true,
    });

    return true;
  } catch {
    console.log(
      `   Force click failed (${label})`
    );
  }

  // Last resort: DOM click.
  try {
    await locator.evaluate(
      (el: any) => el.click()
    );

    return true;
  } catch {
    console.log(
      `   DOM click failed (${label})`
    );
  }

  return false;
}


// ============================================================
// TWEET EXTRACTION
// ============================================================

async function extractTweets(
  page: Page,
  limit: number
) {
  const selectors = [
    'article[data-testid="tweet"]',
    'article',
    '[data-testid="tweet"]',
    'div[role="article"]',
  ];

  let articles: Locator | null = null;

  for (const selector of selectors) {
    const candidate = page.locator(selector);

    const count = await candidate.count();

    if (count > 0) {
      articles = candidate;
      break;
    }
  }

  if (!articles) {
    console.log(
      "   Radar/mentions: 0 tweet containers found."
    );

    return [];
  }

  const count = await articles.count();

  console.log(
    `   Tweet containers found: ${count}`
  );

  const out: any[] = [];

  for (
    let i = 0;
    i < Math.min(count, limit);
    i++
  ) {
    const tweet = articles.nth(i);

    try {
      const text =
        (
          await tweet
            .locator(
              'div[data-testid="tweetText"]'
            )
            .first()
            .textContent()
        )?.trim() || "";

      const time =
        tweet.locator("time").first();

      const href =
        await time
          .locator("..")
          .getAttribute("href")
          .catch(() => null);

      const id =
        href?.match(
          /\/status\/(\d+)/
        )?.[1];

      if (!id || !text) continue;

      let author = "";

      const authorCandidates = [
        'div[data-testid="User-Name"]',
        'div[dir="ltr"]',
        'a[href^="/"]',
      ];

      for (
        const selector of authorCandidates
      ) {
        try {
          const candidate =
            tweet.locator(selector).first();

          const value =
            (
              await candidate.textContent()
            )?.trim() || "";

          const match =
            value.match(/@([A-Za-z0-9_]+)/);

          if (match) {
            author = match[1];
            break;
          }
        } catch {}
      }

      out.push({
        id,
        text,
        author,
        tweet,
      });
    } catch {}
  }

  return out;
}


// ============================================================
// REPLY
// ============================================================

async function postReply(
  page: Page,
  tweet: any,
  reply: string
): Promise<boolean> {

  try {
    console.log(
      `   Replying to tweet ${tweet.id}...`
    );

    await clearOverlays(page);

    const replyButton =
      tweet.tweet
        .locator(
          '[data-testid="reply"], [aria-label*="Reply"]'
        )
        .first();

    if (
      !(await safeClick(
        replyButton,
        page,
        "reply button"
      ))
    ) {
      return false;
    }

    await page.waitForTimeout(1200);

    await clearOverlays(page);

    const boxSelectors = [
      '[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"]',
      '[contenteditable="true"]',
    ];

    let box: Locator | null = null;

    for (const selector of boxSelectors) {
      const candidate =
        page.locator(selector).last();

      if (
        await candidate.count() &&
        await candidate.isVisible().catch(() => false)
      ) {
        box = candidate;
        break;
      }
    }

    if (!box) {
      console.log(
        "   Reply composer not found."
      );

      return false;
    }

    await box.click({
      timeout: 5000,
      force: true,
    });

    await box.pressSequentially(
      reply.slice(0, 280),
      {
        delay: 18,
      }
    );

    await page.waitForTimeout(700);

    const buttonSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      'button[data-testid="tweetButtonInline"]',
      'div[role="button"][data-testid="tweetButtonInline"]',
    ];

    let sendButton: Locator | null = null;

    for (
      const selector of buttonSelectors
    ) {
      const candidate =
        page.locator(selector).last();

      if (
        await candidate.count() &&
        await candidate.isVisible().catch(() => false)
      ) {
        sendButton = candidate;
        break;
      }
    }

    if (!sendButton) {
      console.log(
        "   Reply send button not found."
      );

      return false;
    }

    if (
      !(await safeClick(
        sendButton,
        page,
        "reply send button"
      ))
    ) {
      return false;
    }

    await page.waitForTimeout(2500);

    console.log("   Reply sent.");

    return true;

  } catch (e: any) {
    console.log(
      `Reply failed for ${tweet.id}: ${e.message}`
    );

    await page.keyboard.press("Escape").catch(
      () => {}
    );

    return false;
  }
}


// ============================================================
// POST
// ============================================================

async function postTweet(
  page: Page,
  text: string
): Promise<boolean> {

  try {
    console.log("Creating X post...");

    await page.goto(
      "https://x.com/home",
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }
    );

    await page.waitForTimeout(3500);

    await clearOverlays(page);

    const composeSelectors = [
      '[data-testid="SideNav_NewTweet_Button"]',
      'a[href="/compose/post"]',
      'a[href*="/compose/post"]',
    ];

    let compose: Locator | null = null;

    for (
      const selector of composeSelectors
    ) {
      const candidate =
        page.locator(selector).first();

      if (
        await candidate.count() &&
        await candidate.isVisible().catch(() => false)
      ) {
        compose = candidate;
        break;
      }
    }

    if (compose) {
      await safeClick(
        compose,
        page,
        "compose button"
      );
    } else {
      console.log(
        "Compose button not found, using keyboard shortcut."
      );

      await page.keyboard.press("n");
    }

    await page.waitForTimeout(1500);

    const boxSelectors = [
      '[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[role="textbox"]',
      '[contenteditable="true"]',
    ];

    let box: Locator | null = null;

    for (
      const selector of boxSelectors
    ) {
      const candidates =
        page.locator(selector);

      const count =
        await candidates.count();

      for (
        let i = count - 1;
        i >= 0;
        i--
      ) {
        const candidate =
          candidates.nth(i);

        if (
          await candidate.isVisible().catch(
            () => false
          )
        ) {
          box = candidate;
          break;
        }
      }

      if (box) break;
    }

    if (!box) {
      console.log(
        "Post composer not found."
      );

      return false;
    }

    await box.click({
      timeout: 5000,
      force: true,
    });

    await box.pressSequentially(
      text.slice(0, 280),
      {
        delay: 18,
      }
    );

    await page.waitForTimeout(700);

    const postSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      'button[data-testid="tweetButtonInline"]',
    ];

    let postButton: Locator | null = null;

    for (
      const selector of postSelectors
    ) {
      const candidate =
        page.locator(selector).last();

      if (
        await candidate.count() &&
        await candidate.isVisible().catch(
          () => false
        )
      ) {
        postButton = candidate;
        break;
      }
    }

    if (!postButton) {
      console.log(
        "Post button not found."
      );

      return false;
    }

    if (
      !(await safeClick(
        postButton,
        page,
        "post button"
      ))
    ) {
      return false;
    }

    await page.waitForTimeout(3500);

    console.log("XOSHI DAILY POSTED");

    return true;

  } catch (e: any) {
    console.log(
      `Post failed: ${e.message}`
    );

    await page.keyboard.press("Escape").catch(
      () => {}
    );

    return false;
  }
}


// ============================================================
// DIRECT MENTIONS
// ============================================================

async function scrapeMentionsAndReply(
  page: Page,
  memory: XoshiMemory
) {

  console.log(
    "--- DIRECT MENTIONS ---"
  );

  await page.goto(
    "https://x.com/notifications/mentions",
    {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    }
  );

  await page.waitForTimeout(5000);

  const tweets =
    await extractTweets(page, 15);

  console.log(
    `Mention candidates: ${tweets.length}`
  );

  let replied = 0;

  for (const tweet of tweets) {

    if (
      replied >= MAX_MENTION_REPLIES ||
      memory.repliedTweets.includes(tweet.id)
    ) {
      continue;
    }

    if (
      !tweet.author ||
      tweet.author.toLowerCase() ===
        EXCLUDE_HANDLE
    ) {
      continue;
    }

    const result =
      await backend(
        "/api/intelligence/mention",
        {
          author: tweet.author,
          text: tweet.text,
          detected_language:
            detectLanguage(tweet.text),
        }
      )
        .then((r) => r.data)
        .catch(() => null);

    if (!result?.reply) continue;

    console.log(
      `Mention @${tweet.author}: ${tweet.text.slice(
        0,
        120
      )}`
    );

    if (
      await postReply(
        page,
        tweet,
        result.reply
      )
    ) {
      memory.repliedTweets.push(
        tweet.id
      );

      replied++;
    }
  }

  console.log(
    `Mention replies: ${replied}`
  );
}


// ============================================================
// MARKET / CRYPTO RADAR
// ============================================================

async function scrapeSearchAndReply(
  page: Page,
  memory: XoshiMemory
) {

  console.log(
    "--- MARKET / CRYPTO RADAR ---"
  );

  const queries = [
    "$XOSHI",
    '"Stock Tokens"',
    '"tokenized stocks"',
    '"Robinhood Chain"',
    '"RWA" "AI agents"',
    'DeFi "AI agents"',
    '"onchain finance" "AI agents"',
  ];

  let replied = 0;

  for (const query of queries) {

    if (
      replied >= MAX_RADAR_REPLIES
    ) {
      break;
    }

    console.log(
      `Search: ${query}`
    );

    try {

      await page.goto(
        `https://x.com/search?q=${encodeURIComponent(
          query
        )}&src=typed_query&f=live`,
        {
          waitUntil:
            "domcontentloaded",
          timeout: 30000,
        }
      );

      await page.waitForTimeout(4500);

      const tweets =
        await extractTweets(page, 10);

      console.log(
        `   ${query} -> ${tweets.length} tweets extracted`
      );

      if (tweets.length === 0) {
        continue;
      }

      for (const tweet of tweets) {

        if (
          replied >=
            MAX_RADAR_REPLIES ||
          memory.repliedTweets.includes(
            tweet.id
          )
        ) {
          continue;
        }

        if (
          !tweet.author ||
          tweet.author.toLowerCase() ===
            EXCLUDE_HANDLE
        ) {
          continue;
        }

        const result =
          await backend(
            "/api/intelligence/analyze",
            {
              author: tweet.author,
              text: tweet.text,
              engagement: {},
              previous_interactions:
                memory.repliedTweets.slice(
                  -20
                ),
              detected_language:
                detectLanguage(
                  tweet.text
                ),
            }
          )
            .then((r) => r.data)
            .catch(() => null);

        if (
          result?.decision !==
            "REPLY" ||
          Number(
            result.confidence || 0
          ) < 0.60 ||
          !result.reply
        ) {
          continue;
        }

        console.log(
          `Radar @${tweet.author}: ${tweet.text.slice(
            0,
            120
          )}`
        );

        if (
          await postReply(
            page,
            tweet,
            result.reply
          )
        ) {
          memory.repliedTweets.push(
            tweet.id
          );

          replied++;
        }
      }

    } catch (e: any) {

      console.log(
        `Search failed: ${e.message}`
      );
    }
  }

  console.log(
    `Radar replies: ${replied}`
  );
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  console.log(
    "========== XOSHI XI / SIBILI-STYLE CYCLE =========="
  );

  const memory =
    await loadMemory();

  const alive =
    await wakeUpBackend();

  if (!alive) {
    console.log(
      "Backend unavailable."
    );

    return;
  }

  const context =
    await createContext();

  const page =
    await context.newPage();

  try {

    if (
      !(await isLoggedIn(page))
    ) {
      throw new Error(
        "X session is not authenticated"
      );
    }

    console.log(
      `X session valid: @${HANDLE}`
    );

    // --------------------------------------------------------
    // 1. DIRECT MENTIONS
    // --------------------------------------------------------

    await scrapeMentionsAndReply(
      page,
      memory
    );

    // --------------------------------------------------------
    // 2. MARKET RADAR
    // --------------------------------------------------------

    await scrapeSearchAndReply(
      page,
      memory
    );

    // --------------------------------------------------------
    // 3. DAILY POST
    // --------------------------------------------------------

    const now = Date.now();

    const since =
      memory.lastDailyPostTime
        ? now -
          memory.lastDailyPostTime
        : Infinity;

    if (
      since >= POST_INTERVAL
    ) {

      const daily =
        await backend(
          "/api/reading/daily",
          {
            language: "en",
          }
        )
          .then((r) => r.data)
          .catch(() => null);

      if (
        daily?.text
      ) {

        if (
          await postTweet(
            page,
            daily.text
          )
        ) {

          memory.lastDailyPostTime =
            now;

          memory.postedTexts = [
            ...(memory.postedTexts ||
              []),
            {
              text: daily.text,
              time: now,
            },
          ].slice(-20);
        }
      }

    } else {

      console.log(
        `Daily post not due for ${Math.ceil(
          (POST_INTERVAL - since) /
            60000
        )}m`
      );
    }

    memory.repliedTweets =
      memory.repliedTweets.slice(
        -500
      );

  } finally {

    await context
      .browser()
      ?.close();
  }

  await saveMemoryRemote(
    memory
  );

  console.log(
    "Cycle complete."
  );
}


// ============================================================
// START
// ============================================================

main().catch((e) => {
  console.error(
    "Fatal:",
    e
  );

  process.exit(1);
});
