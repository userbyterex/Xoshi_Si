import { chromium, BrowserContext, Page } from "playwright";
import axios from "axios";
import path from "path";

const FASTAPI_URL = (process.env.FASTAPI_URL || "").replace(/\/$/, "");
const HANDLE = (process.env.XOSHI_HANDLE || "xoshi_Si").replace(/^@/, "");

const PROFILE =
  process.env.XOSHI_PROFILE_DIR ||
  path.join(process.cwd(), "profiles", "xoshi-main");

const AUTH = process.env.TWITTER_AUTH_TOKEN || "";
const CT0 = process.env.TWITTER_CT0 || "";

const MAX_MENTION_REPLIES = 5;
const MAX_RADAR_REPLIES = 2;

interface SearchResult {
  text: string;
  link: string;
  author: string;
}

function detectLanguage(text: string): string {
  if (/[¿¡]/.test(text)) return "es";

  if (
    /\b(el|la|los|las|que|para|como|hola|esto|esta|pero|por|una|uno)\b/i.test(
      text
    )
  ) {
    return "es";
  }

  if (
    /\b(le|les|avec|pour|bonjour|mais|une|des|dans|sur)\b/i.test(text)
  ) {
    return "fr";
  }

  if (
    /\b(der|die|das|und|nicht|ist|eine|ein|für|mit)\b/i.test(text)
  ) {
    return "de";
  }

  if (
    /\b(você|não|uma|para|com|isso|que|uma|dos|das)\b/i.test(text)
  ) {
    return "pt";
  }

  if (
    /\b(per|che|una|come|con|questo|non|sono|gli|della)\b/i.test(text)
  ) {
    return "it";
  }

  if (
    /\b(que|per|amb|una|aquest|això|els|les|del)\b/i.test(text)
  ) {
    return "ca";
  }

  return "en";
}

