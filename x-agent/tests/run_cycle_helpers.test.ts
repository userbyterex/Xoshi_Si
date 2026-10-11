import assert from "node:assert/strict";

import { buildSearchUrl, extractStatusFromHref } from "../run_cycle";
import { markDailyPost, normalizeText, postTextAlreadyPublished, XoshiMemory } from "../memory";

const status = extractStatusFromHref("/alice/status/123456789?s=20");
assert.deepEqual(status, { id: "123456789", author: "alice" });
assert.deepEqual(extractStatusFromHref("/i/status/42"), { id: "42", author: "" });
assert.equal(extractStatusFromHref("/alice/status/not-an-id"), null);

const searchUrl = buildSearchUrl('"Robinhood Chain"');
assert.match(searchUrl, /q=%22Robinhood%20Chain%22/);
assert.match(searchUrl, /f=live/);

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
