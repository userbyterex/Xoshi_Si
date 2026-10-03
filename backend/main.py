import json
import os
import re
from typing import Any

import httpx
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Xoshi XI Intelligence Backend", version="1.0.0")

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.7-flash")

LANG_NAMES = {
    "en": "English", "es": "Spanish", "fr": "French", "de": "German",
    "pt": "Portuguese", "it": "Italian", "nl": "Dutch", "ca": "Catalan",
    "ja": "Japanese", "ko": "Korean", "zh": "Chinese", "ar": "Arabic",
    "ru": "Russian", "tr": "Turkish"
}

SYSTEM = """You are Xoshi XI (@xoshi_Si), an autonomous social intelligence
agent focused on $XOSHI, Robinhood Chain, Stock Tokens, tokenized RWAs, crypto,
DeFi, stablecoins, public markets and AI agents.

LANGUAGE POLICY:
- English is the primary/default language.
- Detect the user's language and answer in the same language when confident.
- Spanish -> Spanish; French -> French; German -> German; Portuguese ->
  Portuguese; Italian -> Italian; Catalan -> Catalan; and similarly for other
  confidently detected languages.
- Mixed text: use the dominant language.
- Uncertain: English.
- Never translate a user's question into English unless necessary internally.

STYLE:
- concise, natural, conversational and intelligent;
- X-native, but never spammy;
- answer the actual question;
- do not force $XOSHI into every reply;
- do not pretend to be human.

FINANCIAL INTEGRITY:
- Never invent current prices, volume, contracts, partnerships, listings,
  holdings, official affiliations or breaking news.
- Separate verified facts, attributed claims and analysis.
- If current data is unavailable, explicitly say it needs verification.
- Do not provide personalized financial advice or execute trades.
"""

async def groq(prompt: str, temperature: float = 0.7, max_tokens: int = 400):
    if not GROQ_API_KEY:
        return None
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    async with httpx.AsyncClient(timeout=35) as client:
        response = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=body,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


async def gemini(prompt: str, temperature: float = 0.5, max_tokens: int = 400):
    if not GEMINI_API_KEY:
        return None
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_tokens,
        },
    }
    async with httpx.AsyncClient(timeout=35) as client:
        response = await client.post(url, json=body)
        response.raise_for_status()
        data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]


async def route(prompt: str, preferred: str):
    providers = [groq, gemini] if preferred == "groq" else [gemini, groq]
    for provider in providers:
        try:
            result = await provider(prompt)
            if result:
                return result
        except Exception:
            continue
    return None


def parse_json(text: str | None):
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{.*\}", text, re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except Exception:
                return None
    return None


class AnalyzeRequest(BaseModel):
    author: str = ""
    text: str
    engagement: dict[str, Any] = {}
    previous_interactions: list[str] = []
    agent_type: str = ""
    detected_language: str = "en"


@app.get("/health")
async def health():
    return {
        "ok": True,
        "providers": {
            "groq": bool(GROQ_API_KEY),
            "gemini": bool(GEMINI_API_KEY),
        },
        "models": {"groq": GROQ_MODEL, "gemini": GEMINI_MODEL},
    }


@app.post("/api/intelligence/analyze")
async def analyze(req: AnalyzeRequest):
    prompt = f"""Analyze this X post for Xoshi.

Author: {req.author}
Detected language: {LANG_NAMES.get(req.detected_language, req.detected_language)}
Text:
{req.text}

Return ONLY JSON:
{{
  "decision": "IGNORE|REPLY|QUESTION|INVESTIGATE",
  "reason": "...",
  "reply": "...",
  "topic": "...",
  "author_type": "...",
  "confidence": 0.0
}}

A reply must be in the detected user language."""
    raw = await route(prompt, "gemini")
    data = parse_json(raw)
    if data:
        return data
    return {
        "decision": "IGNORE",
        "reason": "No valid model response",
        "reply": "",
        "topic": "",
        "author_type": "",
        "confidence": 0.0,
    }


@app.post("/api/intelligence/mention")
async def mention(payload: dict):
    author = str(payload.get("author", "")).strip()
    text = str(payload.get("text", "")).strip()
    detected_language = str(payload.get("detected_language", "en"))

    prompt = f"""Someone directly mentioned @xoshi_Si.

User: @{author}
Detected language: {LANG_NAMES.get(detected_language, detected_language)}
Message:
{text}

Answer the user's actual question. Do not force a token pitch. Be useful and
natural. If the question concerns current financial data that is not supplied,
say that it needs verification.

Return ONLY JSON:
{{"reply":"..."}}"""

    raw = await route(prompt, "groq")
    data = parse_json(raw)
    reply = str(data.get("reply", "")).strip() if data else (raw or "").strip()

    if not reply:
        fallback = {
            "es": f"@{author} Estoy aquí 👀 ¿Qué quieres saber sobre $XOSHI, Stock Tokens, mercados o AI agents?",
            "fr": f"@{author} Je suis là 👀 Que veux-tu savoir sur $XOSHI, les Stock Tokens, les marchés ou les AI agents ?",
            "de": f"@{author} Ich bin da 👀 Was möchtest du über $XOSHI, Stock Tokens, Märkte oder AI Agents wissen?",
            "pt": f"@{author} Estou aqui 👀 O que queres saber sobre $XOSHI, Stock Tokens, mercados ou AI agents?",
        }
        reply = fallback.get(detected_language,
            f"@{author} I'm here 👀 What do you want to know about $XOSHI, Stock Tokens, markets or AI agents?")

    return {"reply": reply[:270], "language": detected_language}


@app.post("/api/reading/daily")
async def daily(payload: dict = {}):
    language = str(payload.get("language", "en"))
    prompt = f"""Create one concise X post for Xoshi.
Language: {LANG_NAMES.get(language, "English")}
Topic: $XOSHI, AI agents, Stock Tokens, RWAs, Robinhood Chain or onchain finance.
Do not invent current facts.
Maximum 270 characters.
Return ONLY the post text."""
    text = await route(prompt, "groq")
    if not text:
        text = (
            "Markets are becoming programmable. AI agents, Stock Tokens and "
            "onchain finance are converging into a new layer. I'm Xoshi XI. 👀"
        )
    return {"text": text.strip()[:270], "language": language}


@app.post("/api/reading/market_cycle")
async def market_cycle(payload: dict = {}):
    raw = json.dumps(payload, ensure_ascii=False)[:12000]
    prompt = f"""Analyze this market context without inventing facts:
{raw}

Return concise JSON:
{{"observations":[],"uncertainties":[],"topics_to_watch":[]}}"""
    result = await route(prompt, "gemini")
    return {"analysis": parse_json(result) or result or "", "language": "en"}
