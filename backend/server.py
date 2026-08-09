from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import json
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
import requests
from bs4 import BeautifulSoup
from bson import ObjectId
from fastapi import FastAPI, APIRouter, Request, Response, HTTPException, Depends
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

from emergentintegrations.llm.chat import LlmChat, UserMessage

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------------- Auth helpers ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=900, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        user.pop("_id", None)
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------- Models ----------------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = "User"


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class AnalyzeInput(BaseModel):
    input_type: str  # "url" or "text"
    content: str
    target_query: Optional[str] = None


class SimulateInput(BaseModel):
    query: str


# ---------------- Content ingestion ----------------
def fetch_url(url: str) -> str:
    headers = {"User-Agent": "Mozilla/5.0 (compatible; GEOBot/1.0)"}
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    return r.text


def normalize_content(input_type: str, content: str) -> dict:
    url = None
    if input_type == "url":
        url = content.strip()
        html = fetch_url(url)
    else:
        html = content
    looks_html = "<" in html and ">" in html
    soup = BeautifulSoup(html, "lxml") if looks_html else None

    result = {"source_url": url, "title": None, "headings": [], "body_text": "", "meta_tags": {},
              "existing_schema": [], "has_faq": False, "author": None, "dates": []}

    if soup:
        for tag in soup(["script", "style", "nav", "footer", "noscript"]):
            if tag.name == "script" and tag.get("type") == "application/ld+json":
                continue
            tag.decompose() if tag.name in ("style", "nav", "footer", "noscript") else None
        if soup.title and soup.title.string:
            result["title"] = soup.title.string.strip()
        h1 = soup.find("h1")
        if h1 and not result["title"]:
            result["title"] = h1.get_text(strip=True)
        for h in soup.find_all(["h1", "h2", "h3", "h4"]):
            txt = h.get_text(strip=True)
            if txt:
                result["headings"].append({"level": h.name, "text": txt})
        for m in soup.find_all("meta"):
            name = m.get("name") or m.get("property")
            if name and m.get("content"):
                result["meta_tags"][name] = m.get("content")
        for s in soup.find_all("script", {"type": "application/ld+json"}):
            try:
                result["existing_schema"].append(json.loads(s.string))
            except Exception:
                pass
        for s in soup.find_all("script"):
            s.decompose()
        text = soup.get_text("\n", strip=True)
        result["body_text"] = re.sub(r"\n{2,}", "\n", text)
        author_meta = result["meta_tags"].get("author") or result["meta_tags"].get("article:author")
        result["author"] = author_meta
        result["has_faq"] = "faq" in text.lower() or any("faqpage" in json.dumps(x).lower() for x in result["existing_schema"])
    else:
        # plain text / markdown
        lines = content.split("\n")
        for ln in lines:
            m = re.match(r"^(#{1,4})\s+(.*)", ln.strip())
            if m:
                lvl = "h" + str(len(m.group(1)))
                result["headings"].append({"level": lvl, "text": m.group(2).strip()})
        if result["headings"]:
            result["title"] = result["headings"][0]["text"]
        result["body_text"] = content

    result["word_count"] = len(result["body_text"].split())
    result["dates"] = re.findall(r"\b(20[0-2]\d|updated|last updated)\b", result["body_text"].lower())[:5]
    if not result["title"]:
        result["title"] = "Untitled Content"
    return result


# ---------------- LLM ----------------
def strip_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n", "", text)
        text = re.sub(r"\n```$", "", text)
    return text.strip()


async def llm_json(system: str, prompt: str, session: str) -> dict:
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session, system_message=system).with_model("anthropic", "claude-sonnet-4-6")
    resp = await chat.send_message(UserMessage(text=prompt))
    raw = strip_json(resp if isinstance(resp, str) else str(resp))
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if m:
            return json.loads(m.group(0))
        raise HTTPException(status_code=502, detail="AI returned invalid response, please retry")


