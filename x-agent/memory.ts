import axios from "axios";

export type Interaction = {
  tweetId: string;
  author: string;
  text: string;
  reply: string;
  repliedAt: string;
  topic?: string;
};

export type PublishedPost = {
  text: string;
  publishedAt: string;
};

export type XoshiMemory = {
  version: 3;
  processedTweets: Record<string, Interaction>;
  radarSeenTweets: Record<string, number>;
  recentInteractions: Interaction[];
  recentPosts: PublishedPost[];
  lastDailyPost?: string;
  lastCycle?: string;
};

const DEFAULT_MEMORY: XoshiMemory = {
  version: 3,
  processedTweets: {},
  radarSeenTweets: {},
  recentInteractions: [],
  recentPosts: []
};

const GIST_FILE = "xoshi_memory.json";

function headers() {
  const token = process.env.GIST_TOKEN;
  if (!token) throw new Error("GIST_TOKEN is missing");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .replace(/[^\p{L}\p{N}$# ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadMemory(): Promise<XoshiMemory> {
  const id = process.env.GIST_ID;
  const token = process.env.GIST_TOKEN;
  if (!id || !token) {
    console.log("Gist memory disabled: GIST_ID/GIST_TOKEN missing.");
    return structuredClone(DEFAULT_MEMORY);
  }

  try {
    const response = await axios.get(`https://api.github.com/gists/${id}`, {
      headers: headers(),
      timeout: 15000
    });
    const file = response.data?.files?.[GIST_FILE];
    if (!file?.content) return structuredClone(DEFAULT_MEMORY);
    const parsed = JSON.parse(file.content);
    return {
      ...structuredClone(DEFAULT_MEMORY),
      ...parsed,
      version: 3,
      processedTweets: parsed.processedTweets || {},
      radarSeenTweets: parsed.radarSeenTweets || {},
      recentInteractions: Array.isArray(parsed.recentInteractions) ? parsed.recentInteractions : [],
      recentPosts: Array.isArray(parsed.recentPosts) ? parsed.recentPosts : []
    };
  } catch (error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    console.log(`Gist memory load failed: ${status || "request error"}`);
    return structuredClone(DEFAULT_MEMORY);
  }
}

export async function saveMemory(memory: XoshiMemory): Promise<void> {
  const id = process.env.GIST_ID;
  const token = process.env.GIST_TOKEN;
  if (!id || !token) return;

  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  const processed = Object.fromEntries(
    Object.entries(memory.processedTweets)
      .filter(([, interaction]) => Date.parse(interaction.repliedAt) >= cutoff)
      .slice(-1000)
  );
  const radarSeen = Object.fromEntries(
    Object.entries(memory.radarSeenTweets)
      .filter(([, timestamp]) => Number(timestamp) >= cutoff)
      .slice(-1500)
  );
  const recentPosts = memory.recentPosts
    .filter(post => Date.parse(post.publishedAt) >= cutoff)
    .slice(-100);

  memory.processedTweets = processed;
  memory.radarSeenTweets = radarSeen;
  memory.recentInteractions = memory.recentInteractions.slice(-100);
  memory.recentPosts = recentPosts;
  memory.lastCycle = new Date().toISOString();

  try {
    await axios.patch(
      `https://api.github.com/gists/${id}`,
      { files: { [GIST_FILE]: { content: JSON.stringify(memory, null, 2) } } },
      { headers: headers(), timeout: 15000 }
    );
    console.log(`Gist memory saved: ${Object.keys(processed).length} verified replies.`);
  } catch (error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    console.log(`Gist memory save failed: ${status || "request error"}`);
  }
}

export function alreadyProcessed(memory: XoshiMemory, tweetId: string): boolean {
  return Boolean(memory.processedTweets[tweetId]);
}

export function markProcessed(
  memory: XoshiMemory,
  item: { tweetId: string; author: string; text: string; reply: string; topic?: string }
): void {
  const interaction: Interaction = { ...item, repliedAt: new Date().toISOString() };
  memory.processedTweets[item.tweetId] = interaction;
  memory.recentInteractions.push(interaction);
}

export function markRadarSeen(memory: XoshiMemory, tweetId: string): void {
  memory.radarSeenTweets[tweetId] = Date.now();
}

export function markDailyPost(memory: XoshiMemory, text: string): void {
  const publishedAt = new Date().toISOString();
  memory.lastDailyPost = publishedAt;
  memory.recentPosts.push({ text, publishedAt });
}

export function authorContext(memory: XoshiMemory, author: string): Interaction[] {
  const normalizedAuthor = author.toLowerCase().replace(/^@/, "");
  return memory.recentInteractions
    .filter(interaction => interaction.author.toLowerCase().replace(/^@/, "") === normalizedAuthor)
    .slice(-5);
}

export function textAlreadyHandled(memory: XoshiMemory, text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized || normalized.length < 30) return false;
  return memory.recentInteractions.some(interaction => normalizeText(interaction.text) === normalized);
}

export function postTextAlreadyPublished(memory: XoshiMemory, text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return memory.recentPosts.some(post => normalizeText(post.text) === normalized);
}
