import { chromium, BrowserContext, Page, Locator } from "playwright";
import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

/*
 * ============================================================
 * XOSHI XI — AUTONOMOUS X AGENT
 * Sibili-style Playwright architecture
 * ============================================================
 *
 * Main responsibilities:
 *  - Authenticate to X using auth_token + ct0
 *  - Detect direct mentions
 *  - Reply to mentions
 *  - Search X for market/radar topics
 *  - Generate replies through FastAPI / Groq / Gemini
 *  - Publish X posts
 *
 * IMPORTANT:
 *  - Credentials are supplied through environment variables.
 *  - Never commit credentials or browser profiles.
 * ============================================================
 */

const FASTAPI_URL =
  process.env.FASTAPI_URL || "http://localhost:8000";

const TWITTER_AUTH_TOKEN =
  process.env.TWITTER_AUTH_TOKEN || "";

const TWITTER_CT0 =
  process.env.TWITTER_CT0 || "";

const XOSHI_HANDLE =
  process.env.XOSHI_HANDLE || "xoshi_Si";

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || "";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY || "";

const GIST_ID =
  process.env.GIST_ID || "";

const GIST_TOKEN =
  process.env.GIST_TOKEN || "";

const X_HOME = "https://x.com/home";

const RADAR_QUERIES = [
  "$XOSHI",
  "\"Stock Tokens\"",
  "\"tokenized stocks\"",
  "\"Robinhood Chain\"",
  "\"RWA\" \"AI agents\"",
  "DeFi \"AI agents\"",
  "\"onchain finance\" \"AI agents\""
];

/*
 * ============================================================
 * GENERIC HELPERS
 * ============================================================
 */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clearOverlays(page: Page): Promise<void> {
  /*
   * X frequently leaves modal/overlay layers in the DOM.
   *
   * We intentionally do NOT blindly delete every element with
   * data-testid="mask", because that mask can belong to the
   * currently active composer.
   *
   * Instead we use Escape first and only attempt to close obvious
   * dialogs that are not the active composer.
   */

  try {
    await page.keyboard.press("Escape");
    await sleep(300);
  } catch {
    // Ignore.
  }

  try {
    const dialogs = page.locator(
      '[role="dialog"]'
    );

    const count = await dialogs.count();

    for (let i = count - 1; i >= 0; i--) {
      const dialog = dialogs.nth(i);

      try {
        if (!(await dialog.isVisible())) {
          continue;
        }

        const hasTextbox =
          (await dialog.locator('[role="textbox"]').count()) > 0 ||
          (await dialog.locator('[contenteditable="true"]').count()) > 0;

        /*
         * Never close a dialog containing a textbox.
         * It may be the tweet composer.
         */
        if (hasTextbox) {
          continue;
        }

        const closeButton = dialog.locator(
          '[aria-label="Close"], ' +
          '[data-testid="app-bar-close"], ' +
          'button[aria-label="Close"]'
        ).first();

        if (await closeButton.count()) {
          await closeButton.click({
            force: true,
            timeout: 1000
          }).catch(() => {});
        }
      } catch {
        // Continue.
      }
    }
  } catch {
    // Ignore overlay cleanup errors.
  }
}

async function safeClick(
  locator: Locator,
  page: Page,
  description: string
): Promise<boolean> {

  try {
    await locator.scrollIntoViewIfNeeded({
      timeout: 3000
    }).catch(() => {});

    await locator.click({
      timeout: 5000
    });

    return true;

  } catch (error) {

    console.log(
      `Normal click failed for ${description}:`,
      error instanceof Error
        ? error.message
        : String(error)
    );

    /*
     * X often has an invisible/transparent mask intercepting
     * pointer events. Force click is therefore a useful fallback.
     */
    try {
      await locator.click({
        force: true,
        timeout: 5000
      });

      console.log(
        `Force click succeeded for ${description}.`
      );

      return true;

    } catch (forceError) {

      console.log(
        `Force click failed for ${description}:`,
        forceError instanceof Error
          ? forceError.message
          : String(forceError)
      );

      /*
       * Final fallback: DOM click.
       */
      try {
        await locator.evaluate(
          (element: HTMLElement) => element.click()
        );

        console.log(
          `DOM click succeeded for ${description}.`
        );

        return true;

      } catch (domError) {

        console.log(
          `DOM click failed for ${description}:`,
          domError instanceof Error
            ? domError.message
            : String(domError)
        );

        return false;
      }
    }
  }
}

