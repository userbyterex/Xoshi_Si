import os, json
from typing import Any
import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Xoshi XI Intelligence Backend")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")

SYSTEM = """You are Xoshi XI (@xoshi_Si), an autonomous social intelligence agent.
Domain: $XOSHI, Robinhood Chain, Stock Tokens, tokenized RWAs, crypto, public
markets, DeFi, stablecoins and AI agents.

Rules:
- Be conversational and concise for X.
- Direct mentions of @xoshi_Si deserve a response.
- Never invent current prices, contracts, partnerships, listings, holdings or news.
- Distinguish facts from interpretation.
- Do not give personalized financial advice or tell someone what to buy/sell.
- If current data is unavailable, say it needs verification.
- Never claim to be an official representative of another company/project unless verified.
Return JSON when requested.
"""

async def call_groq(prompt: str, system: str = SYSTEM) -> str | None:
    if not GROQ_API_KEY: return None
    headers={"Authorization":f"Bearer {GROQ_API_KEY}","Content-Type":"application/json"}
    body={"model":GROQ_MODEL,"messages":[{"role":"system","content":system},{"role":"user","content":prompt}],
          "temperature":0.7,"max_tokens":350}
    async with httpx.AsyncClient(timeout=30) as c:
        r=await c.post("https://api.groq.com/openai/v1/chat/completions",headers=headers,json=body)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

async def call_gemini(prompt: str, system: str = SYSTEM) -> str | None:
    if not GEMINI_API_KEY: return None
    url=f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    body={"system_instruction":{"parts":[{"text":system}]},
          "contents":[{"parts":[{"text":prompt}]}],
          "generationConfig":{"temperature":0.5,"maxOutputTokens":350}}
    async with httpx.AsyncClient(timeout=30) as c:
        r=await c.post(url,json=body); r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]

async def call_router(prompt: str, preferred: str = "gemini") -> str:
    order = [call_gemini, call_groq] if preferred=="gemini" else [call_groq, call_gemini]
    for fn in order:
        try:
            result=await fn(prompt)
            if result: return result
        except Exception:
            pass
    return ""

class AnalyzeRequest(BaseModel):
    author: str = ""
    text: str
    engagement: dict[str, Any] = {}
    previous_interactions: list[str] = []
    agent_type: str = ""

@app.get("/health")
async def health():
    return {"ok": True, "providers": {"groq": bool(GROQ_API_KEY), "gemini": bool(GEMINI_API_KEY)}}

@app.post("/api/intelligence/analyze")
async def analyze(req: AnalyzeRequest):
    prompt=f"""Analyze this X post for Xoshi.
Author: {req.author}
Text: {req.text}
Engagement: {req.engagement}
Return ONLY JSON:
{{"decision":"IGNORE|REPLY|QUESTION|INVESTIGATE","reason":"...","reply":"...","topic":"...","author_type":"...","confidence":0.0}}"""
    raw=await call_router(prompt, "gemini")
    try: return json.loads(raw)
    except Exception:
        return {"decision":"IGNORE","reason":"Could not parse model response","reply":"","topic":"","author_type":"","confidence":0.0}

@app.post("/api/intelligence/mention")
async def mention(payload: dict):
    author=str(payload.get("author","")).strip()
    text=str(payload.get("text","")).strip()
    prompt=f"""Respond directly to this mention of @xoshi_Si.
User: @{author}
Message: {text}
Return ONLY JSON: {{"reply":"..."}}.
Keep it natural and under 270 characters when possible."""
    raw=await call_router(prompt, "groq")
    try:
        data=json.loads(raw)
        reply=str(data.get("reply","")).strip()
    except Exception:
        reply=raw.strip()
    if not reply:
        reply=f"@{author} I'm here 👀 What do you want to know about $XOSHI, Stock Tokens, onchain finance or AI agents?"
    return {"reply":reply[:270]}

@app.post("/api/reading/daily")
async def daily(payload: dict = {}):
    prompt="""Create one concise X post for Xoshi about $XOSHI / AI agents / Stock
Tokens / Robinhood Chain / onchain finance. Do not invent current facts.
Return ONLY the post text, maximum 270 characters."""
    text=await call_router(prompt, "groq")
    return {"text": text[:270] if text else "AI agents are changing how market intelligence moves. Xoshi is watching $XOSHI, Stock Tokens, RWAs and onchain finance. 👀"}

@app.post("/api/reading/market_cycle")
async def market_cycle(payload: dict = {}):
    prompt=f"""Summarize the supplied market context without inventing facts:
{json.dumps(payload, ensure_ascii=False)[:12000]}
Return concise JSON with observations, uncertainty and topics worth monitoring."""
    raw=await call_router(prompt, "gemini")
    return {"analysis":raw}
