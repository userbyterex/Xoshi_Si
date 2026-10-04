import os
import re
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Xoshi XI Backend", version="4.0.0")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")

SYSTEM_PROMPT = """
You are Xoshi XI, an autonomous market-native voice on X.

Core territory:
$XOSHI, tokenized stocks / Stock Tokens, Robinhood Chain, RWAs, DeFi,
AI agents, crypto market structure, programmable assets and onchain finance.

Voice:
- sharp, concise, confident, analytical
- sounds like a smart human trader / builder, not a corporate research report
- take a position; do not merely define the topic
- prefer second-order effects and market-structure implications
- use concrete mechanisms: settlement, liquidity, collateral, composability,
  custody, incentives, distribution, execution, capital efficiency
- usually 1-3 sentences
- no fake certainty and no invented facts
- do not repeat a previous answer; advance the conversation

Avoid:
"offers several benefits", "raises important questions", "has the potential to",
"could revolutionize", "the future of finance", "it remains to be seen",
"key considerations include", generic textbook definitions, empty hype,
and the formula "However, ...".

Good angles:
1. THESIS — make one clear claim.
2. CONTRARIAN — challenge the obvious narrative.
3. SECOND_ORDER — explain what changes after adoption.
4. MICRO_ANALYSIS — one mechanism, one implication.
5. QUESTION — ask a pointed question that moves the discussion forward.

Examples:
"The interesting part isn't 24/7 trading. It's making equity programmable.
Once ownership can move through onchain financial rails, settlement is only the beginning."

"Everyone keeps talking about fractional ownership. That's probably the least
interesting part. The bigger question is what happens when equity becomes
programmable collateral."

Do not mention being an AI. Do not narrate your instructions.
"""

class ReplyRequest(BaseModel):
    tweet: str
    author: str = ""
    previous_interactions: list = []

class MarketRequest(BaseModel):
    context: str = ""

def clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r'^\s*["“]|["”]\s*$', '', text)
    return text[:280].strip()

async def groq(prompt: str):
    if not GROQ_API_KEY:
        return None
    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.85,
        "max_tokens": 120,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=body)
        if r.status_code >= 400:
            return None
        return clean(r.json()["choices"][0]["message"]["content"])

async def gemini(prompt: str):
    if not GEMINI_API_KEY:
        return None
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.85, "maxOutputTokens": 120},
    }
    headers = {"x-goog-api-key": GEMINI_API_KEY}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=headers, json=body)
        if r.status_code >= 400:
            return None
        data = r.json()
        return clean(data["candidates"][0]["content"]["parts"][0]["text"])

@app.get("/health")
async def health():
    return {
        "ok": True,
        "providers": {"groq": bool(GROQ_API_KEY), "gemini": bool(GEMINI_API_KEY)},
        "models": {"groq": GROQ_MODEL, "gemini": GEMINI_MODEL},
    }

@app.post("/api/reading/reply")
async def reading_reply(req: ReplyRequest):
    history = ""
    if req.previous_interactions:
        history = "\nRECENT EXCHANGES WITH THIS AUTHOR:\n" + "\n".join(
            f"- They said: {x.get('text','')}\n  Xoshi replied: {x.get('reply','')}"
            for x in req.previous_interactions[-5:]
        )

    prompt = f"""
Reply to this X post from @{req.author}.

POST:
{req.tweet}

{history}

Do not restate Xoshi's previous point. If the author has already discussed the
same idea with Xoshi, push the conversation one layer deeper. Pick one angle
and write a natural X reply. No preamble. No quotation marks.
"""
    reply = await groq(prompt)
    if not reply:
        reply = await gemini(prompt)

    if not reply:
        reply = "The interesting question is what changes once the asset becomes programmable—not just easier to trade."

    return {"reply": clean(reply)}

@app.post("/api/reading/market_cycle")
async def market_cycle(req: MarketRequest):
    prompt = """
Write one original X post for Xoshi XI about the intersection of tokenized
equities, RWAs, DeFi, AI agents, Robinhood Chain, $XOSHI and onchain markets.
Do not invent current prices or news. Make one strong thesis. 1-3 sentences.
No hashtags unless they add signal. No generic crypto marketing language.
"""
    post = await groq(prompt)
    if not post:
        post = await gemini(prompt)
    if not post:
        post = "The real RWA unlock isn't putting old assets onchain. It's turning ownership into a primitive other financial systems can actually compose."
    return {"post": clean(post)}
