import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const profile = path.resolve(process.env.XOSHI_PROFILE_DIR || "./profiles/xoshi-main");
fs.mkdirSync(profile, { recursive: true });

(async () => {
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  await page.goto("https://x.com/login", { waitUntil: "domcontentloaded" });
  console.log("Log into the new Xoshi account manually. Complete normal 2FA if required.");
  console.log("When the account is visibly logged in, press Enter in this terminal.");
  await new Promise<void>(resolve => process.stdin.once("data", () => resolve()));
  await context.close();
  console.log(`Saved browser profile: ${profile}`);
})();
