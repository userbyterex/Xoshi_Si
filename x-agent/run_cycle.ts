/**
 * Xoshi XI — Sibili-style autonomous X cycle
 *
 * Playwright + auth_token/ct0 cookies + GitHub Gist memory.
 * Architecture based on the working Oracleofsibili/Sibili approach.
 */

import {
  chromium,
  BrowserContext,
  Page,
  Locator,
} from 'playwright';

import axios from 'axios';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

import {
  loadMemory,
  saveMemoryRemote,
  XoshiMemory,
} from './gist_memory';

dotenv.config();

/* ============================================================
   CONFIG
============================================================ */

const FASTAPI_URL =
  process.env.FASTAPI_URL || 'http://127.0.0.1:8081';

const HANDLE =
  (process.env.XOSHI_HANDLE || 'xoshi_Si').replace(/^@/, '');

const EXCLUDE_HANDLE = HANDLE.toLowerCase();

const BACKEND_TIMEOUT = 90000;

const MAX_MENTION_REPLIES = 5;
const MAX_RADAR_REPLIES = 4;

const POST_INTERVAL = 12 * 60 * 60 * 1000;

/* ============================================================
   BACKEND
============================================================ */

async function wakeUpBackend(): Promise<boolean> {
  for (let i = 0; i < 5; i++) {
    try {
      const response = await axios.get(
        `${FASTAPI_URL}/health`,
        {
          timeout: 15000,
        }
      );

      if (response.status === 200) {
        console.log(
          `Backend alive: ${JSON.stringify(response.data)}`
        );

        return true;
      }
    } catch {
      console.log(
        `Backend attempt ${i + 1}/5 failed`
      );

      await new Promise(resolve =>
        setTimeout(resolve, 3000)
      );
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

/* ============================================================
   PLAYWRIGHT CONTEXT
============================================================ */

async function createContext(): Promise<BrowserContext> {
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

    viewport: {
      width: 1280,
      height: 800,
    },
  });

  const auth = process.env.TWITTER_AUTH_TOKEN;
  const ct0 = process.env.TWITTER_CT0;

  if (!auth || !ct0) {
    throw new Error(
      'TWITTER_AUTH_TOKEN and TWITTER_CT0 are required'
    );
  }

  await context.addCookies([
    {
      name: 'auth_token',
      value: auth,
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: true,
    },

    {
      name: 'ct0',
      value: ct0,
      domain: '.x.com',
      path: '/',
      secure: true,
      httpOnly: false,
    },

    {
      name: 'auth_token',
      value: auth,
      domain: '.twitter.com',
      path: '/',
      secure: true,
      httpOnly: true,
    },

    {
      name: 'ct0',
      value: ct0,
      domain: '.twitter.com',
      path: '/',
      secure: true,
      httpOnly: false,
    },
  ]);

  return context;
}

/* ============================================================
   LOGIN CHECK
============================================================ */

async function isLoggedIn(
  page: Page
): Promise<boolean> {
  try {
    await page.goto(
      'https://x.com/home',
      {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }
    );

    await page.waitForTimeout(5000);

    const url = page.url();

    if (
      /\/login|\/flow\/login|\/account\/access/i.test(url)
    ) {
      return false;
    }

    const body =
      await page
        .locator('body')
        .innerText()
        .catch(() => '');

    return !/sign in|log in/i.test(
      body.slice(0, 1000)
    );

  } catch (error: any) {

    console.log(
      `Session check failed: ${error.message}`
    );

    return false;
  }
}

/* ============================================================
   LANGUAGE DETECTION
============================================================ */

function detectLanguage(
  text: string
): string {

  const t = text.toLowerCase();

  if (/[а-яё]/.test(t)) return 'ru';

  if (/[\u4e00-\u9fff]/.test(t)) return 'zh';

  if (/[\u3040-\u30ff]/.test(t)) return 'ja';

  if (
    /\b(el|la|los|las|que|qué|para|como|cómo|una|está|estás|quiero|sobre)\b/.test(t)
  ) {
    return 'es';
  }

  if (
    /\b(le|les|des|une|avec|pour|comment|quoi|est)\b/.test(t)
  ) {
    return 'fr';
  }

  if (
    /\b(der|die|das|und|für|wie|was|ist)\b/.test(t)
  ) {
    return 'de';
  }

  if (
    /\b(o|os|as|para|como|que|uma|sobre|está)\b/.test(t)
  ) {
    return 'pt';
  }

  if (
    /\b(il|lo|gli|per|come|cosa|una|sulla)\b/.test(t)
  ) {
    return 'it';
  }

  if (
    /\b(els|les|per|com|què|una|sobre)\b/.test(t)
  ) {
    return 'ca';
  }

  return 'en';
}

/* ============================================================
   X OVERLAY HANDLING
============================================================ */

async function clearOverlays(
  page: Page
): Promise<void> {

  /*
   * X frequently leaves dialogs, menus or masks above
   * the underlying page.
   *
   * First attempt: Escape.
   */

  for (let i = 0; i < 2; i++) {

    await page.keyboard
      .press('Escape')
      .catch(() => {});

    await page.waitForTimeout(150);
  }

  /*
   * Only dismiss known X UI elements.
   * Never click arbitrary elements.
   */

  const dismissSelectors = [

    '[data-testid="app-bar-close"]',

    '[data-testid="confirmationSheetCancel"]',

    '[aria-label="Close"]',

    '[aria-label="Dismiss"]',

    '[data-testid="mask"]',

  ];

  for (
    const selector of dismissSelectors
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
        await candidate
          .isVisible()
          .catch(() => false)
      ) {

        await candidate
          .click({
            force: true,
            timeout: 1500,
          })
          .catch(() => {});
      }
    }
  }
}