ANALYSIS_SYSTEM = """You are a world-class GEO/AEO (Generative Engine Optimization / Answer Engine Optimization) auditor.
You evaluate web content for how well generative AI engines (ChatGPT, Perplexity, Google AI Overviews, Gemini) can extract, understand and cite it.
You MUST respond with ONLY valid minified JSON, no markdown, no prose. Follow the exact schema requested."""


def analysis_prompt(norm: dict, target_query: Optional[str]) -> str:
    body = norm["body_text"][:12000]
    ctx = {
        "title": norm["title"],
        "headings": norm["headings"][:40],
        "word_count": norm["word_count"],
        "meta_tags": norm["meta_tags"],
        "existing_schema_types": [x.get("@type") for x in norm["existing_schema"] if isinstance(x, dict)],
        "author": norm["author"],
        "target_query": target_query or "(infer the primary query this content targets)",
    }
    return f"""Analyze this web content for GEO/AEO readiness.

METADATA: {json.dumps(ctx)}

BODY TEXT (truncated):
\"\"\"{body}\"\"\"

Return JSON with this EXACT schema:
{{
 "summary_answer": "a 40-60 word direct quotable answer that SHOULD open the content for the target query",
 "overall_score": <int 0-100>,
 "dimensions": [
   {{"key":"answer_clarity","label":"Answer Clarity","score":<0-100>,"summary":"one sentence","sub_checks":[{{"label":"...","passed":<bool>,"detail":"..."}}]}},
   {{"key":"structure","label":"Structure","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"extractability","label":"Extractability","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"eeat","label":"E-E-A-T Signals","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"structured_data","label":"Structured Data","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"question_coverage","label":"Question Coverage","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"conciseness","label":"Conciseness","score":<0-100>,"summary":"...","sub_checks":[...]}},
   {{"key":"freshness","label":"Freshness","score":<0-100>,"summary":"...","sub_checks":[...]}}
 ],
 "recommendations": [{{"dimension":"<label>","priority":"high|medium|low","fix":"specific actionable fix with concrete example"}}],
 "detected_schema_types": ["Article"|"FAQPage"|"HowTo"|"Product"|"Organization"|"Person"],
 "jsonld": [ <valid JSON-LD schema.org objects generated from this content: at minimum an Article object, plus FAQPage if Q&A exists, HowTo if steps exist, Product if applicable> ]
}}
Each dimension must have 2-4 sub_checks. Provide 5-10 recommendations prioritized. Ensure jsonld objects are valid schema.org with @context and @type."""


# ---------------- Auth endpoints ----------------
@api_router.post("/auth/register")
async def register(body: RegisterInput, response: Response):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {"email": email, "password_hash": hash_password(body.password), "name": body.name,
           "role": "user", "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": body.name, "role": "user"}