async function setupBrowser(): Promise<BrowserContext> {
  if (!AUTH || !CT0) {
    throw new Error(
      "X authentication secrets missing: TWITTER_AUTH_TOKEN / TWITTER_CT0"
    );
  }

  console.log("🌐 Starting Chromium...");
  console.log(`👤 X account: @${HANDLE}`);

  const context = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: {
      width: 1440,
      height: 1000,
    },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",
  });

  await context.addCookies([
    {
      name: "auth_token",
      value: AUTH,
      domain: ".x.com",
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "ct0",
      value: CT0,
      domain: ".x.com",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  return context;
}

async function verifySession(page: Page): Promise<void> {
  console.log("🔐 Checking X session...");

  await page.goto("https://x.com/home", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(2500);

  const url = page.url();

  if (
    url.includes("/login") ||
    url.includes("/i/flow/login") ||
    url.includes("/account/access")
  ) {
    throw new Error(
      `X session invalid. Browser was redirected to: ${url}`
    );
  }

  const body = await page.locator("body").innerText().catch(() => "");

  if (
    /Sign in to X|Iniciar sesión en X|Create account|Crear cuenta/i.test(body)
  ) {
    throw new Error("X session appears to be logged out.");
  }

  console.log("✅ X session appears valid.");
}

async function search(
  page: Page,
  query: string
): Promise<SearchResult[]> {
  console.log(`🔎 X search: ${query}`);

  const url =
    "https://x.com/search?q=" +
    encodeURIComponent(query) +
    "&src=typed_query&f=live";

  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(2500);

  const results = await page.locator("article").evaluateAll((articles) => {
    return articles
      .map((article) => {
        const text = (article.textContent || "").trim();

        const links = Array.from(
          article.querySelectorAll("a")
        ) as HTMLAnchorElement[];

        const statusLink =
          links.find((a) => /\/status\/\d+/.test(a.href))?.href || "";

        const profileLink =
          links.find(
            (a) =>
              /^https:\/\/x\.com\/[^/]+$/.test(a.href) &&
              !a.href.includes("/i/")
          )?.href || "";

        let author = "";

        if (profileLink) {
          author = profileLink
            .replace("https://x.com/", "")
            .split("?")[0]
            .replace("/", "");
        }

        return {
          text,
          link: statusLink,
          author,
        };
      })
      .filter((x) => x.text && x.link);
  });

  console.log(`   Found ${results.length} posts.`);

  return results.slice(0, 20);
}

async function clickReplyButton(page: Page): Promise<void> {
  const selectors = [
    'button[data-testid="reply"]',
    'button[aria-label*="Reply"]',
    'button[aria-label*="Responder"]',
    'button[aria-label*="Répondre"]',
    'button[aria-label*="Antworten"]',
  ];

  for (const selector of selectors) {
    const element = page.locator(selector).first();

    if (await element.count()) {
      await element.click();
      return;
    }
  }

  const roleButton = page
    .getByRole("button", {
      name: /Reply|Responder|Répondre|Antworten/i,
    })
    .first();

  if (await roleButton.count()) {
    await roleButton.click();
    return;
  }

  throw new Error("Could not find X reply button.");
}

async function findComposer(page: Page) {
  const selectors = [
    '[data-testid="tweetTextarea_0"]',
    'textarea[placeholder*="Post"]',
    'textarea[placeholder*="Publicar"]',
    'div[contenteditable="true"][role="textbox"]',
  ];

  for (const selector of selectors) {
    const composer = page.locator(selector).first();

    if (await composer.count()) {
      return composer;
    }
  }

  throw new Error("Could not find X composer.");
}

async function findPostButton(page: Page) {
  const selectors = [
    'button[data-testid="tweetButtonInline"]',
    'button[data-testid="tweetButton"]',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).last();

    if (await button.count()) {
      return button;
    }
  }

  const button = page
    .getByRole("button", {
      name: /Post|Publicar|Tweet/i,
    })
    .last();

  if (await button.count()) {
    return button;
  }

  throw new Error("Could not find X post button.");
}

async function reply(
  page: Page,
  link: string,
  text: string
): Promise<void> {
  console.log(`💬 Replying to: ${link}`);
  console.log(`   Text: ${text}`);

  await page.goto(link, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(1800);

  await clickReplyButton(page);

  await page.waitForTimeout(700);

  const composer = await findComposer(page);

  await composer.fill(text.slice(0, 270));

  await page.waitForTimeout(300);

  const postButton = await findPostButton(page);

  await postButton.click();

  await page.waitForTimeout(1800);

  console.log("✅ Reply submitted.");
}

async function post(
  page: Page,
  text: string
): Promise<void> {
  console.log("📝 Publishing Xoshi post...");
  console.log(`   Text: ${text}`);

  await page.goto("https://x.com/compose/post", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });

  await page.waitForTimeout(1200);

  const composer = await findComposer(page);

  await composer.fill(text.slice(0, 280));

  await page.waitForTimeout(300);

  const postButton = await findPostButton(page);

  await postButton.click();

  await page.waitForTimeout(1800);

  console.log("✅ Xoshi post published.");
}

async function callMentionAI(
  author: string,
  text: string
) {
  const response = await axios.post(
    `${FASTAPI_URL}/api/intelligence/mention`,
    {
      author,
      text,
      detected_language: detectLanguage(text),
    },
    {
      timeout: 30000,
    }
  );

  return response.data;
}

async function callRadarAI(
  author: string,
  text: string
) {
  const response = await axios.post(
    `${FASTAPI_URL}/api/intelligence/analyze`,
    {
      author,
      text,
      detected_language: detectLanguage(text),
      preferred: "gemini",
    },
    {
      timeout: 30000,
    }
  );

  return response.data;
}

async function generateDailyPost() {
  const response = await axios.post(
    `${FASTAPI_URL}/api/reading/daily`,
    {},
    {
      timeout: 30000,
    }
  );

  return response.data;
}

async function checkBackend(): Promise<void> {
  console.log("🧠 Checking Xoshi backend...");

  const response = await axios.get(`${FASTAPI_URL}/health`, {
    timeout: 15000,
  });

  console.log("Backend:", JSON.stringify(response.data));
}

function shouldPublishScheduledPost(): boolean {
  const hour = new Date().getUTCHours();

  // GitHub Actions runs hourly.
  // Publish around 00:00 UTC and 12:00 UTC.
  return hour === 0 || hour === 12;
}

async function processMentions(page: Page): Promise<number> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("👤 DIRECT MENTION SCAN");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const queries = [
    `to:${HANDLE}`,
    `"@${HANDLE}"`,
  ];

  const seen = new Set<string>();
  let replied = 0;

  for (const query of queries) {
    if (replied >= MAX_MENTION_REPLIES) break;

    const results = await search(page, query);

    for (const item of results) {
      if (replied >= MAX_MENTION_REPLIES) break;

      if (!item.link) continue;

      const key = item.link;

      if (seen.has(key)) continue;
      seen.add(key);

      const isMention =
        item.text.toLowerCase().includes(`@${HANDLE.toLowerCase()}`) ||
        item.author.toLowerCase() === HANDLE.toLowerCase();

      if (!isMention) {
        continue;
      }

      if (
        item.author &&
        item.author.toLowerCase() === HANDLE.toLowerCase()
      ) {
        console.log("⏭️ Skipping Xoshi's own post.");
        continue;
      }

      console.log("");
      console.log(`📨 Mention from @${item.author || "unknown"}`);
      console.log(`   ${item.text.slice(0, 300)}`);

      try {
        const ai = await callMentionAI(
          item.author || "unknown",
          item.text
        );

        console.log(
          `🧠 Mention decision: ${JSON.stringify(ai)}`
        );

        if (!ai.reply) {
          console.log("⚠️ Backend returned no reply.");
          continue;
        }

        await reply(page, item.link, ai.reply);

        replied++;
      } catch (error: any) {
        console.error(
          "❌ Mention processing failed:",
          error?.response?.data || error?.message || error
        );
      }
    }
  }

  console.log(`📊 Mention replies: ${replied}`);

  return replied;
}

async function processRadar(page: Page): Promise<number> {
  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📡 MARKET / CRYPTO RADAR");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const queries = [
    "$XOSHI",
    '"Stock Tokens"',
    '"tokenized stocks"',
    '"Robinhood Chain"',
    '"RWA" "AI agents"',
    "DeFi AI agents",
  ];

  const seen = new Set<string>();
  let replies = 0;

  for (const query of queries) {
    if (replies >= MAX_RADAR_REPLIES) break;

    const results = await search(page, query);

    for (const item of results) {
      if (replies >= MAX_RADAR_REPLIES) break;

      if (!item.link || seen.has(item.link)) continue;

      seen.add(item.link);

      if (
        item.author &&
        item.author.toLowerCase() === HANDLE.toLowerCase()
      ) {
        continue;
      }

      try {
        const ai = await callRadarAI(
          item.author || "unknown",
          item.text
        );

        console.log(
          `🤖 Radar @${item.author || "unknown"} → ${ai.decision} (${ai.confidence})`
        );

        if (
          ai.decision === "REPLY" &&
          Number(ai.confidence) >= 0.68 &&
          ai.reply
        ) {
          await reply(page, item.link, ai.reply);

          replies++;
        }
      } catch (error: any) {
        console.error(
          "❌ Radar item failed:",
          error?.response?.data || error?.message || error
        );
      }
    }
  }

  console.log(`📊 Radar replies: ${replies}`);

  return replies;
}

