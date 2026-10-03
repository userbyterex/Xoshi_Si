import os
import httpx
from fastapi import FastAPI
from pydantic import BaseModel
app=FastAPI(title='Xoshi XI Intelligence Backend')
GROQ=os.getenv('GROQ_API_KEY',''); GEMINI=os.getenv('GEMINI_API_KEY','')
GM=os.getenv('GROQ_MODEL','openai/gpt-oss-120b'); MM=os.getenv('GEMINI_MODEL','gemini-3.7-flash')
SYSTEM='You are Xoshi XI, an English-first autonomous social intelligence agent focused on $XOSHI, Robinhood Chain, Stock Tokens, tokenized equities, RWAs, crypto, DeFi, AI agents and markets. Adapt to the users language. Be concise, conversational and factual. Never invent prices, partnerships, listings, holdings, contracts, news or affiliations. Distinguish facts from analysis. Do not execute trades or provide personalized financial advice.'
class Req(BaseModel):
    author:str=''; text:str; detected_language:str='en'; preferred:str='groq'
async def groq(prompt):
    if not GROQ: raise RuntimeError('GROQ_API_KEY missing')
    async with httpx.AsyncClient(timeout=45) as c:
        r=await c.post('https://api.groq.com/openai/v1/chat/completions',headers={'Authorization':f'Bearer {GROQ}','Content-Type':'application/json'},json={'model':GM,'messages':[{'role':'system','content':SYSTEM},{'role':'user','content':prompt}], 'temperature':0.7,'max_tokens':180})
        r.raise_for_status(); return r.json()['choices'][0]['message']['content'].strip()
async def gemini(prompt):
    if not GEMINI: raise RuntimeError('GEMINI_API_KEY missing')
    url=f'https://generativelanguage.googleapis.com/v1beta/models/{MM}:generateContent?key={GEMINI}'
    async with httpx.AsyncClient(timeout=45) as c:
        r=await c.post(url,json={'contents':[{'parts':[{'text':SYSTEM+'\n'+prompt}]}]})
        r.raise_for_status(); return r.json()['candidates'][0]['content']['parts'][0]['text'].strip()
async def route(prompt,preferred='groq'):
    funcs=[groq,gemini] if preferred=='groq' else [gemini,groq]
    last=None
    for f in funcs:
        try:return await f(prompt)
        except Exception as e:last=e
    raise last
@app.get('/health')
async def health(): return {'ok':True,'providers':{'groq':bool(GROQ),'gemini':bool(GEMINI)},'models':{'groq':GM,'gemini':MM}}
@app.post('/api/intelligence/mention')
async def mention(x:Req):
    p=f'Answer this direct X mention as Xoshi XI. Language: {x.detected_language}. Author: @{x.author}. Mention: {x.text}. Reply conversationally, useful and under 270 characters. Do not invent facts.'
    return {'reply':(await route(p,'groq'))[:270]}
@app.post('/api/intelligence/analyze')
async def analyze(x:Req):
    p=f'Analyze this X post for whether Xoshi should reply. Return JSON only with decision (IGNORE, REPLY, QUESTION, INVESTIGATE), reason, reply, topic, confidence 0-1. Post by @{x.author}: {x.text}'
    import json,re
    raw=await route(p,x.preferred)
    m=re.search(r'\{.*\}',raw,re.S)
    try:return json.loads(m.group(0)) if m else {'decision':'REPLY','reason':'relevant','reply':raw[:270],'topic':'general','confidence':0.7}
    except:return {'decision':'REPLY','reason':'relevant','reply':raw[:270],'topic':'general','confidence':0.7}
@app.post('/api/reading/daily')
async def daily():
    p='Write one original concise English X post for Xoshi XI about the intersection of AI agents, tokenized equities/Stock Tokens, RWAs, onchain finance and crypto. No fabricated current facts. Under 270 characters.'
    return {'post':await route(p,'groq')}