@api_router.post("/auth/login")
async def login(body: LoginInput, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return {"id": uid, "email": email, "name": user.get("name", "User"), "role": user.get("role", "user")}


@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------- Analysis endpoints ----------------
def summary_of(doc: dict) -> dict:
    return {"id": doc["id"], "title": doc["title"], "source_url": doc.get("source_url"),
            "input_type": doc["input_type"], "overall_score": doc["overall_score"],
            "created_at": doc["created_at"]}


@api_router.post("/analyses")
async def create_analysis(body: AnalyzeInput, user: dict = Depends(get_current_user)):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")
    try:
        norm = normalize_content(body.input_type, body.content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch/parse content: {e}")

    analysis = await llm_json(ANALYSIS_SYSTEM, analysis_prompt(norm, body.target_query), f"analyze-{user['id']}")

    doc = {
        "id": secrets.token_hex(12),
        "user_id": user["id"],
        "input_type": body.input_type,
        "source_url": norm.get("source_url"),
        "target_query": body.target_query,
        "title": norm["title"],
        "word_count": norm["word_count"],
        "normalized": {k: norm[k] for k in ["title", "headings", "meta_tags", "existing_schema", "author", "has_faq", "word_count", "source_url"]},
        "body_preview": norm["body_text"][:3000],
        "overall_score": int(analysis.get("overall_score", 0)),
        "summary_answer": analysis.get("summary_answer", ""),
        "dimensions": analysis.get("dimensions", []),
        "recommendations": analysis.get("recommendations", []),
        "detected_schema_types": analysis.get("detected_schema_types", []),
        "jsonld": analysis.get("jsonld", []),
        "simulations": [],
        "question_gaps": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.analyses.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/analyses")
async def list_analyses(user: dict = Depends(get_current_user)):
    docs = await db.analyses.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [summary_of(d) for d in docs]


@api_router.get("/analyses/history")
async def history(user: dict = Depends(get_current_user)):
    docs = await db.analyses.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", 1).to_list(500)
    groups = {}
    for d in docs:
        key = d.get("source_url") or d["title"]
        groups.setdefault(key, []).append({"id": d["id"], "score": d["overall_score"], "created_at": d["created_at"], "title": d["title"]})
    return [{"key": k, "points": v} for k, v in groups.items() if len(v) >= 1]


@api_router.get("/analyses/{aid}")
async def get_analysis(aid: str, user: dict = Depends(get_current_user)):
    doc = await db.analyses.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return doc


@api_router.delete("/analyses/{aid}")
async def delete_analysis(aid: str, user: dict = Depends(get_current_user)):
    res = await db.analyses.delete_one({"id": aid, "user_id": user["id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return {"ok": True}


@api_router.post("/analyses/{aid}/simulate")
async def simulate(aid: str, body: SimulateInput, user: dict = Depends(get_current_user)):
    doc = await db.analyses.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    system = """You simulate how a generative AI search engine (like Perplexity or Google AI Overview) would answer a user's query using ONLY the provided page content. Respond with ONLY valid minified JSON."""
    prompt = f"""User query: "{body.query}"

PAGE TITLE: {doc['title']}
PAGE CONTENT (truncated):
\"\"\"{doc.get('body_preview','')}\"\"\"

Return JSON:
{{"would_cite": <bool>, "confidence": <0-100>, "simulated_answer": "the answer an AI engine would generate, citing this page where relevant", "cited_snippets": ["exact quotable snippets it would pull"], "missing_for_citation": "what the page lacks to be cited more confidently"}}"""
    sim = await llm_json(system, prompt, f"sim-{aid}")
    sim["query"] = body.query
    sim["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.analyses.update_one({"id": aid}, {"$push": {"simulations": sim}})
    return sim


@api_router.post("/analyses/{aid}/gaps")
async def gaps(aid: str, user: dict = Depends(get_current_user)):
    doc = await db.analyses.find_one({"id": aid, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Analysis not found")
    system = """You are an SEO/AEO research expert. Given a page's topic and content, identify real user questions (People-Also-Ask style) that are NOT adequately answered by the content. Respond with ONLY valid minified JSON."""
    prompt = f"""PAGE TITLE: {doc['title']}
TARGET QUERY: {doc.get('target_query') or '(infer)'}
CONTENT (truncated):
\"\"\"{doc.get('body_preview','')}\"\"\"

Return JSON:
{{"gaps": [{{"question":"real user question","relevance":<0-100>,"volume":"high|medium|low","covered":<bool>,"why":"why it matters / what to add"}}]}}
Provide 8-12 questions, ranked by relevance desc, mostly ones NOT covered by the content."""
    res = await llm_json(system, prompt, f"gaps-{aid}")
    gap_list = res.get("gaps", [])
    await db.analyses.update_one({"id": aid}, {"$set": {"question_gaps": gap_list}})
    return {"gaps": gap_list}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[os.environ.get('FRONTEND_URL', 'http://localhost:3000')],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@geo.com")
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password),
                                   "name": "Admin", "role": "admin", "created_at": datetime.now(timezone.utc).isoformat()})
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