async function processScheduledPost(page: Page): Promise<boolean> {
  if (!shouldPublishScheduledPost()) {
    console.log("⏭️ No scheduled post due this hour.");
    return false;
  }

  console.log("");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📝 SCHEDULED XOSHI READING");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  try {
    const result = await generateDailyPost();

    const text = result.post || result.reply || result.content;

    if (!text) {
      console.log(
        "⚠️ Backend did not return a post."
      );
      return false;
    }

    await post(page, text);

    return true;
  } catch (error: any) {
    console.error(
      "❌ Scheduled post failed:",
      error?.response?.data || error?.message || error
    );

    return false;
  }
}

async function main(): Promise<void> {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║          XOSHI XI CYCLE              ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  if (!FASTAPI_URL) {
    throw new Error("FASTAPI_URL is missing.");
  }

  await checkBackend();

  const context = await setupBrowser();
  const page = await context.newPage();

  try {
    await verifySession(page);

    const mentionReplies = await processMentions(page);

    const radarReplies = await processRadar(page);

    const scheduledPost = await processScheduledPost(page);

    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 CYCLE SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Direct mention replies: ${mentionReplies}`);
    console.log(`Radar replies:          ${radarReplies}`);
    console.log(
      `Scheduled post:         ${scheduledPost ? "YES" : "NO"}`
    );
    console.log("Status:                  COMPLETE");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error("");
  console.error("💥 XOSHI CYCLE FAILED");
  console.error(error?.stack || error);
  process.exit(1);
});
