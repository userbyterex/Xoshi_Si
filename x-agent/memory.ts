import axios from "axios";

export type Interaction = {
  tweetId: string;
  author: string;
  text: string;
  reply: string;
  repliedAt: string;
  topic?: string;
};

export type XoshiMemory = {
  version: 2;
  processedTweets: Record<string, Interaction>;
  radarSeenTweets: Record<string, number>;
  recentInteractions: Interaction[];
  lastDailyPost?: string;
  lastCycle?: string;
};

const DEFAULT_MEMORY: XoshiMemory = {
  version: 2,
  processedTweets: {},
  radarSeenTweets: {},
  recentInteractions: []
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

export async function loadMemory(): Promise<XoshiMemory> {
  const id = process.env.GIST_ID;
  const token = process.env.GIST_TOKEN;
  if (!id || !token) {
    console.log("Gist memory disabled: GIST_ID/GIST_TOKEN missing.");
    return structuredClone(DEFAULT_MEMORY);
  }

  try {
    const r = await axios.get(`https://api.github.com/gists/${id}`, {
      headers: headers(),
      timeout: 15000
    });
    const file = r.data?.files?.[GIST_FILE];
    if (!file?.content) return structuredClone(DEFAULT_MEMORY);
    const parsed = JSON.parse(file.content);
    return {
      ...structuredClone(DEFAULT_MEMORY),
      ...parsed,
      processedTweets: parsed.processedTweets || {},
      radarSeenTweets: parsed.radarSeenTweets || {},
      recentInteractions: parsed.recentInteractions || []
    };
  } catch (e: any) {
    console.log(`Gist memory load failed: ${e?.response?.status || e?.message || e}`);
    return structuredClone(DEFAULT_MEMORY);
  }
}

export async function saveMemory(memory: XoshiMemory): Promise<void> {
  const id = process.env.GIST_ID;
  const token = process.env.GIST_TOKEN;
  if (!id || !token) return;

  // Keep the gist compact and useful.
  const now = Date.now();
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;

  const processed = Object.fromEntries(
    Object.entries(memory.processedTweets).filter(([, v]) => {
      return Date.parse(v.repliedAt) >= cutoff;
    }).slice(-1000)
  );

  const radarSeen = Object.fromEntries(
    Object.entries(memory.radarSeenTweets).filter(([, ts]) => Number(ts) >= cutoff).slice(-1500)
  );

  memory.processedTweets = processed;
  memory.radarSeenTweets = radarSeen;
  memory.recentInteractions = memory.recentInteractions.slice(-100);
  memory.lastCycle = new Date().toISOString();

  try {
    await axios.patch(
      `https://api.github.com/gists/${id}`,
      {
        files: {
          [GIST_FILE]: {
            content: JSON.stringify(memory, null, 2)
          }
        }
      },
      { headers: headers(), timeout: 15000 }
    );
    console.log(`Gist memory saved: ${Object.keys(processed).length} processed tweets.`);
  } catch (e: any) {
    console.log(`Gist memory save failed: ${e?.response?.status || e?.message || e}`);
  }
}

export function alreadyProcessed(memory: XoshiMemory, tweetId: string): boolean {
  return Boolean(memory.processedTweets[tweetId]);
}

export function markProcessed(
  memory: XoshiMemory,
  item: { tweetId: string; author: string; text: string; reply: string; topic?: string }
) {
  const interaction: Interaction = {
    ...item,
    repliedAt: new Date().toISOString()
  };
  memory.processedTweets[item.tweetId] = interaction;
  memory.recentInteractions.push(interaction);
}

export function markRadarSeen(memory: XoshiMemory, tweetId: string) {
  memory.radarSeenTweets[tweetId] = Date.now();
}

export function authorContext(memory: XoshiMemory, author: string): Interaction[] {
  const a = author.toLowerCase().replace(/^@/, "");
  return memory.recentInteractions
    .filter(x => x.author.toLowerCase().replace(/^@/, "") === a)
    .slice(-5);
}

export function textAlreadyHandled(memory: XoshiMemory, text: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/@\w+/g, "").replace(/[^a-z0-9$# ]/gi, " ")
      .replace(/\s+/g, " ").trim();
  const n = normalize(text);
  if (!n || n.length < 30) return false;
  return memory.recentInteractions.some(x => normalize(x.text) === n);
}