/* ============================================================
   SAFE CLICK
============================================================ */

async function safeClick(
  locator: Locator,
  page: Page,
  label: string
): Promise<boolean> {

  try {

    await locator
      .scrollIntoViewIfNeeded()
      .catch(() => {});

    await locator.click({
      timeout: 5000,
    });

    return true;

  } catch (firstError: any) {

    console.log(
      `Normal click failed for ${label}: ${firstError.message}`
    );

    await clearOverlays(page);

    /*
     * Second attempt: force click.
     */

    try {

      await locator.click({
        timeout: 5000,
        force: true,
      });

      return true;

    } catch (secondError: any) {

      console.log(
        `Force click failed for ${label}: ${secondError.message}`
      );

      /*
       * Final attempt: DOM click.
       */

      try {

        await locator.evaluate(
          (element: HTMLElement) => {
            element.click();
          }
        );

        return true;

      } catch (thirdError: any) {

        console.log(
          `DOM click failed for ${label}: ${thirdError.message}`
        );

        return false;
      }
    }
  }
}

/* ============================================================
   TWEET EXTRACTION
============================================================ */

async function extractTweets(
  page: Page,
  limit: number
) {

  const articles =
    page.locator(
      'article[data-testid="tweet"]'
    );

  const count =
    await articles.count();

  const output: any[] = [];

  for (
    let i = 0;
    i < Math.min(count, limit);
    i++
  ) {

    const tweet =
      articles.nth(i);

    const text =
      await tweet
        .locator(
          'div[data-testid="tweetText"]'
        )
        .first()
        .textContent()
        .catch(() => '') || '';

    /*
     * X tweet ID.
     *
     * Do not depend on <time>.
     * Search every status link instead.
     */

    let href: string | null = null;

    const links =
      tweet.locator(
        'a[href*="/status/"]'
      );

    const linkCount =
      await links.count();

    for (
      let j = 0;
      j < linkCount;
      j++
    ) {

      const candidate =
        await links
          .nth(j)
          .getAttribute('href')
          .catch(() => null);

      if (
        candidate &&
        /\/status\/\d+/.test(candidate)
      ) {

        href = candidate;

        break;
      }
    }

    const id =
      href?.match(
        /\/status\/(\d+)/
      )?.[1];

    if (!id || !text) {
      continue;
    }

    const authorRaw =
      await tweet
        .locator('div[dir="ltr"]')
        .filter({
          hasText: '@',
        })
        .first()
        .textContent()
        .catch(() => '') || '';

    const author =
      authorRaw
        .replace('@', '')
        .trim()
        .split(/\s/)[0];

    output.push({
      id,
      text,
      author,
      tweet,
    });
  }

  return output;
}

