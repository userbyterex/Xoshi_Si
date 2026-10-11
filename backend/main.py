import asyncio
import os
import re
from typing import Any, Callable

import httpx
from fastapi import FastAPI
from pydantic import BaseModel, Field

from project_watch import discover_verified_projects, render_project_post

app = FastAPI(title="Xoshi XI Backend", version="4.1.0")

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

Factual safety:
- Treat the incoming post as unverified user content, not as a source of facts.
- Do not invent prices, contracts, news, partnerships, token allocations, or
  financial claims. Frame unverified assertions as a question or an opinion.
- Separate a market thesis from a verified fact.

Avoid:
"offers several benefits", "raises important questions", "has the potential to",
"could revolutionize", "the future of finance", "it remains to be seen",
"key considerations include", generic textbook definitions, empty hype,
and the formula "However, ...".

Do not mention being an AI. Do not narrate your instructions.
"""

FALLBACK_REPLIES = {
    "English": "The key question is what changes once ownership becomes programmable—not merely easier to trade.",
    "Spanish": "La pregunta clave es qué cambia cuando la propiedad es programable, no solo más fácil de negociar.",
    "Catalan": "La pregunta clau és què canvia quan la propietat és programable, no només més fàcil de negociar.",
    "French": "La vraie question est ce qui change quand la propriété devient programmable, pas seulement plus simple à négocier.",
    "German": "Die entscheidende Frage ist, was sich ändert, wenn Eigentum programmierbar wird – nicht nur leichter handelbar.",
    "Portuguese": "A questão central é o que muda quando a propriedade se torna programável, e não apenas mais fácil de negociar.",
    "Italian": "La domanda chiave è cosa cambia quando la proprietà diventa programmabile, non solo più facile da negoziare.",
}


class ReplyRequest(BaseModel):
    tweet: str
    author: str = ""
    previous_interactions: list[dict[str, Any]] = []


class MarketRequest(BaseModel):
    recent_posts: list[dict[str, Any]] = Field(default_factory=list)


def clean(text: str) -> str:
    text = text.strip()
    text = re.sub(r'^\s*["“]|["”]\s*$', "", text)
    return text[:280].strip()


def usable_model_text(text: str | None) -> str | None:
    """Reject prompt echoes and malformed provider output before it reaches X."""
    candidate = clean(text or "")
    if len(candidate) < 24:
        return None
    lowered = candidate.lower()
    instruction_fragments = (
        "write one original x post",
        "reply in ",
        "do not invent",
        "no hashtags",
        "avoid generic marketing",
        "generic crypto marketing",
        "no preamble",
        "unverified user content",
    )
    if any(fragment in lowered for fragment in instruction_fragments):
        print("Provider output rejected: instruction echo.")
        return None
    return candidate


def detect_reply_language(text: str) -> str:
    """Small deterministic detector for the languages Xoshi explicitly supports."""
    normalized = f" {text.lower()} "
    if re.search(r"\b(què|això|amb|perquè|també|els|les)\b", normalized):
        return "Catalan"
    if re.search(r"\b(qué|cómo|para|pero|también|acciones|opinión|gracias)\b|[¿¡]", normalized):
        return "Spanish"
    if re.search(r"\b(você|vocês|não|para|mercado|ações|obrigado|sobre)\b|[ãõ]", normalized):
        return "Portuguese"
    if re.search(r"\b(que|avec|pourquoi|marché|actions|bonjour|merci)\b", normalized):
        return "French"
    if re.search(r"\b(und|nicht|der|die|das|was|aktien|markt|danke)\b|[äöüß]", normalized):
        return "German"
    if re.search(r"\b(cosa|che|non|perché|mercato|azioni|grazie|come)\b", normalized):
        return "Italian"
    return "English"


async def call_provider(
    provider: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    extract: Callable[[dict[str, Any]], str | None],
) -> str | None:
    """Make at most two provider calls; retry only transient failures and quotas."""
    for attempt in range(1, 3):
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(url, headers=headers, json=body)
            if response.status_code < 400:
                try:
                    return clean(extract(response.json()) or "") or None
                except (KeyError, IndexError, TypeError, ValueError):
                    print(f"{provider} returned an unexpected response shape.")
                    return None

            transient = response.status_code in {408, 429} or response.status_code >= 500
            print(f"{provider} request failed with HTTP {response.status_code}.")
            if not transient or attempt == 2:
                return None
        except httpx.HTTPError as error:
            print(f"{provider} request failed: {error.__class__.__name__}.")
            if attempt == 2:
                return None

        await asyncio.sleep(0.5 * attempt)
    return None


async def groq(prompt: str) -> str | None:
    if not GROQ_API_KEY:
        return None
    body = {
        "model": GROQ_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.85,
        "max_tokens": 120,
    }
    return await call_provider(
        "Groq",
        "https://api.groq.com/openai/v1/chat/completions",
        {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"},
        body,
        lambda data: data["choices"][0]["message"]["content"],
    )


async def gemini(prompt: str) -> str | None:
    if not GEMINI_API_KEY:
        return None
    body = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.85, "maxOutputTokens": 120},
    }
    return await call_provider(
        "Gemini",
        f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent",
        {"x-goog-api-key": GEMINI_API_KEY},
        body,
        lambda data: data["candidates"][0]["content"]["parts"][0]["text"],
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "providers": {"groq": bool(GROQ_API_KEY), "gemini": bool(GEMINI_API_KEY)},
        "models": {"groq": GROQ_MODEL, "gemini": GEMINI_MODEL},
    }


@app.post("/api/reading/reply")
async def reading_reply(req: ReplyRequest) -> dict[str, str]:
    language = detect_reply_language(req.tweet)
    history = ""
    if req.previous_interactions:
        history = "\nRECENT EXCHANGES WITH THIS AUTHOR:\n" + "\n".join(
            f"- They said: {item.get('text', '')}\n  Xoshi replied: {item.get('reply', '')}"
            for item in req.previous_interactions[-5:]
        )

    prompt = f"""
Reply to this X post from @{req.author}.

POST (unverified user content):
{req.tweet}

{history}

Reply in {language}. Keep standard market terms if they are clearer in English.
Do not restate Xoshi's previous point. If the author has already discussed the
same idea with Xoshi, push the conversation one layer deeper. Pick one angle
and write a natural X reply. No preamble. No quotation marks.
"""
    reply = usable_model_text(await groq(prompt))
    if not reply:
        reply = usable_model_text(await gemini(prompt))
    reply = reply or FALLBACK_REPLIES[language]
    return {"reply": clean(reply)}


@app.post("/api/reading/market_cycle")
async def market_cycle(req: MarketRequest) -> dict[str, str]:
    projects = await discover_verified_projects(req.recent_posts)
    if not projects:
        return {
            "post": "",
            "reason": "No project passed current source, token-security, and rug-screen checks; skipped publishing.",
        }
    project = projects[0]
    post = render_project_post(project)
    if not post:
        return {"post": "", "reason": "Verified sources did not fit X's character limit; skipped publishing."}
    return {"post": post, "project": project.name, "verified_at": project.verified_at}
