import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.join(__dirname, 'xoshi_memory.json');

export interface XoshiMemory {
  repliedTweets: string[];
  lastDailyPostTime?: number;
  postedTexts?: { text: string; time: number }[];
  engagementLog?: { text: string; likes: number; replies: number; time: number }[];
  topPatterns?: string[];
}

const DEFAULT_MEMORY: XoshiMemory = { repliedTweets: [] };

export async function loadMemory(): Promise<XoshiMemory> {
  const gistId = process.env.GIST_ID;
  const gistToken = process.env.GIST_TOKEN;
  if (gistId && gistToken) {
    try {
      const r = await axios.get(`https://api.github.com/gists/${gistId}`, {
        headers: { Authorization: `Bearer ${gistToken}`, Accept: 'application/vnd.github+json' },
        timeout: 8000,
      });
      const content = r.data?.files?.['xoshi_memory.json']?.content;
      if (content) return JSON.parse(content);
    } catch (e: any) {
      console.log(`Gist memory load failed: ${e.message}`);
    }
  }
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {}
  return { ...DEFAULT_MEMORY };
}

export async function saveMemoryRemote(memory: XoshiMemory): Promise<void> {
  const content = JSON.stringify(memory, null, 2);
  try { fs.writeFileSync(MEMORY_FILE, content, 'utf8'); } catch {}
  const gistId = process.env.GIST_ID;
  const gistToken = process.env.GIST_TOKEN;
  if (!gistId || !gistToken) return;
  try {
    await axios.patch(`https://api.github.com/gists/${gistId}`, {
      files: { 'xoshi_memory.json': { content } }
    }, {
      headers: { Authorization: `Bearer ${gistToken}`, Accept: 'application/vnd.github+json' },
      timeout: 8000,
    });
  } catch (e: any) {
    console.log(`Gist memory save failed: ${e.message}`);
  }
}
