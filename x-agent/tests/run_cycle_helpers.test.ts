import assert from "node:assert/strict";

import { buildSearchUrl, extractStatusFromHref, hasVerifiedProjectSources } from "../run_cycle";
import { markDailyPost, normalizeText, postTextAlreadyPublished, XoshiMemory } from "../memory";

const status = extractStatusFromHref("/alice/status/123456789?s=20");
assert.deepEqual(status, { id: "123456789", author: "alice" });
assert.deepEqual(extractStatusFromHref("/i/status/42"), { id: "42", author: "" });
assert.equal(extractStatusFromHref("/alice/status/not-an-id"), null);

const searchUrl = buildSearchUrl('"Robinhood Chain"');
assert.match(searchUrl, /q=%22Robinhood%20Chain%22/);
assert.match(searchUrl, /f=live/);
assert.equal(hasVerifiedProjectSources("Top project, guaranteed safe: buy now."), false);
const verifiedPost = [
  "Watchlist, not a buy call: Example (Ethereum). GoPlus screens: no flags; neither rules out a rug. Sources:",
  "https://defillama.com/protocol/example",
  `https://api.gopluslabs.io/api/v1/token_security/1?contract_addresses=0x${"a".repeat(40)}`,
  `https://api.gopluslabs.io/api/v1/rugpull_detecting/1?contract_addresses=0x${"a".repeat(40)}`
].join(" ");
assert.equal(hasVerifiedProjectSources(verifiedPost), true);
assert.equal(hasVerifiedProjectSources(verifiedPost.replace("neither rules out a rug", "safe from rugs")), false);
const verifiedSolanaPost = [
  "Watchlist, not an endorsement: Wrapped SOL. GoPlus screens: no flags; not proof against rugs.",
  "https://defillama.com/protocol/wrapped-sol",
  "https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=So11111111111111111111111111111111111111112",
  "https://api.rugcheck.xyz/v1/tokens/So11111111111111111111111111111111111111112/report/summary?cacheOnly=true"
].join(" ");
assert.equal(hasVerifiedProjectSources(verifiedSolanaPost), true);

const memory: XoshiMemory = {
  version: 3,
  processedTweets: {},
  radarSeenTweets: {},
  recentInteractions: [],
  recentPosts: []
};
markDailyPost(memory, "Ownership becomes programmable collateral.");
assert.equal(postTextAlreadyPublished(memory, "ownership becomes programmable collateral"), true);
assert.equal(normalizeText("A post: https://example.test @alice"), "a post");

console.log("TypeScript helper tests passed.");