/*
 * ============================================================
 * FASTAPI
 * ============================================================
 */

async function backendHealth(): Promise<boolean> {
  try {
    const response = await axios.get(
      `${FASTAPI_URL}/health`,
      {
        timeout: 15000
      }
    );

    console.log(
      `Backend alive: ${JSON.stringify(response.data)}`
    );

    return true;

  } catch (error) {

    console.error(
      "Backend health check failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }
}

/*
 * Ask backend to generate a response.
 *
 * We intentionally keep this flexible because the FastAPI
 * backend may expose different intelligence endpoints.
 */

async function generateReply(
  tweetText: string,
  author: string
): Promise<string> {

  try {

    const response = await axios.post(
      `${FASTAPI_URL}/api/reading/market_cycle`,
      {
        handle: XOSHI_HANDLE,
        author,
        tweet: tweetText,
        language: detectLanguage(tweetText),
        task: "reply"
      },
      {
        timeout: 30000
      }
    );

    const data = response.data;

    if (typeof data === "string") {
      return data.trim();
    }

    if (data?.reply) {
      return String(data.reply).trim();
    }

    if (data?.text) {
      return String(data.text).trim();
    }

    if (data?.content) {
      return String(data.content).trim();
    }

  } catch (error) {

    console.log(
      "Backend reply generation failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }

  /*
   * Conservative fallback.
   */
  return (
    "Tokenized stocks could be one of the more interesting " +
    "bridges between traditional markets and onchain finance. " +
    "The key is whether liquidity, settlement and compliance " +
    "can scale together."
  );
}

/*
 * ============================================================
 * LANGUAGE DETECTION
 * ============================================================
 */

function detectLanguage(text: string): string {

  const lower = text.toLowerCase();

  const scores: Record<string, number> = {
    en: 0,
    es: 0,
    fr: 0,
    de: 0,
    it: 0,
    pt: 0,
    ca: 0
  };

  const patterns: Record<string, string[]> = {

    es: [
      " que ",
      " qué ",
      " los ",
      " las ",
      " una ",
      " una ",
      " esto ",
      " esto",
      "sobre",
      "opinión",
      "opinion",
      "acciones",
      "tokenizadas"
    ],

    fr: [
      " que ",
      " les ",
      " des ",
      " une ",
      " pour ",
      " avec ",
      " actions ",
      " chaîne "
    ],

    de: [
      " der ",
      " die ",
      " das ",
      " und ",
      " ist ",
      " für ",
      " aktien "
    ],

    it: [
      " che ",
      " gli ",
      " una ",
      " per ",
      " con ",
      " azioni "
    ],

    pt: [
      " que ",
      " os ",
      " as ",
      " uma ",
      " para ",
      " com ",
      " ações "
    ],

    ca: [
      " que ",
      " els ",
      " les ",
      " una ",
      " per ",
      " amb ",
      " accions "
    ],

    en: [
      " the ",
      " what ",
      " how ",
      " why ",
      " about ",
      " stocks ",
      " tokens ",
      " agents ",
      " chain "
    ]
  };

  for (const [language, words] of Object.entries(patterns)) {
    for (const word of words) {
      if (lower.includes(word)) {
        scores[language]++;
      }
    }
  }

  let best = "en";
  let bestScore = 0;

  for (const [language, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = language;
      bestScore = score;
    }
  }

  return best;
}

/*
 * ============================================================
 * X AUTHENTICATION
 * ============================================================
 */

async function createContext(): Promise<BrowserContext> {

  if (!TWITTER_AUTH_TOKEN || !TWITTER_CT0) {
    throw new Error(
      "TWITTER_AUTH_TOKEN or TWITTER_CT0 is missing."
    );
  }

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const context = await browser.newContext({
    viewport: {
      width: 1440,
      height: 1000
    },
    locale: "en-US",
    timezoneId: "Europe/Madrid",
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/153.0.0.0 Safari/537.36"
  });

  await context.addCookies([
    {
      name: "auth_token",
      value: TWITTER_AUTH_TOKEN,
      domain: ".x.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax"
    },
    {
      name: "ct0",
      value: TWITTER_CT0,
      domain: ".x.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    }
  ]);

  return context;
}

async function validateSession(
  page: Page
): Promise<boolean> {

  try {

    await page.goto(
      X_HOME,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await sleep(4000);

    const loginButton =
      page.locator(
        'a[href="/login"], ' +
        'a[href="/i/flow/login"]'
      ).first();

    if (await loginButton.count()) {
      if (await loginButton.isVisible().catch(() => false)) {
        console.log("X session invalid.");
        return false;
      }
    }

    console.log(
      `X session valid: @${XOSHI_HANDLE}`
    );

    return true;

  } catch (error) {

    console.error(
      "Session validation failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }
}

/*
 * ============================================================
 * TWEET EXTRACTION
 * ============================================================
 */

async function extractTweets(
  page: Page
): Promise<any[]> {

  const tweets: any[] = [];

  const articles = page.locator(
    'article[data-testid="tweet"]'
  );

  const count = await articles.count();

  for (let i = 0; i < count; i++) {

    try {

      const article = articles.nth(i);

      const text = (
        await article
          .locator('[data-testid="tweetText"]')
          .allTextContents()
      ).join(" ")
        .trim();

      if (!text) {
        continue;
      }

      const links = article.locator(
        'a[href*="/status/"]'
      );

      let id = "";

      const linkCount = await links.count();

      for (let j = 0; j < linkCount; j++) {

        const href =
          await links.nth(j).getAttribute("href");

        if (!href) {
          continue;
        }

        const match =
          href.match(/\/status\/(\d+)/);

        if (match) {
          id = match[1];
          break;
        }
      }

      if (!id) {
        continue;
      }

      let author = "";

      const userLinks = article.locator(
        'a[href^="/"][role="link"]'
      );

      const userCount = await userLinks.count();

      for (let j = 0; j < userCount; j++) {

        const href =
          await userLinks.nth(j).getAttribute("href");

        if (
          href &&
          href.startsWith("/") &&
          !href.includes("/status/")
        ) {
          author = href
            .replace("/", "")
            .split("/")[0];

          if (author) {
            break;
          }
        }
      }

      tweets.push({
        id,
        text,
        author
      });

    } catch {
      // Ignore malformed tweet.
    }
  }

  return tweets;
}

/*
 * ============================================================
 * DIRECT MENTIONS
 * ============================================================
 */

async function getMentionCandidates(
  page: Page
): Promise<any[]> {

  try {

    await page.goto(
      `https://x.com/${XOSHI_HANDLE}/with_replies`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await sleep(4000);

    const tweets =
      await extractTweets(page);

    const mentions =
      tweets.filter(tweet =>
        tweet.text
          .toLowerCase()
          .includes(`@${XOSHI_HANDLE.toLowerCase()}`)
      );

    console.log(
      `Mention candidates: ${mentions.length}`
    );

    return mentions;

  } catch (error) {

    console.log(
      "Mention scan failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return [];
  }
}

/*
 * ============================================================
 * REPLY TO TWEET
 * ============================================================
 */

async function postReply(
  page: Page,
  tweet: any,
  reply: string
): Promise<boolean> {

  try {

    console.log(
      `Opening tweet ${tweet.id}...`
    );

    await page.goto(
      `https://x.com/i/web/status/${tweet.id}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await sleep(4000);

    /*
     * Do not call clearOverlays() immediately here.
     *
     * X can have a mask associated with the reply composer.
     */

    const article =
      page.locator(
        'article[data-testid="tweet"]'
      ).first();

    if (!(await article.count())) {
      console.log(
        "Original tweet article not found."
      );

      return false;
    }

    /*
     * Reply button.
     */
    const replySelectors = [
      '[data-testid="reply"]',
      'button[aria-label*="Reply"]',
      'div[role="button"][aria-label*="Reply"]'
    ];

    let replyButton: Locator | null = null;

    for (const selector of replySelectors) {

      const candidate =
        article.locator(selector).first();

      if (await candidate.count()) {

        try {

          await candidate.waitFor({
            state: "visible",
            timeout: 3000
          });

          replyButton = candidate;
          break;

        } catch {
          // Continue.
        }
      }
    }

    if (!replyButton) {

      console.log(
        "Reply button not found."
      );

      return false;
    }

    if (
      !(await safeClick(
        replyButton,
        page,
        "reply button"
      ))
    ) {

      console.log(
        "Unable to click reply button."
      );

      return false;
    }

    await sleep(1500);

    /*
     * Find reply composer.
     */
    const composerSelectors = [
      '[data-testid="tweetTextarea_0"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"]'
    ];

    let box: Locator | null = null;

    for (const selector of composerSelectors) {

      const candidate =
        page.locator(selector).last();

      if (await candidate.count()) {

        try {

          await candidate.waitFor({
            state: "visible",
            timeout: 5000
          });

          box = candidate;
          break;

        } catch {
          // Continue.
        }
      }
    }

    if (!box) {

      console.log(
        "Reply composer not found."
      );

      return false;
    }

    await box.click({
      force: true
    });

    await page.keyboard.insertText(
      reply
    );

    await sleep(700);

    /*
     * Send reply.
     */
    const sendSelectors = [
      '[data-testid="tweetButtonInline"]',
      '[data-testid="tweetButton"]',
      'button:has-text("Reply")',
      'div[role="button"]:has-text("Reply")'
    ];

    let sendButton: Locator | null = null;

    for (const selector of sendSelectors) {

      const candidate =
        page.locator(selector).last();

      if (await candidate.count()) {

        try {

          await candidate.waitFor({
            state: "visible",
            timeout: 3000
          });

          sendButton = candidate;
          break;

        } catch {
          // Continue.
        }
      }
    }

    if (!sendButton) {

      console.log(
        "Reply send button not found."
      );

      /*
       * Keyboard fallback.
       */
      await page.keyboard.press(
        "Control+Enter"
      ).catch(() => {});

      await sleep(2000);

      console.log("Reply sent.");
      return true;
    }

    const clicked =
      await safeClick(
        sendButton,
        page,
        "reply send button"
      );

    if (!clicked) {

      console.log(
        "Reply button click failed."
      );

      /*
       * Keyboard fallback.
       */
      await page.keyboard.press(
        "Control+Enter"
      ).catch(() => {});

      await sleep(2000);
    }

    console.log("Reply sent.");

    await sleep(2000);

    return true;

  } catch (error) {

    console.error(
      "postReply error:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }
}

/*
 * ============================================================
 * X SEARCH / RADAR
 * ============================================================
 */

async function searchX(
  page: Page,
  query: string
): Promise<any[]> {

  try {

    console.log(
      `Search: ${query}`
    );

    const encoded =
      encodeURIComponent(query);

    await page.goto(
      `https://x.com/search?q=${encoded}&src=typed_query&f=live`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await sleep(4000);

    const tweets =
      await extractTweets(page);

    console.log(
      `   ${query} -> ${tweets.length} tweets extracted`
    );

    return tweets;

  } catch (error) {

    console.log(
      `Search failed for ${query}:`,
      error instanceof Error
        ? error.message
        : String(error)
    );

    return [];
  }
}

async function runRadar(
  page: Page
): Promise<any[]> {

  const results: any[] = [];

  for (const query of RADAR_QUERIES) {

    const tweets =
      await searchX(page, query);

    for (const tweet of tweets) {

      results.push({
        ...tweet,
        query
      });
    }

    /*
     * Small delay between searches.
     */
    await sleep(1000);
  }

  return results;
}

/*
 * ============================================================
 * POST COMPOSER
 * ============================================================
 */

async function postTweet(
  page: Page,
  text: string
): Promise<boolean> {

  try {

    console.log(
      "Creating X post..."
    );

    /*
     * IMPORTANT:
     *
     * Instead of depending on the sidebar compose button or
     * keyboard shortcut "n", navigate directly to the composer.
     */
    console.log(
      "Opening X composer directly..."
    );

    await page.goto(
      "https://x.com/compose/post",
      {
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    await sleep(5000);

    console.log(
      `Current URL: ${page.url()}`
    );

    /*
     * Escape only obvious stale overlays.
     *
     * Do not use clearOverlays() here because the active composer
     * itself may be represented as a dialog.
     */
    await page.keyboard
      .press("Escape")
      .catch(() => {});

    await sleep(500);

    /*
     * Locate composer.
     */
    const composerSelectors = [
      '[data-testid="tweetTextarea_0"]',
      '[data-testid="tweetTextarea_0"] div[contenteditable="true"]',
      'div[role="textbox"][contenteditable="true"]',
      'div[contenteditable="true"][data-contents="true"]',
      'div[contenteditable="true"]'
    ];

    let box: Locator | null = null;

    for (const selector of composerSelectors) {

      const candidate =
        page.locator(selector).first();

      if (!(await candidate.count())) {
        continue;
      }

      try {

        await candidate.waitFor({
          state: "visible",
          timeout: 3000
        });

        box = candidate;

        console.log(
          `Composer found with selector: ${selector}`
        );

        break;

      } catch {
        // Continue.
      }
    }

    if (!box) {

      console.log(
        "Post composer not found."
      );

      console.log(
        `Current URL: ${page.url()}`
      );

      const textboxes =
        await page
          .locator('[role="textbox"]')
          .count()
          .catch(() => 0);

      const editables =
        await page
          .locator('[contenteditable="true"]')
          .count()
          .catch(() => 0);

      console.log(
        `Textbox count: ${textboxes}`
      );

      console.log(
        `Contenteditable count: ${editables}`
      );

      return false;
    }

    /*
     * Focus composer.
     */
    await box.click({
      force: true
    });

    await sleep(300);

    /*
     * Insert text.
     */
    await page.keyboard.insertText(
      text
    );

    await sleep(1000);

    /*
     * Locate Post button.
     */
    const sendSelectors = [
      '[data-testid="tweetButton"]',
      '[data-testid="tweetButtonInline"]',
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")'
    ];

    let sendButton: Locator | null = null;

    for (const selector of sendSelectors) {

      const candidate =
        page.locator(selector).last();

      if (!(await candidate.count())) {
        continue;
      }

      try {

        await candidate.waitFor({
          state: "visible",
          timeout: 3000
        });

        sendButton = candidate;

        console.log(
          `Post button found: ${selector}`
        );

        break;

      } catch {
        // Continue.
      }
    }

    if (!sendButton) {

      console.log(
        "Post button not found."
      );

      /*
       * Last resort.
       */
      console.log(
        "Trying Control+Enter..."
      );

      await page.keyboard
        .press("Control+Enter")
        .catch(() => {});

      await sleep(2500);

      console.log(
        "Post submitted using keyboard fallback."
      );

      return true;
    }

    /*
     * Normal click.
     */
    try {

      await sendButton.click({
        timeout: 5000
      });

      console.log(
        "Post sent."
      );

    } catch (error) {

      console.log(
        "Normal post click failed:"
      );

      console.log(
        error instanceof Error
          ? error.message
          : String(error)
      );

      /*
       * Force click.
       */
      try {

        await sendButton.click({
          force: true,
          timeout: 5000
        });

        console.log(
          "Post sent with force click."
        );

      } catch {

        /*
         * DOM click.
         */
        try {

          await sendButton.evaluate(
            (element: HTMLElement) =>
              element.click()
          );

          console.log(
            "Post sent with DOM click."
          );

        } catch {

          /*
           * Keyboard fallback.
           */
          console.log(
            "Trying Control+Enter..."
          );

          await page.keyboard
            .press("Control+Enter")
            .catch(() => {});

          console.log(
            "Post submitted using keyboard fallback."
          );
        }
      }
    }

    await sleep(3000);

    return true;

  } catch (error) {

    console.error(
      "postTweet error:",
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }
}

/*
 * ============================================================
 * RADAR RESPONSE GENERATION
 * ============================================================
 */

async function generateRadarReply(
  tweet: any
): Promise<string> {

  try {

    const response = await axios.post(
      `${FASTAPI_URL}/api/reading/market_cycle`,
      {
        handle: XOSHI_HANDLE,
        author: tweet.author,
        tweet: tweet.text,
        query: tweet.query,
        language: detectLanguage(tweet.text),
        task: "radar_reply"
      },
      {
        timeout: 30000
      }
    );

    const data = response.data;

    if (typeof data === "string") {
      return data.trim();
    }

    if (data?.reply) {
      return String(data.reply).trim();
    }

    if (data?.text) {
      return String(data.text).trim();
    }

  } catch (error) {

    console.log(
      "Radar AI generation failed:",
      error instanceof Error
        ? error.message
        : String(error)
    );
  }

  return "";
}

/*
 * ============================================================
 * MAIN CYCLE
 * ============================================================
 */

async function main(): Promise<void> {

  console.log(
    "========== XOSHI XI / SIBILI-STYLE CYCLE =========="
  );

  /*
   * Backend.
   */
  const backendOK =
    await backendHealth();

  if (!backendOK) {
    console.log(
      "Backend unavailable. Continuing with X-only operations."
    );
  }

  /*
   * Browser.
   */
  let context: BrowserContext | null = null;

  try {

    context =
      await createContext();

    const pages =
      context.pages();

    const page =
      pages.length > 0
        ? pages[0]
        : await context.newPage();

    /*
     * ========================================================
     * SESSION
     * ========================================================
     */

    const valid =
      await validateSession(page);

    if (!valid) {
      throw new Error(
        "X authentication is invalid."
      );
    }

    /*
     * ========================================================
     * DIRECT MENTIONS
     * ========================================================
     */

    console.log(
      "--- DIRECT MENTIONS ---"
    );

    const mentions =
      await getMentionCandidates(page);

    let mentionReplies = 0;

    for (const tweet of mentions) {

      /*
       * Avoid replying to our own account.
       */
      if (
        tweet.author &&
        tweet.author.toLowerCase() ===
        XOSHI_HANDLE.toLowerCase()
      ) {
        continue;
      }

      console.log(
        `Mention @${tweet.author}: ${tweet.text}`
      );

      const reply =
        await generateReply(
          tweet.text,
          tweet.author || ""
        );

      if (!reply) {
        continue;
      }

      const success =
        await postReply(
          page,
          tweet,
          reply
        );

      if (success) {
        mentionReplies++;
      }

      /*
       * Avoid rapid consecutive interactions.
       */
      await sleep(1500);
    }

    console.log(
      `Mention replies: ${mentionReplies}`
    );

    /*
     * ========================================================
     * MARKET / CRYPTO RADAR
     * ========================================================
     */

    console.log(
      "--- MARKET / CRYPTO RADAR ---"
    );

    const radar =
      await runRadar(page);

    console.log(
      `Radar tweets: ${radar.length}`
    );

    let radarReplies = 0;

    /*
     * Limit autonomous radar replies per cycle.
     */
    const radarCandidates =
      radar.slice(0, 3);

    for (const tweet of radarCandidates) {

      if (
        tweet.author &&
        tweet.author.toLowerCase() ===
        XOSHI_HANDLE.toLowerCase()
      ) {
        continue;
      }

      const reply =
        await generateRadarReply(tweet);

      if (!reply) {
        continue;
      }

      const success =
        await postReply(
          page,
          tweet,
          reply
        );

      if (success) {
        radarReplies++;
      }

      await sleep(1500);
    }

    console.log(
      `Radar replies: ${radarReplies}`
    );

    /*
     * ========================================================
     * DAILY / CYCLE POST
     * ========================================================
     */

    /*
     * Only publish a generic autonomous post when there were
     * no radar/mention interactions.
     *
     * This reduces unnecessary posting and makes the agent
     * behave less like a spam bot.
     */
    if (
      mentionReplies === 0 &&
      radarReplies === 0
    ) {

      const postText =
        "The interesting frontier isn't simply putting assets onchain.\n\n" +
        "It's building markets where tokenization, liquidity, " +
        "AI agents and programmable settlement actually reinforce each other.\n\n" +
        "$XOSHI";

      await postTweet(
        page,
        postText
      );

    } else {

      console.log(
        "Skipping autonomous post because the cycle already generated engagement."
      );
    }

    console.log(
      "Cycle complete."
    );

  } finally {

    if (context) {

      try {
        await context.close();
      } catch {
        // Ignore.
      }
    }
  }
}

/*
 * ============================================================
 * START
 * ============================================================
 */

main().catch(error => {

  console.error(
    "Fatal Xoshi XI error:",
    error instanceof Error
      ? error.stack || error.message
      : String(error)
  );

  process.exit(1);
});