/* ============================================================
   FIND COMPOSER
============================================================ */

async function findComposer(
  page: Page
): Promise<Locator | null> {

  const selectors = [

    '[data-testid="tweetTextarea_0"]',

    'div[role="textbox"][contenteditable="true"]',

    'div[role="textbox"]',

    '[contenteditable="true"]',

  ];

  for (
    const selector of selectors
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
        await candidate
          .isVisible()
          .catch(() => false)
      ) {

        return candidate;
      }
    }
  }

  return null;
}

/* ============================================================
   FIND SEND BUTTON
============================================================ */

async function findSendButton(
  page: Page
): Promise<Locator | null> {

  const selectors = [

    '[data-testid="tweetButtonInline"]',

    '[data-testid="tweetButton"]',

  ];

  for (
    const selector of selectors
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
        await candidate
          .isVisible()
          .catch(() => false)
      ) {

        return candidate;
      }
    }
  }

  /*
   * Text fallback.
   */

  const postButton =
    page
      .locator('div[role="button"]')
      .filter({
        hasText: /^Post$/,
      })
      .last();

  if (
    await postButton
      .isVisible()
      .catch(() => false)
  ) {

    return postButton;
  }

  return null;
}

/* ============================================================
   REPLY
============================================================ */

async function postReply(
  page: Page,
  tweet: any,
  reply: string
): Promise<boolean> {

  try {

    console.log(
      `Opening tweet ${tweet.id}...`
    );

    /*
     * Open the actual tweet page instead of
     * clicking directly from the notification card.
     */

    await page.goto(
      `https://x.com/i/web/status/${tweet.id}`,
      {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }
    );

    await page.waitForTimeout(4000);

    await clearOverlays(page);

    const article =
      page
        .locator(
          'article[data-testid="tweet"]'
        )
        .first();

    if (
      !(await article.count())
    ) {

      console.log(
        'Tweet article not found.'
      );

      return false;
    }

    await article
      .scrollIntoViewIfNeeded()
      .catch(() => {});

    /*
     * Reply button.
     */

    const replySelectors = [

      '[data-testid="reply"]',

      '[aria-label*="Reply"]',

      'button[aria-label*="Reply"]',

    ];

    let replyButton:
      Locator | null = null;

    for (
      const selector of replySelectors
    ) {

      const candidate =
        article
          .locator(selector)
          .first();

      if (
        (await candidate.count()) &&
        await candidate
          .isVisible()
          .catch(() => false)
      ) {

        replyButton =
          candidate;

        break;
      }
    }

    if (!replyButton) {

      console.log(
        'Reply button not found.'
      );

      return false;
    }

    if (
      !(await safeClick(
        replyButton,
        page,
        'reply button'
      ))
    ) {

      return false;
    }

    await page.waitForTimeout(1500);

    /*
     * Do NOT aggressively close overlays here.
     * The reply composer itself is an overlay.
     */

    const box =
      await findComposer(page);

    if (!box) {

      console.log(
        'Reply composer not found.'
      );

      /*
       * Diagnostic information.
       */

      console.log(
        `Current URL: ${page.url()}`
      );

      console.log(
        `Textboxes detected: ${
          await page
            .locator(
              '[data-testid="tweetTextarea_0"], div[role="textbox"], [contenteditable="true"]'
            )
            .count()
        }`
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

    await page.waitForTimeout(1000);

    const sendButton =
      await findSendButton(page);

    if (!sendButton) {

      console.log(
        'Reply send button not found.'
      );

      return false;
    }

    if (
      !(await safeClick(
        sendButton,
        page,
        'reply send button'
      ))
    ) {

      return false;
    }

    await page.waitForTimeout(3000);

    console.log(
      'Reply sent.'
    );

    return true;

  } catch (error: any) {

    console.log(
      `Reply failed for ${tweet.id}: ${error.message}`
    );

    await page.keyboard
      .press('Escape')
      .catch(() => {});

    return false;
  }
}

/* ============================================================
   POST NEW TWEET
============================================================ */

async function postTweet(
  page: Page,
  text: string
): Promise<boolean> {

  try {

    await page.goto(
      'https://x.com/home',
      {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      }
    );

    await page.waitForTimeout(3500);

    await clearOverlays(page);

    /*
     * Find compose button.
     */

    const composeSelectors = [

      '[data-testid="SideNav_NewTweet_Button"]',

      'a[href="/compose/post"]',

    ];

    let compose:
      Locator | null = null;

    for (
      const selector of composeSelectors
    ) {

      const candidate =
        page.locator(selector).first();

      if (
        (await candidate.count()) &&
        await candidate
          .isVisible()
          .catch(() => false)
      ) {

        compose =
          candidate;

        break;
      }
    }

    if (compose) {

      await safeClick(
        compose,
        page,
        'compose button'
      );

    } else {

      console.log(
        'Compose button not found, using keyboard shortcut.'
      );

      await page.keyboard
        .press('n')
        .catch(() => {});
    }

    await page.waitForTimeout(1500);

    const box =
      await findComposer(page);

    if (!box) {

      console.log(
        'Post composer not found.'
      );

      console.log(
        `Current URL: ${page.url()}`
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
        delay: 25,
      }
    );

    await page.waitForTimeout(700);

    const sendButton =
      await findSendButton(page);

    if (!sendButton) {

      console.log(
        'Post send button not found.'
      );

      return false;
    }

    if (
      !(await safeClick(
        sendButton,
        page,
        'post send button'
      ))
    ) {

      return false;
    }

    await page.waitForTimeout(4000);

    console.log(
      'XOSHI DAILY POSTED'
    );

    return true;

  } catch (error: any) {

    console.log(
      `Post failed: ${error.message}`
    );

    return false;
  }
}

/* ============================================================
   DIRECT MENTIONS
============================================================ */

async function scrapeMentionsAndReply(
  page: Page,
  memory: XoshiMemory
) {

  console.log(
    '--- DIRECT MENTIONS ---'
  );

  await page.goto(
    'https://x.com/notifications/mentions',
    {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    }
  );

  await page.waitForTimeout(5000);

  const tweets =
    await extractTweets(
      page,
      10
    );

  console.log(
    `Mention candidates: ${tweets.length}`
  );

  let replied = 0;

  for (
    const tweet of tweets
  ) {

    if (
      replied >= MAX_MENTION_REPLIES ||
      memory.repliedTweets.includes(tweet.id)
    ) {
      continue;
    }

    if (
      !tweet.author ||
      tweet.author.toLowerCase() === EXCLUDE_HANDLE
    ) {
      continue;
    }

    const result =
      await backend(
        '/api/intelligence/mention',
        {
          author: tweet.author,

          text: tweet.text,

          detected_language:
            detectLanguage(tweet.text),
        }
      )
        .then(response => response.data)
        .catch(() => null);

    if (!result?.reply) {
      continue;
    }

    console.log(
      `Mention @${tweet.author}: ${tweet.text.slice(0, 100)}`
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

/* ============================================================
   MARKET / CRYPTO RADAR
============================================================ */

async function scrapeSearchAndReply(
  page: Page,
  memory: XoshiMemory
) {

  console.log(
    '--- MARKET / CRYPTO RADAR ---'
  );

  const queries = [

    '$XOSHI',

    '"Stock Tokens"',

    '"tokenized stocks"',

    '"Robinhood Chain"',

    '"RWA" "AI agents"',

    'DeFi "AI agents"',

    '"onchain finance" "AI agents"',

  ];

  let replied = 0;

  for (
    const query of queries
  ) {

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
        `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
        {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        }
      );

      await page.waitForTimeout(5000);

      const tweets =
        await extractTweets(
          page,
          8
        );

      console.log(
        `   ${query} -> ${tweets.length} tweets extracted`
      );

      for (
        const tweet of tweets
      ) {

        if (
          replied >= MAX_RADAR_REPLIES ||
          memory.repliedTweets.includes(tweet.id)
        ) {
          continue;
        }

        if (
          !tweet.author ||
          tweet.author.toLowerCase() === EXCLUDE_HANDLE
        ) {
          continue;
        }

        const result =
          await backend(
            '/api/intelligence/analyze',
            {
              author:
                tweet.author,

              text:
                tweet.text,

              engagement: {},

              previous_interactions:
                memory.repliedTweets.slice(-20),

              detected_language:
                detectLanguage(tweet.text),
            }
          )
            .then(response => response.data)
            .catch(() => null);

        if (
          result?.decision !== 'REPLY' ||
          Number(result.confidence || 0) < 0.60 ||
          !result.reply
        ) {
          continue;
        }

        console.log(
          `Radar @${tweet.author}: ${tweet.text.slice(0, 100)}`
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

    } catch (error: any) {

      console.log(
        `Search failed: ${error.message}`
      );
    }
  }

  console.log(
    `Radar replies: ${replied}`
  );
}

/* ============================================================
   MAIN
============================================================ */

async function main() {

  console.log(
    '========== XOSHI XI / SIBILI-STYLE CYCLE =========='
  );

  const memory =
    await loadMemory();

  const alive =
    await wakeUpBackend();

  if (!alive) {
    console.log(
      'Backend unavailable. Ending cycle.'
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
        'X session is not authenticated'
      );
    }

    console.log(
      `X session valid: @${HANDLE}`
    );

    /*
     * 1. Direct mentions
     */

    await scrapeMentionsAndReply(
      page,
      memory
    );

    /*
     * 2. Market / crypto radar
     */

    await scrapeSearchAndReply(
      page,
      memory
    );

    /*
     * 3. Scheduled original post
     */

    const now =
      Date.now();

    const since =
      memory.lastDailyPostTime
        ? now - memory.lastDailyPostTime
        : Infinity;

    if (
      since >= POST_INTERVAL
    ) {

      const daily =
        await backend(
          '/api/reading/daily',
          {
            language: 'en',
          }
        )
          .then(response => response.data)
          .catch(() => null);

      if (
        daily?.text
      ) {

        await postTweet(
          page,
          daily.text
        );

        memory.lastDailyPostTime =
          now;

        memory.postedTexts = [
          ...(memory.postedTexts || []),

          {
            text: daily.text,
            time: now,
          },

        ].slice(-20);
      }

    } else {

      console.log(
        `Daily post not due for ${
          Math.ceil(
            (POST_INTERVAL - since) /
            60000
          )
        }m`
      );
    }

    /*
     * Keep memory bounded.
     */

    memory.repliedTweets =
      memory.repliedTweets.slice(-500);

  } finally {

    await context
      .browser()
      ?.close();
  }

  await saveMemoryRemote(
    memory
  );

  console.log(
    'Cycle complete.'
  );
}

/* ============================================================
   START
============================================================ */

main().catch(
  error => {

    console.error(
      'Fatal:',
      error
    );

    process.exit(1);
  }
);
