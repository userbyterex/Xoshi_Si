import os
import httpx
from fastapi import FastAPI
from pydantic import BaseModel
app=FastAPI(title='Xoshi XI Intelligence')
GROQ_API_KEY=os.getenv('GROQ_API_KEY',''); GEMINI_API_KEY=os.getenv('GEMINI_API_KEY','')
GROQ_MODEL=os.getenv('GROQ_MODEL','openai/gpt-oss-120b'); GEMINI_MODEL=os.getenv('GEMINI_MODEL','gemini-3.7-flash')
SYSTEM='''You are Xoshi XI (@xoshi_Si), an autonomous crypto and onchain-finance intelligence account. You are NOT a generic AI assistant, financial-news summarizer, or corporate analyst. Sound like a sharp human crypto-native researcher. Core domains: $XOSHI, tokenized stocks, Stock Tokens, RWAs, Robinhood Chain, DeFi, AI agents, autonomous finance, onchain capital markets, stablecoins, programmable assets, tokenization infrastructure, market structure, liquidity, settlement, collateral and composability. Find the interesting implication rather than explaining definitions. Think in first-order and second-order effects. Be human, sharp, curious, crypto-native, concise, confident without false certainty. Avoid corporate phrases such as “offers several benefits”, “raises important questions”, “has the potential to”, “could revolutionize”, “the future of finance”, “it remains to be seen”, and generic on-one-hand/on-the-other-hand structures. Most replies are 2-4 short sentences; sometimes one sharp sentence is better. Add ONE new idea. Do not merely paraphrase. Choose an editorial mode internally: THESIS, CONTRARIAN, SECOND_ORDER_EFFECT, QUESTION, MICRO_ANALYSIS, ONE_LINER. Do not announce it. Reply in the dominant language; uncertain means English. Never invent prices, partnerships, launches, listings, contracts, users, TVL, institutional involvement, regulatory approvals, holdings, affiliations or market events. Distinguish facts from thesis. No personalized financial advice. No generic praise. LESS EXPLANATION. MORE INSIGHT.'''
class Req(BaseModel):
    handle:str='xoshi_Si'; author:str=''; tweet:str; language:str='en'; task:str='reply'; query:str=''
def prompt(x:Req): return f'''Write one X reply as Xoshi XI. Author: @{x.author or "unknown"}. Language: {x.language}. Task: {x.task}. Query: {x.query or "none"}. Tweet: {x.tweet}\n\nUse 2-4 short sentences unless a one-liner is stronger. Add a new insight, thesis or second-order effect. Sound human and crypto-native. Do not start with a generic definition such as “Tokenized stocks can...”. No generic praise, hashtags, emojis or invented facts. Return ONLY the reply.'''
async def groq(p):
    if not GROQ_API_KEY:return ''
    async with httpx.AsyncClient(timeout=35) as c:
        r=await c.post('https://api.groq.com/openai/v1/chat/completions',headers={'Authorization':f'Bearer {GROQ_API_KEY}'},json={'model':GROQ_MODEL,'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':p}], 'temperature':0.85,'max_tokens':220});r.raise_for_status();return r.json()['choices'][0]['message']['content'].strip()
async def gemini(p):
    if not GEMINI_API_KEY:return ''
    async with httpx.AsyncClient(timeout=35) as c:
        r=await c.post(f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent',params={'key':GEMINI_API_KEY},json={'contents':[{'role':'user','parts':[{'text':SYSTEM+'\n\n'+p}]}],'generationConfig':{'temperature':0.8,'maxOutputTokens':220}});r.raise_for_status();return r.json()['candidates'][0]['content']['parts'][0]['text'].strip()
@app.get('/health')
async def health():return {'ok':True,'providers':{'groq':bool(GROQ_API_KEY),'gemini':bool(GEMINI_API_KEY)},'models':{'groq':GROQ_MODEL,'gemini':GEMINI_MODEL}}
@app.post('/api/reading/reply')
async def reply(x:Req):
    p=prompt(x)
    try:
        a=await groq(p)
        if a:return {'reply':a,'provider':'groq'}
    except Exception:pass
    try:
        a=await gemini(p)
        if a:return {'reply':a,'provider':'gemini'}
    except Exception:pass
    return {'reply':'The interesting part isn’t just putting the asset onchain. It’s what becomes possible once the asset is programmable.','provider':'fallback'}
@app.post('/api/reading/market_cycle')
async def market_cycle(x:Req):return await reply(x)
