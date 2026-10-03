import axios from "axios";

const GIST_ID = process.env.GIST_ID || "";
const GIST_TOKEN = process.env.GIST_TOKEN || "";
const FILE_NAME = "xoshi_memory.json";

export async function loadMemory(): Promise<any> {
  if (!GIST_ID || !GIST_TOKEN) {
    return { repliedTweets: [], postedTexts: [], engagementLog: [], agents: {}, trends: {} };
  }

  try {
    const r = await axios.get(`https://api.github.com/gists/${GIST_ID}`, {
      headers: { Authorization: `Bearer ${GIST_TOKEN}`, Accept: "application/vnd.github+json" }
    });
    const content = r.data?.files?.[FILE_NAME]?.content;
    return content ? JSON.parse(content) : { repliedTweets: [], postedTexts: [], engagementLog: [], agents: {}, trends: {} };
  } catch {
    return { repliedTweets: [], postedTexts: [], engagementLog: [], agents: {}, trends: {} };
  }
}

export async function saveMemoryRemote(memory: any): Promise<void> {
  if (!GIST_ID || !GIST_TOKEN) return;
  try {
    await axios.patch(
      `https://api.github.com/gists/${GIST_ID}`,
      { files: { [FILE_NAME]: { content: JSON.stringify(memory, null, 2) } } },
      { headers: { Authorization: `Bearer ${GIST_TOKEN}`, Accept: "application/vnd.github+json" } }
    );
  } catch (e: any) {
    console.error("Memory save failed:", e.message);
  }
}
