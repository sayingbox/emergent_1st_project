from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import re
import json
import asyncio
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
from urllib.parse import urlparse, urlunparse, urljoin

import tinyfish_client as tf

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']

# Ensure Playwright can locate the pre-installed Chromium in this environment
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/pw-browsers")
PW_EXECUTABLE = os.environ.get("PLAYWRIGHT_CHROME_EXECUTABLE_PATH")

# Hardcoded superadmins: always full access regardless of any plan/feature restrictions
SUPERADMIN_EMAILS = {"kiskobiswal@gmail.com"}


def apply_entitlements(user: dict) -> dict:
    email = (user.get("email") or "").lower()
    if email in SUPERADMIN_EMAILS:
        user["role"] = "admin"
        user["full_access"] = True
    else:
        user["full_access"] = user.get("role") == "admin"
    # Attach plan/subscription info (best-effort — subscriptions module is loaded later)
    try:
        from subscriptions import entitlements_for
        user["entitlements"] = entitlements_for(user)
    except Exception:
        user["entitlements"] = None
    return user

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---------------- Auth helpers ----------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str, minutes: int = 120) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, days: int = 7) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=days), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


REMEMBER_DAYS = 15


def set_auth_cookies(response: Response, access: str, refresh: str, remember: bool = False):
    # Default (non-remember) session lasts 2 hours; with "remember me" it lasts REMEMBER_DAYS (15) days.
    access_max = REMEMBER_DAYS * 86400 if remember else 7200
    refresh_max = REMEMBER_DAYS * 86400 if remember else 604800
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=access_max, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=refresh_max, path="/")


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
        # Carry plan / subscription info through to callers
        for k in ("plan", "subscription_status", "plan_expires_at", "plan_started_at"):
            user.setdefault(k, user.get(k))
        return apply_entitlements(user)
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
    remember: bool = False


class AnalyzeInput(BaseModel):
    input_type: str  # "url" or "text"
    content: str
    target_query: Optional[str] = None


class SimulateInput(BaseModel):
    query: str


# ---------------- Content ingestion ----------------
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

# Headers sent on every outbound page fetch. Explicitly disable HTTP caching so a re-scan
# after the user updates their site returns fresh content, not a stale CDN copy.
NO_CACHE_HEADERS = {
    "User-Agent": UA,
    "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


def _bust_cache_url(url: str) -> str:
    """Append a random query parameter so upstream CDNs / edge caches must revalidate."""
    try:
        parsed = urlparse(url)
        cb = f"_cb={int(datetime.now(timezone.utc).timestamp())}{secrets.token_hex(2)}"
        new_query = f"{parsed.query}&{cb}" if parsed.query else cb
        return urlunparse(parsed._replace(query=new_query))
    except Exception:
        return url


def _visible_word_count(html: str) -> int:
    try:
        soup = BeautifulSoup(html, "lxml")
        for t in soup(["script", "style", "noscript"]):
            t.decompose()
        return len(soup.get_text(" ", strip=True).split())
    except Exception:
        return 0


async def render_html(url: str) -> str:
    """Render a JS-heavy page with headless Chromium."""
    from playwright.async_api import async_playwright
    exec_path = PW_EXECUTABLE if (PW_EXECUTABLE and os.path.exists(PW_EXECUTABLE)) else None
    if not exec_path and os.path.exists("/usr/local/bin/browser-use-chromium"):
        exec_path = "/usr/local/bin/browser-use-chromium"
    async with async_playwright() as p:
        launch_kwargs = {"args": ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-application-cache"]}
        if exec_path:
            launch_kwargs["executable_path"] = exec_path
        browser = await p.chromium.launch(**launch_kwargs)
        try:
            # Fresh incognito context + disabled HTTP cache => never serve a stale page on re-scan
            context = await browser.new_context(user_agent=UA, bypass_csp=True, extra_http_headers={
                "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
                "Pragma": "no-cache",
            })
            page = await context.new_page()
            try:
                await context.set_extra_http_headers({"Cache-Control": "no-cache, no-store", "Pragma": "no-cache"})
            except Exception:
                pass
            await page.goto(_bust_cache_url(url), wait_until="domcontentloaded", timeout=20000)
            # Short settle for lazy JS content; 800 ms is enough for hydration on
            # most SSR/SPA hybrids and shaves ~700 ms per scan vs the old 1500 ms.
            await page.wait_for_timeout(800)
            return await page.content()
        finally:
            await browser.close()


async def fetch_html(url: str) -> str:
    """Fetch a URL; fall back to a headless browser for JS-heavy / thin pages.

    Cache-busts every request (fresh query param + no-cache headers) so a re-scan
    after the user updates their content never returns the previous copy.
    """
    static_html = ""
    status = None
    fetch_url = _bust_cache_url(url)
    try:
        # asyncio.to_thread → non-blocking so the event loop keeps serving other
        # requests (poll, /alerts, /auth/me) while we wait on the target site.
        r = await asyncio.to_thread(requests.get, fetch_url, headers=NO_CACHE_HEADERS, timeout=12)
        status = r.status_code
        static_html = r.text
    except Exception as e:
        logger.warning(f"static fetch failed for {url}: {e}")

    # Hard-fail on definitively missing pages so we never analyze a 404/gone page as if it were content
    if status in (404, 410):
        raise RuntimeError(f"The page returned HTTP {status} (page not found). Check the URL is correct and publicly accessible.")

    static_words = _visible_word_count(static_html) if (static_html and status and status < 400) else 0
    # 120-word threshold: bumped down from 250 so we don't launch Chromium for
    # every legitimately short blog post / landing page. Chromium adds ~5-15s
    # per scan, so we only fall back when the static HTML is truly thin
    # (client-rendered SPA) or the fetch failed outright.
    if static_words >= 120:
        return static_html

    # Thin / client-rendered page -> render with Chromium
    try:
        rendered = await asyncio.wait_for(render_html(url), timeout=35)
        if rendered and _visible_word_count(rendered) > static_words:
            logger.info(f"rendered {url} via Chromium ({_visible_word_count(rendered)} words vs {static_words} static)")
            return rendered
    except asyncio.TimeoutError:
        logger.warning(f"render fallback timed out for {url} after 35s")
    except Exception as e:
        logger.warning(f"render fallback failed for {url}: {e}")

    if static_html and status and status < 400:
        return static_html
    raise RuntimeError("Could not fetch page content — the URL may be unreachable or blocking automated access.")


def fetch_url(url: str) -> str:
    r = requests.get(url, headers={"User-Agent": UA}, timeout=15)
    r.raise_for_status()
    return r.text


def normalize_content(input_type: str, content: str, prefetched_html: str = None) -> dict:
    url = None
    if input_type == "url":
        url = content.strip()
        html = prefetched_html if prefetched_html is not None else fetch_url(url)
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


async def llm_json(system: str, prompt: str, session: str, max_tokens: int = 4096) -> dict:
    """Call Claude Sonnet 4.6 with a hard timeout and one automatic retry.

    Prior behaviour: no timeout (a hung Anthropic connection would hold the
    request until the client polling window expired, showing "failed" to the
    user with no useful signal). Now: 90 s hard cap + one retry on transient
    failures + a specific, actionable HTTPException message on final failure.
    """
    last_err: Optional[Exception] = None
    for attempt in range(2):  # initial + 1 retry
        try:
            chat = LlmChat(
                api_key=EMERGENT_LLM_KEY,
                session_id=session,
                system_message=system,
            ).with_model("anthropic", "claude-sonnet-4-6").with_params(max_tokens=max_tokens)
            resp = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=90)
            raw = strip_json(resp if isinstance(resp, str) else str(resp))
            try:
                return json.loads(raw)
            except Exception:
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    return json.loads(m.group(0))
                # JSON parse failure is not retryable — model returned prose;
                # retry once with a stricter session key so we don't keep the
                # same (bad) response cached.
                raise RuntimeError("AI returned an unparseable response")
        except asyncio.TimeoutError as e:
            last_err = e
            logger.warning(f"llm_json timeout on attempt {attempt + 1} for session={session}")
        except Exception as e:
            last_err = e
            logger.warning(f"llm_json error on attempt {attempt + 1} for session={session}: {e}")
        # Backoff before retry
        if attempt == 0:
            await asyncio.sleep(1.2)
    # Final failure — surface a clean message
    detail = "AI is taking too long to respond right now — please retry in a moment."
    if isinstance(last_err, asyncio.TimeoutError):
        detail = "AI request timed out. This can happen if the content is very large. Please retry — a fresh attempt usually succeeds."
    raise HTTPException(status_code=502, detail=detail)


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
    return apply_entitlements({"id": uid, "email": email, "name": body.name, "role": "user"})


@api_router.post("/auth/login")
async def login(body: LoginInput, response: Response):
    email = body.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    uid = str(user["_id"])
    # Non-remember sessions: 2 hours (matches cookie max-age). Remember-me: REMEMBER_DAYS (15 days).
    minutes = REMEMBER_DAYS * 1440 if body.remember else 120
    days = REMEMBER_DAYS if body.remember else 7
    set_auth_cookies(response, create_access_token(uid, email, minutes=minutes), create_refresh_token(uid, days=days), remember=body.remember)
    payload = {
        "id": uid, "email": email, "name": user.get("name", "User"),
        "role": user.get("role", "user"),
        "plan": user.get("plan"),
        "subscription_status": user.get("subscription_status"),
        "plan_expires_at": user.get("plan_expires_at"),
        "plan_started_at": user.get("plan_started_at"),
    }
    return apply_entitlements(payload)


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


async def _run_analysis(job_id: str, user_id: str, body: AnalyzeInput):
    start = datetime.now(timezone.utc)
    try:
        if body.input_type == "url":
            html = await fetch_html(body.content.strip())
            # normalize_content is CPU-bound (BeautifulSoup parse) but fast enough
            # to keep on the event loop for typical page sizes.
            norm = normalize_content("url", body.content.strip(), prefetched_html=html)
        else:
            norm = normalize_content(body.input_type, body.content)
    except Exception as e:
        logger.warning(f"analysis {job_id}: fetch/parse failed: {e}")
        await db.analyses.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(e)}})
        return

    # Guard: if we ended up with almost no body, tell the user (instead of asking Claude to hallucinate).
    if (norm.get("word_count") or 0) < 40:
        await db.analyses.update_one({"id": job_id}, {"$set": {
            "status": "error",
            "error": "The fetched page has almost no readable text. If it's a JavaScript-heavy site, please paste the content directly instead of the URL.",
        }})
        return

    try:
        fetch_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        # Unique session per job => no carryover; a re-run on improved content yields a fresh report
        analysis = await llm_json(ANALYSIS_SYSTEM, analysis_prompt(norm, body.target_query), f"analyze-{job_id}")
        total_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        logger.info(f"analysis {job_id} completed in {total_ms} ms (fetch/parse: {fetch_ms} ms)")
        result = {
            "source_url": norm.get("source_url"),
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
        }
        await db.analyses.update_one({"id": job_id}, {"$set": {**result, "status": "done"}})
    except HTTPException as he:
        logger.warning(f"analysis {job_id}: LLM failure: {he.detail}")
        await db.analyses.update_one({"id": job_id}, {"$set": {"status": "error", "error": he.detail}})
    except Exception as e:
        logger.exception(f"analysis failed for job {job_id}")
        await db.analyses.update_one({"id": job_id}, {"$set": {"status": "error", "error": "Unexpected error during analysis. Please retry."}})


@api_router.post("/analyses")
async def create_analysis(body: AnalyzeInput, user: dict = Depends(get_current_user)):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content is required")
    job_id = secrets.token_hex(12)
    doc = {
        "id": job_id,
        "user_id": user["id"],
        "input_type": body.input_type,
        "source_url": body.content.strip() if body.input_type == "url" else None,
        "target_query": body.target_query,
        "title": body.content.strip() if body.input_type == "url" else "Pasted content",
        "status": "processing",
        "simulations": [],
        "question_gaps": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.analyses.insert_one(doc)
    asyncio.create_task(_run_analysis(job_id, user["id"], body))
    return {"id": job_id, "status": "processing"}


@api_router.get("/analyses")
async def list_analyses(user: dict = Depends(get_current_user)):
    docs = await db.analyses.find({"user_id": user["id"], "status": {"$ne": "processing"}}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [summary_of(d) for d in docs if d.get("status", "done") == "done"]


@api_router.get("/analyses/history")
async def history(user: dict = Depends(get_current_user)):
    docs = await db.analyses.find({"user_id": user["id"], "status": {"$ne": "processing"}}, {"_id": 0}).sort("created_at", 1).to_list(500)
    groups = {}
    for d in docs:
        if d.get("status", "done") != "done":
            continue
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


# ---------------- GEO Platform: Domain / Visibility / Citations / Reddit ----------------
class DomainInput(BaseModel):
    domain: str


class VisibilityInput(BaseModel):
    brand: str
    domain: Optional[str] = None
    prompts: List[str]


class CitationInput(BaseModel):
    query: str
    domain: Optional[str] = None


class RedditInput(BaseModel):
    topic: str


class SentimentInput(BaseModel):
    topic: str


class BrandConsistencyInput(BaseModel):
    query: Optional[str] = None
    brand: Optional[str] = None
    domain: Optional[str] = None


class PRInput(BaseModel):
    query: Optional[str] = None
    brand: Optional[str] = None
    domain: Optional[str] = None


class AgentChatInput(BaseModel):
    message: str
    session_id: Optional[str] = None


class ProjectInput(BaseModel):
    domain: str


from urllib.parse import urlparse, urljoin  # noqa: F811 (re-import for local readability)


ENGINES_CHECKED = ["ChatGPT", "Claude", "Perplexity", "Gemini", "Google AI", "Copilot", "Grok"]

# ---------- Crawl-first business discovery ----------
CRAWL_LINK_KEYWORDS = [
    "service", "solution", "product", "about", "what-we-do", "platform",
    "industr", "use-case", "offering", "capabilit", "technolog", "expertise",
    "company", "who-we-are", "features", "pricing",
]


def _page_from_html(url: str, html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    for t in soup(["script", "style", "noscript", "nav", "footer", "header", "svg", "form"]):
        t.decompose()
    title = soup.title.string.strip() if (soup.title and soup.title.string) else None
    headings = [h.get_text(" ", strip=True) for h in soup.find_all(["h1", "h2", "h3"]) if h.get_text(strip=True)][:20]
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return {"url": url, "title": title, "headings": headings, "text": text[:6000]}


async def crawl_business(domain: str, max_internal: int = 3) -> dict:
    """Crawl the real website: homepage + a few key internal pages for business discovery."""
    homepage_html = ""
    base = f"https://{domain}"
    for candidate in (f"https://{domain}", f"http://{domain}"):
        try:
            homepage_html = await fetch_html(candidate)
            base = candidate
            break
        except Exception as e:
            logger.warning(f"crawl: fetch failed for {candidate}: {e}")

    pages, title, meta_description = [], None, None
    if homepage_html:
        soup = BeautifulSoup(homepage_html, "lxml")
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        md = soup.find("meta", attrs={"name": "description"}) or soup.find("meta", attrs={"property": "og:description"})
        if md and md.get("content"):
            meta_description = md.get("content").strip()
        pages.append(_page_from_html(base, homepage_html))
        visited = {base.rstrip("/")}

        scored = {}
        for a in soup.find_all("a", href=True):
            full = urljoin(base, a["href"].strip()).split("#")[0].rstrip("/")
            p = urlparse(full)
            if p.scheme not in ("http", "https") or domain not in p.netloc:
                continue
            if not full or full in visited or full in scored:
                continue
            path, anchor = p.path.lower(), a.get_text(" ", strip=True).lower()
            sc = sum(1 for kw in CRAWL_LINK_KEYWORDS if kw in path) + sum(1 for kw in CRAWL_LINK_KEYWORDS if kw in anchor)
            if sc > 0:
                scored[full] = sc
        for u in sorted(scored, key=lambda x: -scored[x])[:max_internal]:
            try:
                pages.append(_page_from_html(u, await fetch_html(u)))
            except Exception:
                continue

    return {"title": title, "meta_description": meta_description, "pages": pages, "crawl_ok": bool(pages)}


# ---------- Live-URL verification for citations ----------
_LIVE_STATUSES = {200, 201, 202, 203, 204, 301, 302, 303, 307, 308, 401, 403, 405, 406, 429}


def _check_url_live(url: str) -> bool:
    try:
        r = requests.head(url, headers={"User-Agent": UA}, timeout=6, allow_redirects=True)
        if r.status_code in _LIVE_STATUSES:
            return True
        r = requests.get(url, headers={"User-Agent": UA}, timeout=8, allow_redirects=True, stream=True)
        return r.status_code in _LIVE_STATUSES
    except Exception:
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=8, allow_redirects=True, stream=True)
            return r.status_code in _LIVE_STATUSES
        except Exception:
            return False


async def verify_live_urls(urls: list) -> dict:
    sem = asyncio.Semaphore(12)

    async def one(u):
        async with sem:
            return u, await asyncio.to_thread(_check_url_live, u)

    results = await asyncio.gather(*[one(u) for u in urls])
    return {u: ok for u, ok in results}


def _norm_slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _mentions_brand(brand_term: str, *texts) -> bool:
    """True if the brand (whole slug, or its longest significant token) appears
    in any of the provided texts. Filters out namesake / unrelated results."""
    blob = _norm_slug(" ".join([t or "" for t in texts]))
    if not blob:
        return False
    whole = _norm_slug(brand_term)
    if whole and whole in blob:
        return True
    toks = [t for t in (re.sub(r"[^a-z0-9]", "", w.lower()) for w in re.split(r"\s+", brand_term or "")) if len(t) >= 3]
    if not toks:
        return bool(whole) and whole in blob
    longest = max(toks, key=len)
    return len(longest) >= 3 and longest in blob


async def real_citation_sources(brand: str, domain: Optional[str]) -> list:
    """Find REAL third-party citation sources for a brand via web search
    (TinyFish when configured, DuckDuckGo fallback otherwise), then HTTP-verify
    every URL. Never returns model-invented links."""
    if not brand:
        return []
    site_queries = [
        f"{brand} site:wikipedia.org", f"{brand} site:crunchbase.com",
        f"{brand} site:linkedin.com", f"{brand} site:g2.com",
        f"{brand} site:capterra.com", f"{brand} site:trustpilot.com",
        f"{brand} site:producthunt.com", f"{brand} site:youtube.com",
        f"{brand} site:reddit.com", f"{brand} site:github.com",
    ]
    general = [brand, f"{brand} review", f'"{brand}"']
    web_batches = await tf.tf_search_many(site_queries + general, max_results=3)
    news = await tf.tf_search(brand, domain_type="news", max_results=6)

    own = tf.root_domain(tf.host_of(domain)) if domain else None
    seen, cites = set(), []

    def add(r, dt="web"):
        url = r.get("url", "")
        host = tf.root_domain(tf.host_of(url))
        if not url or url in seen or (own and host == own):
            return
        if host in ("google.com", "bing.com", "duckduckgo.com", "yahoo.com") or "/goto?" in url or "/url?" in url:
            return
        if not _mentions_brand(brand, url, r.get("title"), r.get("snippet")):
            return
        seen.add(url)
        cites.append({
            "source": r.get("site_name") or host,
            "domain": host,
            "url": url,
            "title": r.get("title"),
            "type": tf.type_for(url, dt),
            "authority": tf.authority_for(url),
            "why": r.get("snippet") or "",
            "verified": False,
        })

    for batch in web_batches:
        for r in batch:
            add(r, "web")
    for r in news:
        add(r, "news")

    # HTTP-verify liveness — drop any dead links so we NEVER show unverified sources
    liveness = await verify_live_urls([c["url"] for c in cites])
    cites = [c for c in cites if liveness.get(c["url"])]
    for c in cites:
        c["verified"] = True
    cites.sort(key=lambda c: -c.get("authority", 0))
    return cites[:50]


DOMAIN_SYSTEM = """You are a world-class GEO/AEO (Generative & Answer Engine Optimization) analyst running a strict CRAWL-FIRST analysis.
You are given the ACTUAL crawled content of a company's website. Work in this exact order:
1) BUSINESS DISCOVERY: from the crawled content ONLY, determine the company's real core business and the specific services/products they actually offer. Never invent services the site does not mention.
2) TOPIC IDENTIFICATION: derive the topics they are genuinely relevant for, directly from those discovered services.
3) AI SEARCH RANKING: for each topic, estimate whether and where the brand surfaces in AI Search (ChatGPT, Claude, Gemini, Perplexity, Google AI, Copilot, Grok).
4) VERIFIED CITATIONS: list the real third-party sources (with specific, real, currently-live URLs) that AI engines pull this brand's information from. Only provide REAL URLs you are confident actually resolve (official pages, Wikipedia, LinkedIn company page, Crunchbase, G2, Capterra, Trustpilot, Clutch, Glassdoor, YouTube, well-known news/industry outlets). Do NOT fabricate deep URLs or invented slugs.
5) RANKING PROMPTS: generate search-style ranking prompts based ONLY on the discovered business topics (e.g. 'content moderation company', 'trust and safety services').
6) COMPETITORS: identify real companies competing for the SAME AI answers on those topics.
Ground everything in the crawl plus your market knowledge of the brand. Be realistic: obscure brands get low scores and short lists.
Respond with ONLY valid minified JSON. No markdown. No prose."""


def domain_prompt(domain: str, crawl: dict) -> str:
    pages_ctx = [{
        "url": pg["url"],
        "title": pg.get("title"),
        "headings": pg.get("headings", [])[:15],
        "excerpt": pg.get("text", "")[:2500],
    } for pg in crawl.get("pages", [])]
    crawl_json = json.dumps({
        "homepage_title": crawl.get("title"),
        "meta_description": crawl.get("meta_description"),
        "pages_crawled": pages_ctx,
    })[:15000]
    crawl_note = "" if crawl.get("crawl_ok") else "\n(NOTE: the live crawl returned little/no content — fall back to your own knowledge of this brand, and lower confidence/scores accordingly.)"

    return f"""TARGET DOMAIN: "{domain}"

Below is the ACTUAL crawled content from this website (homepage + key internal pages). Base the ENTIRE analysis on it.{crawl_note}

CRAWLED_CONTENT:
{crawl_json}

Return valid minified JSON with EXACTLY this schema:
{{
 "domain": "{domain}",
 "brand": "official brand/product name (from the crawl)",
 "brand_summary": "1-2 sentence factual description of what this company does, grounded in the crawl",
 "ai_readiness_score": <0-100 overall: how well this brand can be surfaced/cited by AI engines>,
 "known_by_ai": <bool - do major generative engines likely know this brand>,
 "discovered_services": [
   {{"name":"a specific service/product ACTUALLY offered per the crawl","evidence":"short phrase from the site proving it"}}
 ],
 "metrics": {{
   "domain_authority": <0-100 Moz-style DA estimate>,
   "page_authority": <0-100 estimate for the homepage>,
   "trust_score": <0-100>,
   "estimated_backlinks": "human-readable string, e.g. '48K' or '2.1M' or '350'",
   "referring_domains": "human-readable string, e.g. '3.1K' or '120'",
   "estimated_monthly_traffic": "human-readable string, e.g. '2.4M' or '18K'"
 }},
 "categories": [
   {{"label":"Brand Authority","score":<0-100>,"note":"one-line explanation"}},
   {{"label":"Content Depth","score":<0-100>,"note":"..."}},
   {{"label":"Structured Data","score":<0-100>,"note":"..."}},
   {{"label":"Citation Worthiness","score":<0-100>,"note":"..."}},
   {{"label":"Topical Coverage","score":<0-100>,"note":"..."}}
 ],
 "top_topics": [
   {{"topic":"business topic derived DIRECTLY from the discovered services","authority":<0-100>,"relevance":<0-100>}}
 ],
 "ai_search_rankings": [
   {{"topic":"MUST be one of top_topics.topic","ranks":<bool - does the brand surface in AI answers for this topic>,"engines":["chatgpt","claude","gemini","perplexity","google_ai","copilot","grok"],"position":"top|recommended|passing|not_ranking","note":"why it does/doesn't surface"}}
 ],
 "citation_sources": [
   {{"source":"publication/site name AI pulls brand info from","url":"REAL, currently-live URL (must actually resolve — no invented slugs)","type":"encyclopedia|review|news|directory|social|official|forum|academic|blog|video|podcast|documentation","authority":<0-100>,"why":"what info AI extracts about the brand from here"}}
 ],
 "ranking_prompts": [
   {{"prompt":"a natural search-style query based on a discovered topic, e.g. 'content moderation company'","topic":"MUST be one of top_topics.topic","position":"top|recommended|passing","engines":["chatgpt","perplexity","gemini","claude","google_ai","copilot","grok"],"intent":"informational|commercial|navigational|comparison"}}
 ],
 "quick_wins": [
   {{"priority":"high|medium|low","action":"specific, concrete action to improve AI visibility for the discovered topics"}}
 ],
 "competitors": [
   {{"domain":"competitor root domain, e.g. 'besedo.com'","topic":"the shared discovered topic they compete on in AI search","note":"why they compete for the same AI answers"}}
 ]
}}

STRICT REQUIREMENTS — non-negotiable:
- discovered_services: 4-10 items, ONLY services evidenced by the crawled content.
- top_topics: 5-10, derived DIRECTLY from discovered_services, sorted by relevance desc.
- ai_search_rankings: EXACTLY one entry per top_topic (same order).
- ranking_prompts: 15-30, each `topic` MUST be one of top_topics[].topic; short natural queries spread across topics with mixed intents; sort top → recommended → passing.
- citation_sources: 20-40 entries, each with a REAL live URL (no fabricated slugs); ranked by authority desc.
- competitors: 5-10 real companies competing for the SAME topics in AI search.
- categories: exactly the 5 listed.
- quick_wins: 5-8 items.
- All numeric scores are integers 0-100.
- Output must be a SINGLE valid minified JSON object. No trailing commas. No markdown fences."""


async def _run_domain_analysis(job_id: str, user_id: str, domain: str):
    try:
        # 1) Crawl-first business discovery
        crawl = await crawl_business(domain)

        # 2-6) LLM analysis grounded in the crawl
        res = await llm_json(DOMAIN_SYSTEM, domain_prompt(domain, crawl), f"domain-{job_id}", max_tokens=12000)

        # Normalise + defensively filter
        top_topics_raw = res.get("top_topics", []) or []
        top_topics = []
        for t in top_topics_raw:
            if isinstance(t, dict) and t.get("topic"):
                top_topics.append({
                    "topic": str(t.get("topic")).strip(),
                    "authority": int(t.get("authority", 0) or 0),
                    "relevance": int(t.get("relevance", 0) or 0),
                })
            elif isinstance(t, str):
                top_topics.append({"topic": t.strip(), "authority": 0, "relevance": 0})
        topic_names_lower = {t["topic"].lower() for t in top_topics}

        def _tie_topic(topic: str) -> str:
            topic = (topic or "").strip()
            tlc = topic.lower()
            if not top_topics:
                return topic
            if tlc in topic_names_lower or any(tlc and (tlc in tn or tn in tlc) for tn in topic_names_lower):
                return topic
            return top_topics[0]["topic"]

        # Discovered services (crawl-grounded)
        discovered_services = []
        for s in (res.get("discovered_services", []) or []):
            if isinstance(s, dict) and s.get("name"):
                discovered_services.append({"name": str(s.get("name")).strip(), "evidence": str(s.get("evidence", "")).strip()})
            elif isinstance(s, str) and s.strip():
                discovered_services.append({"name": s.strip(), "evidence": ""})

        # AI search rankings per topic
        ai_search_rankings = []
        for a in (res.get("ai_search_rankings", []) or []):
            if not isinstance(a, dict) or not a.get("topic"):
                continue
            ai_search_rankings.append({
                "topic": _tie_topic(str(a.get("topic")).strip()),
                "ranks": bool(a.get("ranks", False)),
                "engines": a.get("engines", []) or [],
                "position": a.get("position", "not_ranking"),
                "note": str(a.get("note", "")).strip(),
            })

        # Ranking prompts — enforce topic tie-in
        ranking_prompts = []
        for p in (res.get("ranking_prompts", []) or []):
            if not isinstance(p, dict) or not p.get("prompt"):
                continue
            ranking_prompts.append({
                "prompt": str(p.get("prompt")).strip(),
                "topic": _tie_topic(str(p.get("topic", "")).strip()),
                "position": p.get("position", "passing"),
                "engines": p.get("engines", []) or [],
                "intent": p.get("intent", "informational"),
            })
        pos_order = {"top": 0, "recommended": 1, "passing": 2}
        ranking_prompts.sort(key=lambda r: pos_order.get(r.get("position"), 3))

        # Citation sources — prefer REAL sources from TinyFish live search.
        # Fall back to LLM-suggested + HTTP-verified only if search yields nothing.
        citation_sources = await real_citation_sources(res.get("brand") or domain, domain)
        if not citation_sources:
            raw_cites = []
            for c in (res.get("citation_sources", []) or []):
                if not isinstance(c, dict) or not c.get("source"):
                    continue
                url = str(c.get("url", "")).strip()
                if url and not url.startswith("http"):
                    url = "https://" + url.lstrip("/")
                if not url:
                    continue  # cannot verify a source without a URL
                raw_cites.append({
                    "source": str(c.get("source")).strip(),
                    "url": url,
                    "type": c.get("type", "reference"),
                    "authority": int(c.get("authority", 0) or 0),
                    "why": c.get("why", ""),
                })

            liveness = await verify_live_urls(list({c["url"] for c in raw_cites}))
            for c in raw_cites:
                if liveness.get(c["url"]):
                    c["verified"] = True
                    citation_sources.append(c)
            citation_sources.sort(key=lambda c: -c.get("authority", 0))

        # Competitors (crawl/topic grounded) — support dict or plain string
        competitors = []
        for c in (res.get("competitors", []) or []):
            if isinstance(c, dict) and c.get("domain"):
                competitors.append({
                    "domain": str(c.get("domain")).strip(),
                    "topic": _tie_topic(str(c.get("topic", "")).strip()) if c.get("topic") else "",
                    "note": str(c.get("note", "")).strip(),
                })
            elif isinstance(c, str) and c.strip():
                competitors.append({"domain": c.strip(), "topic": "", "note": ""})

        metrics = res.get("metrics", {}) or {}
        result = {
            "data_source": "Crawl-first (live site crawl) + AI analysis (Claude Sonnet 4.6). Citation sources from TinyFish live web search (real URLs).",
            "brand": res.get("brand") or domain,
            "brand_summary": res.get("brand_summary", ""),
            "ai_readiness_score": int(res.get("ai_readiness_score", 0) or 0),
            "known_by_ai": bool(res.get("known_by_ai", False)),
            "crawl_ok": crawl.get("crawl_ok", False),
            "crawled_pages": [p["url"] for p in crawl.get("pages", [])],
            "discovered_services": discovered_services,
            "metrics": {
                "domain_authority": metrics.get("domain_authority"),
                "page_authority": metrics.get("page_authority"),
                "trust_score": metrics.get("trust_score"),
                "estimated_backlinks": metrics.get("estimated_backlinks"),
                "referring_domains": metrics.get("referring_domains"),
                "estimated_monthly_traffic": metrics.get("estimated_monthly_traffic"),
            },
            "categories": [c for c in (res.get("categories", []) or []) if isinstance(c, dict)],
            "engines_checked": ENGINES_CHECKED,
            "top_topics": top_topics,
            "ai_search_rankings": ai_search_rankings,
            "citation_sources": citation_sources,
            "ranking_prompts": ranking_prompts,
            "quick_wins": [q for q in (res.get("quick_wins", []) or []) if isinstance(q, dict)],
            "competitors": competitors,
        }
        await db.domains.update_one({"id": job_id}, {"$set": {**result, "status": "done"}})
    except Exception as e:
        logger.exception(f"domain analysis failed for {domain}")
        await db.domains.update_one({"id": job_id}, {"$set": {"status": "error", "error": str(e)}})


@api_router.post("/domain/analyze")
async def domain_analyze(body: DomainInput, user: dict = Depends(get_current_user)):
    domain = body.domain.strip().lower().replace("https://", "").replace("http://", "").strip("/").split("/")[0]
    if domain.startswith("www."):
        domain = domain[4:]
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Enter a valid domain, e.g. example.com")
    job_id = secrets.token_hex(12)
    doc = {"id": job_id, "user_id": user["id"], "domain": domain, "status": "processing",
           "created_at": datetime.now(timezone.utc).isoformat()}
    await db.domains.insert_one(doc)
    asyncio.create_task(_run_domain_analysis(job_id, user["id"], domain))
    return {"id": job_id, "domain": domain, "status": "processing"}


@api_router.get("/domain")
async def domain_list(user: dict = Depends(get_current_user)):
    docs = await db.domains.find({"user_id": user["id"], "status": {"$ne": "processing"}}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/domain/{job_id}")
async def domain_get(job_id: str, user: dict = Depends(get_current_user)):
    doc = await db.domains.find_one({"id": job_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc






@api_router.post("/visibility")
async def visibility(body: VisibilityInput, user: dict = Depends(get_current_user)):
    prompts = [p.strip() for p in body.prompts if p.strip()][:12]
    if not body.brand.strip() or not prompts:
        raise HTTPException(status_code=400, detail="Brand and at least one prompt are required")
    system = """You simulate how leading generative AI engines respond to user prompts, and whether a given brand is mentioned or recommended in those answers. Base this on your knowledge of the brand's real-world prominence. Respond with ONLY valid minified JSON."""
    prompt = f"""BRAND: {body.brand}{(' (' + body.domain + ')') if body.domain else ''}
For EACH of the following prompts, predict whether the brand would appear in AI answers across engines (ChatGPT, Claude, Perplexity, Google AI Overview, Gemini, Copilot, Grok).

PROMPTS:
{json.dumps(prompts)}

Return JSON:
{{
 "brand": "{body.brand}",
 "visibility_score": <0-100 overall across all prompts/engines>,
 "share_of_voice": <0-100 estimated vs competitors>,
 "results": [
   {{"prompt":"...","mentioned":<bool>,"position":"none|passing|recommended|top","sentiment":"positive|neutral|negative","engines":{{"chatgpt":<bool>,"claude":<bool>,"perplexity":<bool>,"google_ai":<bool>,"gemini":<bool>,"copilot":<bool>,"grok":<bool>}},"competitors_mentioned":["..."],"note":"why"}}
 ],
 "recommendations": ["how to increase AI visibility"]
}}
One result object per prompt, same order."""
    res = await llm_json(system, prompt, f"vis-{user['id']}")
    doc = {"id": secrets.token_hex(12), "user_id": user["id"], "brand": body.brand, "domain": body.domain,
           "created_at": datetime.now(timezone.utc).isoformat(), **res}
    await db.visibility.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/visibility")
async def visibility_list(user: dict = Depends(get_current_user)):
    docs = await db.visibility.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/citations")
async def citations(body: CitationInput, user: dict = Depends(get_current_user)):
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="Query is required")
    query = body.query.strip()
    dom = (body.domain or "").strip().lower() or None
    if dom:
        dom = dom.replace("https://", "").replace("http://", "").strip("/").split("/")[0]
        if dom.startswith("www."):
            dom = dom[4:]

    # 1) REAL search first (TinyFish if available, otherwise DuckDuckGo fallback).
    #    Every URL is a real search-engine result, then HTTP-verified live.
    web = await tf.tf_search(query, max_results=12)
    news = await tf.tf_search(query, domain_type="news", max_results=6)
    seen_hosts, sources = set(), []
    for r, dt in [(x, "web") for x in web] + [(x, "news") for x in news]:
        url = r.get("url", "")
        host = tf.root_domain(tf.host_of(url))
        if not url or not host or host in seen_hosts:
            continue
        if host in ("google.com", "bing.com", "duckduckgo.com", "yahoo.com") or "/goto?" in url or "/url?" in url:
            continue
        seen_hosts.add(host)
        sources.append({
            "domain": host,
            "url": url,
            "title": r.get("title") or "",
            "type": tf.type_for(url, dt),
            "authority": tf.authority_for(url),
            "likelihood": min(100, max(35, tf.authority_for(url) - 10)),
            "why": r.get("snippet") or "",
        })

    # HTTP-verify liveness — never show a dead source.
    liveness = await verify_live_urls([s["url"] for s in sources])
    sources = [s for s in sources if liveness.get(s["url"])]
    for s in sources:
        s["verified"] = True
    sources.sort(key=lambda s: -s.get("authority", 0))
    sources = sources[:12]

    # Compute user_domain citation status from verified sources
    user_domain_cited = None
    user_domain_rank = None
    recommendation = ""
    if dom:
        dom_root = tf.root_domain(dom)
        rank = next((i + 1 for i, s in enumerate(sources) if s["domain"] == dom_root), None)
        user_domain_cited = rank is not None
        user_domain_rank = rank
        if not user_domain_cited:
            recommendation = (
                f"{dom} is not yet cited for this query. Publish an authoritative page on the topic, "
                f"get listed on well-known industry directories/reviews, and pursue mentions in the top-ranked sources above."
            )

    # 2) Fallback: only if real search returned nothing at all
    if not sources:
        system = """You predict which web sources a generative AI engine would most likely cite when answering a query, based on your knowledge of authoritative sources for the topic. Every URL you return MUST be a real, currently-live homepage or well-known section URL (no invented deep slugs). Respond with ONLY valid minified JSON."""
        prompt = f"""QUERY: "{query}"
{f'USER DOMAIN TO CHECK: {dom}' if dom else ''}

Return JSON:
{{
 "sources": [{{"domain":"example.com","url":"https://example.com","title":"likely page/source","type":"official|editorial|community|reference|competitor","authority":<0-100>,"likelihood":<0-100>,"why":"why AI would cite it"}}],
 "recommendation": "how the user could earn a citation for this query"
}}
Provide 8-12 sources ranked by likelihood desc with real live URLs only."""
        try:
            res = await llm_json(system, prompt, f"cite-{user['id']}")
        except Exception as e:
            logger.warning(f"citations llm fallback failed: {e}")
            res = {}
        raw = [s for s in (res.get("sources") or []) if isinstance(s, dict) and s.get("domain")]
        # Attach URL and HTTP-verify
        for s in raw:
            u = (s.get("url") or "").strip()
            if not u:
                u = f"https://{s['domain']}"
            if not u.startswith(("http://", "https://")):
                u = "https://" + u.lstrip("/")
            s["url"] = u
        liveness = await verify_live_urls([s["url"] for s in raw])
        sources = [s for s in raw if liveness.get(s["url"])]
        for s in sources:
            s["verified"] = True
        recommendation = res.get("recommendation") or recommendation
        if dom:
            dom_root = tf.root_domain(dom)
            rank = next((i + 1 for i, s in enumerate(sources) if tf.root_domain(s.get("domain", "")) == dom_root), None)
            user_domain_cited = rank is not None
            user_domain_rank = rank

    doc = {
        "id": secrets.token_hex(12), "user_id": user["id"],
        "query": query, "domain": dom,
        "user_domain": dom,
        "user_domain_cited": user_domain_cited,
        "user_domain_rank": user_domain_rank,
        "sources": sources,
        "recommendation": recommendation,
        "data_source": "Live web search (real URLs) + HTTP liveness verification",
        "search_kind": "query",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.citations.insert_one(doc)
    doc.pop("_id", None)
    return doc


class CitationDomainInput(BaseModel):
    domain: str


@api_router.post("/citations/by-domain")
async def citations_by_domain(body: CitationDomainInput, user: dict = Depends(get_current_user)):
    """Find every third-party citation source that already mentions this domain/brand.

    Uses real web search (TinyFish or DuckDuckGo fallback) plus HTTP liveness
    verification — no LLM call, so this endpoint costs zero LLM credits."""
    dom = (body.domain or "").strip().lower().replace("https://", "").replace("http://", "").strip("/").split("/")[0]
    if dom.startswith("www."):
        dom = dom[4:]
    if not dom or "." not in dom:
        raise HTTPException(status_code=400, detail="Enter a valid domain, e.g. example.com")

    brand_term = tf.brand_name_from_domain(dom)
    sources = await real_citation_sources(brand_term, dom)
    doc = {
        "id": secrets.token_hex(12), "user_id": user["id"],
        "query": dom, "domain": dom,
        "user_domain": dom,
        "user_domain_cited": True if sources else False,
        "user_domain_rank": 1 if sources else None,
        "sources": sources,
        "recommendation": (
            "" if sources else
            f"No verified third-party citations of {dom} were found. Get listed on Wikipedia, "
            f"LinkedIn, Crunchbase, and industry review sites (G2, Capterra, Trustpilot) to seed AI citations."
        ),
        "data_source": "Live web search (real URLs) + HTTP liveness verification",
        "search_kind": "domain",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.citations.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/citations")
async def citations_list(user: dict = Depends(get_current_user)):
    docs = await db.citations.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/reddit")
async def reddit(body: RedditInput, user: dict = Depends(get_current_user)):
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="Topic is required")
    system = """You are a Reddit research expert. Given a topic, identify the most relevant subreddits and the kinds of high-engagement discussion threads where a brand could participate or be mentioned — since Reddit is heavily cited by generative AI engines. Respond with ONLY valid minified JSON."""
    prompt = f"""TOPIC: "{body.topic}"

Return JSON:
{{
 "topic": "{body.topic}",
 "subreddits": [{{"name":"r/example","members":"approx size e.g. 1.2M","relevance":<0-100>,"why":"why relevant"}}],
 "threads": [{{"title":"realistic representative thread title","subreddit":"r/example","angle":"the discussion angle","engagement":"high|medium|low","opportunity":"how a brand/content could add value or get mentioned"}}],
 "content_ideas": ["Reddit-native content angles that could earn mentions and AI citations"]
}}
Provide 5-8 subreddits (ranked by relevance) and 6-10 threads."""
    res = await llm_json(system, prompt, f"reddit-{user['id']}")
    doc = {"id": secrets.token_hex(12), "user_id": user["id"], "topic": body.topic,
           "created_at": datetime.now(timezone.utc).isoformat(), **res}
    await db.reddit.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/reddit")
async def reddit_list(user: dict = Depends(get_current_user)):
    docs = await db.reddit.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


BRAND_PLATFORMS = [
    ("LinkedIn", "social", "linkedin.com"),
    ("Facebook", "social", "facebook.com"),
    ("Instagram", "social", "instagram.com"),
    ("X (Twitter)", "social", "twitter.com"),
    ("YouTube", "social", "youtube.com"),
    ("Reddit", "social", "reddit.com"),
    ("Crunchbase", "directories", "crunchbase.com"),
    ("Wellfound", "directories", "wellfound.com"),
    ("AngelList", "directories", "angel.co"),
    ("Tracxn", "directories", "tracxn.com"),
    ("GoodFirms", "directories", "goodfirms.co"),
    ("IndieHackers", "directories", "indiehackers.com"),
    ("G2", "reviews", "g2.com"),
    ("Capterra", "reviews", "capterra.com"),
    ("Clutch", "reviews", "clutch.co"),
    ("Trustpilot", "reviews", "trustpilot.com"),
    ("Product Hunt", "reviews", "producthunt.com"),
    ("Gartner", "reviews", "gartner.com"),
]


@api_router.post("/brand")
async def brand_consistency(body: BrandConsistencyInput, user: dict = Depends(get_current_user)):
    q = (body.query or body.brand or body.domain or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Enter a brand name or domain")

    is_domain = tf.looks_like_domain(q)
    brand_term = tf.brand_name_from_domain(q) if is_domain else q
    domain_host = tf.root_domain(tf.host_of(q)) if is_domain else None

    # 1) Real per-platform searches (concurrent) -> real, verifiable listing URLs
    queries = [f"{brand_term} site:{site}" for (_, _, site) in BRAND_PLATFORMS]
    per_platform = await tf.tf_search_many(queries, max_results=4)

    platforms, evidence_for_llm = [], []
    # Collect all top-URL candidates for a single concurrent liveness check
    candidate_urls = set()
    prepared = []
    for (name, group, site), results in zip(BRAND_PLATFORMS, per_platform):
        matched = [r for r in results if tf.root_domain(tf.host_of(r.get("url", ""))) == site]
        # X profiles may live on x.com even when we searched twitter.com
        if name.startswith("X ") and not matched:
            matched = [r for r in results if tf.root_domain(tf.host_of(r.get("url", ""))) in ("x.com", "twitter.com")]
        # keep only results that actually reference the brand (drop namesakes/unrelated)
        matched = [r for r in matched if _mentions_brand(brand_term, r.get("url", ""), r.get("title", ""))]
        for r in matched[:3]:
            u = r.get("url")
            if u:
                candidate_urls.add(u)
        prepared.append((name, group, site, matched))
    liveness = await verify_live_urls(list(candidate_urls))
    for (name, group, site, matched) in prepared:
        live_matched = [r for r in matched if liveness.get(r.get("url"))]
        links = [{"title": r.get("title"), "url": r.get("url"), "snippet": r.get("snippet")} for r in live_matched[:3]]
        top = links[0] if links else None
        platforms.append({
            "platform": name, "group": group, "present": bool(links),
            "url": top["url"] if top else None,
            "name": top["title"] if top else None,
            "description": top["snippet"] if top else None,
            "links": links, "features": [], "pricing": None, "note": "",
            "verified": bool(links),
        })
        if links:
            evidence_for_llm.append({"platform": name, "results": links})

    # 2) Fetch the brand's own site (real) for canonical info
    home_url, home_text = None, ""
    if is_domain:
        home_url = f"https://{q}"
    else:
        web = await tf.tf_search(brand_term, max_results=5)
        if web:
            home_url = web[0].get("url")
            domain_host = tf.root_domain(tf.host_of(home_url))
    if home_url:
        fetched = await tf.tf_fetch([home_url], ttl=86400)
        rr = fetched.get("results") or []
        if rr:
            home_text = (rr[0].get("text") or "")[:5000]

    # 3) LLM structures canonical + per-platform features/pricing + inconsistencies
    #    from the REAL evidence only (never invents URLs)
    system = """You analyse brand-information CONSISTENCY across third-party platforms for AI/LLM discovery. You are given REAL search snippets and the brand's own website text. Use ONLY the provided evidence. Do NOT invent URLs, platforms, or facts not supported by the evidence. Respond with ONLY valid minified JSON."""
    prompt = f"""BRAND: {brand_term}{f' (domain: {domain_host})' if domain_host else ''}

BRAND WEBSITE TEXT (truncated):
\"\"\"{home_text}\"\"\"

REAL PLATFORM EVIDENCE (search snippets found on each platform):
{json.dumps(evidence_for_llm)[:9000]}

Return JSON:
{{
 "canonical": {{"name":"canonical brand name from evidence","description":"1-2 sentence description grounded in the website text","category":"e.g. SaaS / project management"}},
 "consistency_score": <0-100: how consistent the brand's name/description/positioning is across the platforms found>,
 "platform_analysis": [
   {{"platform":"<one of the platforms present in the evidence>","present_confidence":"found|uncertain","features":["features mentioned in that platform's snippet, if any"],"pricing":"pricing text if present in snippet else null","note":"short note on how this listing describes the brand / any mismatch"}}
 ],
 "inconsistencies": [{{"field":"name|description|features|pricing|category","severity":"high|medium|low","detail":"what differs across which platforms","platforms":["..."]}}],
 "recommendations": ["how to make brand info consistent and optimised for AI/LLM discovery"]
}}
Only include platforms in platform_analysis that appear in the evidence. Provide up to 8 inconsistencies and 4-8 recommendations. If evidence is sparse, give a lower consistency_score and note it in a recommendation."""
    llm = {}
    try:
        llm = await llm_json(system, prompt, f"brand-{user['id']}-{secrets.token_hex(4)}", max_tokens=4000)
    except Exception as e:
        logger.warning(f"brand llm structuring failed: {e}")

    by_platform = {p["platform"]: p for p in platforms}
    for pa in (llm.get("platform_analysis") or []):
        tgt = by_platform.get(pa.get("platform"))
        if not tgt:
            continue
        if isinstance(pa.get("features"), list):
            tgt["features"] = [str(x) for x in pa["features"]][:8]
        if pa.get("pricing"):
            tgt["pricing"] = pa["pricing"]
        if pa.get("note"):
            tgt["note"] = pa["note"]
        tgt["status"] = "uncertain" if (pa.get("present_confidence") == "uncertain" and tgt["present"]) else ("found" if tgt["present"] else "not_found")
    for p in platforms:
        p.setdefault("status", "found" if p["present"] else "not_found")

    canonical = llm.get("canonical") or {"name": brand_term, "description": "", "category": ""}
    doc = {
        "id": secrets.token_hex(12), "user_id": user["id"],
        "query": q, "brand": canonical.get("name") or brand_term, "domain": domain_host,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "TinyFish live web search (real listing URLs) + AI structuring",
        "consistency_score": int(llm.get("consistency_score", 0) or 0),
        "canonical": canonical,
        "platforms": platforms,
        "found_count": sum(1 for p in platforms if p["present"]),
        "inconsistencies": [x for x in (llm.get("inconsistencies") or []) if isinstance(x, dict)],
        "recommendations": [x for x in (llm.get("recommendations") or []) if isinstance(x, str)],
    }
    await db.brand_consistency.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/brand")
async def brand_consistency_list(user: dict = Depends(get_current_user)):
    docs = await db.brand_consistency.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/pr")
async def pr_coverage(body: PRInput, user: dict = Depends(get_current_user)):
    q = (body.query or body.brand or body.domain or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Enter a brand name or domain")
    is_domain = tf.looks_like_domain(q)
    brand_term = tf.brand_name_from_domain(q) if is_domain else q
    own = tf.root_domain(tf.host_of(q)) if is_domain else None

    # Real press: several web searches across multiple result pages -> more distinct URLs
    base_queries = [
        f'{brand_term} news',
        f'{brand_term} announcement',
        f'"{brand_term}" (funding OR raises OR seed OR "series a" OR launch OR announces OR partnership OR acquires)',
        f'"{brand_term}" (review OR interview OR feature OR profile OR spotlight OR "featured in")',
        f'"{brand_term}" (press release OR "announced today" OR PRNewswire OR "Business Wire")',
        f'"{brand_term}" (article OR coverage OR report OR magazine OR editorial)',
    ]
    tasks = []
    for bq in base_queries:
        for pg in (1, 2, 3):
            tasks.append(tf.tf_search(bq, max_results=15, page=pg))
    searches = await asyncio.gather(*tasks)
    REDIRECT_HOSTS = {"google.com", "bing.com", "duckduckgo.com", "news.google.com", "yahoo.com"}
    # NOT press: directories, review/listing sites, reference, social, community, app stores
    NON_PR_HOSTS = {
        "crunchbase.com", "wellfound.com", "angel.co", "tracxn.com", "goodfirms.co", "indiehackers.com",
        "g2.com", "capterra.com", "clutch.co", "trustpilot.com", "producthunt.com", "gartner.com",
        "getapp.com", "sourceforge.net", "slashdot.org", "saashub.com", "alternativeto.net", "softwareadvice.com",
        "glassdoor.com", "ambitionbox.com", "zoominfo.com", "apollo.io", "pitchbook.com", "owler.com",
        "6sense.com", "similarweb.com", "builtwith.com",
        "wikipedia.org", "wikidata.org", "fandom.com",
        "reddit.com", "x.com", "twitter.com", "youtube.com", "facebook.com", "instagram.com",
        "tiktok.com", "pinterest.com", "linkedin.com", "github.com", "teamblind.com", "quora.com",
        "stackoverflow.com", "ycombinator.com",
        "apps.apple.com", "play.google.com", "chrome.google.com",
    }
    # Paid PR distribution wires (vs organic editorial coverage)
    PR_WIRE_HOSTS = {
        "prnewswire.com", "businesswire.com", "globenewswire.com", "einnews.com", "einpresswire.com",
        "prweb.com", "accesswire.com", "prlog.org", "openpr.com", "issuewire.com", "newswire.com",
        "24-7pressrelease.com", "pressat.co.uk", "prunderground.com", "abnewswire.com", "newswirejet.com",
    }
    brand_slug = _norm_slug(brand_term)
    seen, press = set(), []
    for src_list in searches:
        for r in src_list:
            url = r.get("url", "")
            host = tf.root_domain(tf.host_of(url))
            first_label = host.split(".")[0] if host else ""
            is_own = (own and host == own) or (brand_slug and first_label == brand_slug)
            if not url or url in seen or is_own:
                continue
            if host in REDIRECT_HOSTS or host in NON_PR_HOSTS or "/goto?" in url or "/url?" in url:
                continue  # keep only real PR: 3rd-party media + press-release wires
            if not _mentions_brand(brand_term, url, r.get("title"), r.get("snippet")):
                continue
            seen.add(url)
            press.append({
                "publication": r.get("site_name") or host,
                "publication_domain": host,
                "headline": r.get("title"),
                "description": r.get("snippet"),
                "url": url, "date": r.get("date"),
                "type": "news",
                "pr_type": "paid" if host in PR_WIRE_HOSTS else "organic",
            })
    press = press[:50]

    # HTTP-verify every press link — never surface a dead article to the user.
    liveness = await verify_live_urls([p["url"] for p in press])
    press = [p for p in press if liveness.get(p["url"])]
    for p in press:
        p["verified"] = True

    # LLM verifies relevance + classifies editorial type, and builds a real-outlet pitch list.
    system = """You are a PR analyst. You are given REAL press search results (with real URLs) about a brand. (1) For each result decide if it is genuine press coverage of THIS brand (exclude namesakes and non-press pages) and classify its type. Use ONLY the provided URLs; never invent new ones. (2) Build a media pitch list of real, well-known outlets relevant to this brand, grouped by category. Respond with ONLY valid minified JSON."""
    prompt = f"""BRAND: {brand_term}

REAL PRESS RESULTS:
{json.dumps([{'i': i, 'publication': p['publication'], 'headline': p['headline'], 'snippet': p['description'], 'url': p['url']} for i, p in enumerate(press)])[:14000]}

Return JSON:
{{
 "press": [{{"i":<index from the list above>,"relevant":<bool - genuine press coverage of the brand>,"type":"news|feature|review|funding|interview|launch|press-release|listicle|podcast"}}],
 "pitch_categories": [
   {{"category":"Tech","outlets":[{{"outlet":"TechCrunch","beat":"startups / product launches","why":"why relevant to this brand","domain":"techcrunch.com"}}]}}
 ]
}}
For "press" return one object PER index above (do not skip indices); set relevant=false only for clear namesakes / non-press pages. Provide 5-7 pitch categories with 4-6 real outlets each (real outlet domains)."""
    llm = {}
    try:
        llm = await llm_json(system, prompt, f"pr-{user['id']}-{secrets.token_hex(4)}", max_tokens=6000)
    except Exception as e:
        logger.warning(f"pr llm failed: {e}")

    verdicts = {v.get("i"): v for v in (llm.get("press") or []) if isinstance(v, dict)}
    final_press = []
    for i, p in enumerate(press):
        v = verdicts.get(i)
        if v is not None and v.get("relevant") is False:
            continue
        if v and v.get("type"):
            p["type"] = v["type"]
        final_press.append(p)

    pitch = [c for c in (llm.get("pitch_categories") or []) if isinstance(c, dict) and c.get("outlets")]
    # Verify pitch outlets: only keep those whose domain resolves to a live homepage.
    pitch_urls = []
    for cat in pitch:
        for o in (cat.get("outlets") or []):
            d = (o.get("domain") or "").strip().lower()
            if d:
                pitch_urls.append(f"https://{d}")
    pitch_live = await verify_live_urls(list(set(pitch_urls)))
    cleaned_pitch = []
    for cat in pitch:
        outlets = []
        for o in (cat.get("outlets") or []):
            d = (o.get("domain") or "").strip().lower()
            if d and pitch_live.get(f"https://{d}"):
                o["url"] = f"https://{d}"
                o["verified"] = True
                outlets.append(o)
        if outlets:
            cleaned_pitch.append({**cat, "outlets": outlets})
    pitch = cleaned_pitch
    doc = {
        "id": secrets.token_hex(12), "user_id": user["id"],
        "query": q, "brand": brand_term, "domain": own,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "TinyFish live news/web search (real article URLs) + AI relevance filter",
        "press": final_press,
        "pitch_categories": pitch,
    }
    await db.pr_coverage.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/pr")
async def pr_coverage_list(user: dict = Depends(get_current_user)):
    docs = await db.pr_coverage.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.post("/sentiment/analyze")
async def sentiment_analyze(body: SentimentInput, user: dict = Depends(get_current_user)):
    topic = (body.topic or "").strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Topic is required")
    if len(topic) > 200:
        raise HTTPException(status_code=400, detail="Topic is too long (max 200 chars)")

    system = """You are an AI-engine sentiment analyst. For a given brand/topic, you simulate how major generative AI engines (ChatGPT, Claude, Gemini, Perplexity, Copilot, You.com) would describe it in a typical user answer — then you classify the sentiment of each of those answers. Your simulated answers must be realistic, grounded in publicly known facts about the brand (products, reception, criticisms, sentiment in media). If the topic is obscure or unknown, say so honestly in the answer and mark sentiment as neutral. Respond with ONLY valid minified JSON, no markdown, no prose."""

    prompt = f"""TOPIC / BRAND: "{topic}"

Simulate 8 realistic answers as if produced by the following AI engines when a user asks about this topic. Use these engines: ChatGPT, Claude, Gemini, Perplexity, Copilot, You.com, Meta AI, DeepSeek. For each answer:
- excerpt: a 1-3 sentence realistic answer excerpt (35-70 words) that engine would produce
- label: "positive" | "neutral" | "negative"
- score: number 0-100 (0 = very negative, 50 = neutral, 100 = very positive)
- reason: 1 short sentence explaining WHY that sentiment (which facts, tone, framing drive it)

Then compute:
- overall_score: 0-100 weighted average across all 8 engines
- positive_pct, neutral_pct, negative_pct: integers that MUST sum to 100
- top_positive: array of the 2 most-positive mentions (engine + excerpt + reason)
- top_negative: array of the 2 most-negative mentions (engine + excerpt + reason)
- insights: 3-5 short, ACTIONABLE recommendations (each 8-16 words) the brand could take to improve AI-engine sentiment (e.g. "Publish a public safety report to counter the 'privacy concerns' framing on Perplexity")
- headline: 6-12 word summary of the overall sentiment story

Return this EXACT JSON schema:
{{
 "topic": "{topic}",
 "overall_score": <int 0-100>,
 "headline": "<string>",
 "positive_pct": <int>,
 "neutral_pct": <int>,
 "negative_pct": <int>,
 "mentions": [
   {{"engine":"ChatGPT","excerpt":"...","label":"positive|neutral|negative","score":<0-100>,"reason":"..."}}
 ],
 "top_positive": [{{"engine":"...","excerpt":"...","reason":"..."}}],
 "top_negative": [{{"engine":"...","excerpt":"...","reason":"..."}}],
 "insights": ["...", "..."]
}}
Return exactly 8 mentions. Ensure positive_pct + neutral_pct + negative_pct = 100."""

    res = await llm_json(system, prompt, f"sentiment-{user['id']}-{secrets.token_hex(4)}", max_tokens=4096)

    # Safety normalisation
    def clamp(v, lo=0, hi=100, default=0):
        try:
            n = int(v)
            return max(lo, min(hi, n))
        except Exception:
            return default

    res["overall_score"] = clamp(res.get("overall_score"), default=50)
    pos = clamp(res.get("positive_pct"), default=0)
    neu = clamp(res.get("neutral_pct"), default=0)
    neg = clamp(res.get("negative_pct"), default=0)
    total = pos + neu + neg
    if total != 100 and total > 0:
        # rescale
        pos = round(pos * 100 / total)
        neu = round(neu * 100 / total)
        neg = 100 - pos - neu
    res["positive_pct"], res["neutral_pct"], res["negative_pct"] = pos, neu, neg
    if not isinstance(res.get("mentions"), list):
        res["mentions"] = []
    for m in res["mentions"]:
        if isinstance(m, dict):
            m["score"] = clamp(m.get("score"), default=50)
            if m.get("label") not in ("positive", "neutral", "negative"):
                s = m["score"]
                m["label"] = "positive" if s >= 65 else ("negative" if s <= 35 else "neutral")

    doc = {
        "id": secrets.token_hex(12),
        "user_id": user["id"],
        "topic": topic,
        "created_at": datetime.now(timezone.utc).isoformat(),
        **res,
    }
    await db.sentiments.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/sentiment")
async def sentiment_list(user: dict = Depends(get_current_user)):
    docs = await db.sentiments.find({"user_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return docs


@api_router.get("/sentiment/{sid}")
async def sentiment_get(sid: str, user: dict = Depends(get_current_user)):
    doc = await db.sentiments.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return doc


@api_router.delete("/sentiment/{sid}")
async def sentiment_delete(sid: str, user: dict = Depends(get_current_user)):
    r = await db.sentiments.delete_one({"id": sid, "user_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"ok": True}


# ============ AI AGENT + ALERTS =====================================================
AGENT_SYSTEM = """You are the Citetail AI Agent — a world-class GEO/AEO (Generative & Answer Engine Optimization) expert helping the user improve how AI engines (ChatGPT, Claude, Gemini, Perplexity, Copilot) discover, cite and rank their content.

You have access to the user's real project data below. Ground EVERY answer in that data whenever possible. If the user asks about "my site" or "my score", refer to the concrete numbers below.

RESPONSE RULES:
1. Be concise and specific. Use short paragraphs and bullet lists.
2. When you suggest a content fix (rewritten meta description, opening paragraph, heading, alt text, FAQ answer, schema JSON-LD), ALWAYS output the exact rewrite inside a fenced code block. Use a language tag that hints at the type:
   - ```meta       for a meta description or title
   - ```paragraph  for a rewritten opening / body paragraph
   - ```heading    for a heading rewrite
   - ```html       for HTML snippets
   - ```json       for schema.org JSON-LD
   - ```faq        for FAQ Q&A pairs
   The UI will render a "Copy" button on every code block so the user can paste it into their CMS.
3. When you make a claim that references user data ("your homepage has an SEO score of 62"), quote the exact number from the context.
4. If the user asks something outside GEO/AEO/SEO/content strategy, politely refocus.
5. If no data is available yet, tell the user which analysis to run (Projects scan, Domain Analysis, Content Optimizer, Visibility, Citations, Sentiment) and why.
6. Never invent citations or ranking positions — only reference what is in the context."""


async def build_user_context(user_id: str) -> str:
    """Fetches the user's recent data and returns a compact JSON string for the LLM system prompt."""
    projects = await db.projects.find(
        {"user_id": user_id, "status": "done"},
        {"_id": 0, "id": 1, "domain": 1, "site_health_score": 1, "ai_readiness_score": 1,
         "avg_seo_score": 1, "avg_perf_score": 1, "avg_aeo_score": 1, "total_pages": 1,
         "ai_citations_count": 1, "prompt_top_count": 1, "prompt_rankings_count": 1,
         "brand": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(5)

    analyses = await db.analyses.find(
        {"user_id": user_id, "status": {"$in": ["done", None]}, "overall_score": {"$exists": True}},
        {"_id": 0, "id": 1, "title": 1, "source_url": 1, "overall_score": 1,
         "target_query": 1, "recommendations": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(3)

    domains = await db.domains.find(
        {"user_id": user_id, "status": {"$in": ["done", None]}},
        {"_id": 0, "id": 1, "domain": 1, "ai_readiness_score": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(3)

    citations = await db.citations.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "query": 1, "user_domain": 1, "user_domain_cited": 1, "user_domain_rank": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(5)

    visibility = await db.visibility.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "brand": 1, "visibility_score": 1, "prompts": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(3)

    sentiments = await db.sentiments.find(
        {"user_id": user_id},
        {"_id": 0, "id": 1, "topic": 1, "overall_score": 1, "positive_pct": 1, "negative_pct": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(3)

    # Trim analyses.recommendations to top 3 to keep context small
    for a in analyses:
        recs = a.get("recommendations") or []
        a["recommendations"] = recs[:3] if isinstance(recs, list) else recs

    # Trim visibility.prompts
    for v in visibility:
        prompts = v.get("prompts") or []
        v["prompts"] = [{"prompt": p.get("prompt"), "position": p.get("position")} for p in prompts[:6]] if isinstance(prompts, list) else []

    ctx = {
        "projects": projects,
        "recent_analyses": analyses,
        "recent_domain_scans": domains,
        "recent_citations": citations,
        "recent_visibility": visibility,
        "recent_sentiments": sentiments,
    }
    return json.dumps(ctx, default=str)


async def generate_alerts_for_user(user_id: str) -> int:
    """Scan the user's latest data and upsert alert docs (idempotent via signature).
    Returns the number of NEW alerts created."""
    new_count = 0
    now = datetime.now(timezone.utc).isoformat()

    async def upsert(sig: str, doc: dict) -> bool:
        # Insert only if signature not already present for this user
        existing = await db.alerts.find_one({"user_id": user_id, "signature": sig}, {"_id": 1})
        if existing:
            return False
        await db.alerts.insert_one({
            "id": secrets.token_hex(10),
            "user_id": user_id,
            "signature": sig,
            "read": False,
            "created_at": now,
            **doc,
        })
        return True

    # 1. Project scans: any completed project → citation & error & score alerts
    async for p in db.projects.find({"user_id": user_id, "status": "done"}).sort("updated_at", -1).limit(5):
        pid = p.get("id")
        domain = p.get("domain", "your site")

        # a) Citations detected
        cite_count = p.get("ai_citations_count", 0) or 0
        if cite_count > 0:
            if await upsert(f"proj:{pid}:citations:{cite_count}", {
                "type": "citation",
                "severity": "info",
                "title": f"{cite_count} AI citation source{'s' if cite_count != 1 else ''} found for {domain}",
                "message": f"Citetail identified {cite_count} likely citation source{'s' if cite_count != 1 else ''} for {domain}. Review them in the project.",
                "link": f"/app/projects/{pid}",
            }):
                new_count += 1

        # b) Site health low
        shs = p.get("site_health_score")
        if isinstance(shs, (int, float)) and shs < 60:
            if await upsert(f"proj:{pid}:sitehealth:{int(shs)}", {
                "type": "score",
                "severity": "warning",
                "title": f"Site health is low: {int(shs)}/100 on {domain}",
                "message": "Several pages are hurting your generative-engine readiness. Open the project to see the failing dimensions.",
                "link": f"/app/projects/{pid}",
            }):
                new_count += 1

        # c) AI-readiness low
        ars = p.get("ai_readiness_score")
        if isinstance(ars, (int, float)) and ars < 60:
            if await upsert(f"proj:{pid}:aireadiness:{int(ars)}", {
                "type": "score",
                "severity": "warning",
                "title": f"AI-readiness score dropped to {int(ars)} on {domain}",
                "message": "AI engines may be struggling to cite this domain. Ask the AI Agent for a fix plan.",
                "link": f"/app/agent",
            }):
                new_count += 1

        # d) Ranking position issues
        top_ct = p.get("prompt_top_count", 0) or 0
        total_prompts = p.get("prompt_rankings_count", 0) or 0
        if total_prompts and top_ct == 0:
            if await upsert(f"proj:{pid}:rank:no-top-{total_prompts}", {
                "type": "ranking",
                "severity": "warning",
                "title": f"{domain} not ranking in top-3 for any AI prompt",
                "message": f"Across {total_prompts} tracked prompts, your domain never appears in the top 3 answers. Open the project for the exact prompts.",
                "link": f"/app/projects/{pid}",
            }):
                new_count += 1

        # e) Page errors
        pages_with_errors = await db.project_pages.count_documents({
            "project_id": pid,
            "issues.severity": {"$in": ["error", "critical", "high"]},
        })
        if pages_with_errors:
            if await upsert(f"proj:{pid}:errors:{pages_with_errors}", {
                "type": "error",
                "severity": "error",
                "title": f"{pages_with_errors} page{'s' if pages_with_errors != 1 else ''} on {domain} have critical issues",
                "message": "Fix these before AI engines re-crawl your site.",
                "link": f"/app/projects/{pid}",
            }):
                new_count += 1

    # 2. Latest analysis with high-priority recommendations
    async for a in db.analyses.find({"user_id": user_id, "status": {"$in": ["done", None]}, "overall_score": {"$exists": True}}).sort("created_at", -1).limit(3):
        aid = a.get("id")
        recs = a.get("recommendations") or []
        high = [r for r in recs if isinstance(r, dict) and (r.get("priority") == "high")]
        if high:
            if await upsert(f"analysis:{aid}:high:{len(high)}", {
                "type": "error",
                "severity": "warning",
                "title": f"{len(high)} high-priority fix{'es' if len(high) != 1 else ''} needed on \"{(a.get('title') or a.get('source_url') or '')[:60]}\"",
                "message": "Open the analysis or ask the AI Agent to write the fixes for you.",
                "link": f"/app/analysis/{aid}",
            }):
                new_count += 1

    return new_count


@api_router.get("/alerts")
async def alerts_list(user: dict = Depends(get_current_user)):
    # Generate any new alerts on demand (idempotent), then return latest 50
    await generate_alerts_for_user(user["id"])
    docs = await db.alerts.find(
        {"user_id": user["id"]},
        {"_id": 0, "signature": 0},
    ).sort("created_at", -1).to_list(50)
    unread = sum(1 for d in docs if not d.get("read"))
    return {"alerts": docs, "unread_count": unread}


@api_router.post("/alerts/{aid}/read")
async def alerts_read(aid: str, user: dict = Depends(get_current_user)):
    r = await db.alerts.update_one({"id": aid, "user_id": user["id"]}, {"$set": {"read": True}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"ok": True}


@api_router.post("/alerts/read-all")
async def alerts_read_all(user: dict = Depends(get_current_user)):
    await db.alerts.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}


@api_router.post("/agent/sessions")
async def agent_session_create(user: dict = Depends(get_current_user)):
    sid = secrets.token_hex(12)
    doc = {
        "id": sid,
        "user_id": user["id"],
        "title": "New chat",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.agent_sessions.insert_one(doc)
    return {**{k: v for k, v in doc.items() if k != "_id"}, "messages": []}


@api_router.get("/agent/sessions")
async def agent_sessions_list(user: dict = Depends(get_current_user)):
    docs = await db.agent_sessions.find({"user_id": user["id"]}, {"_id": 0}).sort("updated_at", -1).to_list(50)
    return docs


@api_router.get("/agent/sessions/{sid}")
async def agent_session_get(sid: str, user: dict = Depends(get_current_user)):
    s = await db.agent_sessions.find_one({"id": sid, "user_id": user["id"]}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    messages = await db.agent_messages.find({"session_id": sid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return {**s, "messages": messages}


@api_router.delete("/agent/sessions/{sid}")
async def agent_session_delete(sid: str, user: dict = Depends(get_current_user)):
    r = await db.agent_sessions.delete_one({"id": sid, "user_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    await db.agent_messages.delete_many({"session_id": sid})
    return {"ok": True}


@api_router.post("/agent/chat")
async def agent_chat(body: AgentChatInput, user: dict = Depends(get_current_user)):
    msg = (body.message or "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="Message is required")
    if len(msg) > 4000:
        raise HTTPException(status_code=400, detail="Message too long (max 4000 chars)")

    uid = user["id"]
    now = datetime.now(timezone.utc).isoformat()

    # Ensure session
    sid = body.session_id
    session = None
    if sid:
        session = await db.agent_sessions.find_one({"id": sid, "user_id": uid}, {"_id": 0})
    if not session:
        sid = secrets.token_hex(12)
        session = {
            "id": sid, "user_id": uid, "title": msg[:60],
            "created_at": now, "updated_at": now,
        }
        await db.agent_sessions.insert_one(session)

    # Store user message
    user_msg = {
        "id": secrets.token_hex(10),
        "session_id": sid,
        "role": "user",
        "content": msg,
        "created_at": now,
    }
    await db.agent_messages.insert_one(user_msg)

    # Fetch prior conversation (last 12 messages) for context continuity
    prior = await db.agent_messages.find({"session_id": sid}, {"_id": 0}).sort("created_at", 1).to_list(500)
    # Exclude the just-inserted user_msg from the "prior" for building the history block
    history = [m for m in prior if m.get("id") != user_msg["id"]][-12:]
    history_block = "\n".join([f"[{m['role'].upper()}] {m['content']}" for m in history]) if history else "(no prior turns)"

    # Fetch user context data
    try:
        user_ctx_json = await build_user_context(uid)
    except Exception as e:
        logger.warning(f"agent: failed to build user context: {e}")
        user_ctx_json = "{}"

    system = f"""{AGENT_SYSTEM}

USER_ID: {uid}
CURRENT_USER_DATA (JSON):
{user_ctx_json}

RECENT_CONVERSATION (most recent last):
{history_block}
"""

    # Call Claude Sonnet 4.6
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"agent-{sid}",
            system_message=system,
        ).with_model("anthropic", "claude-sonnet-4-6").with_params(max_tokens=4096)
        resp = await chat.send_message(UserMessage(text=msg))
        reply_text = resp if isinstance(resp, str) else str(resp)
    except Exception as e:
        logger.error(f"agent chat error: {e}")
        raise HTTPException(status_code=502, detail="AI agent failed to respond. Please retry.")

    # Store assistant message
    reply_created = datetime.now(timezone.utc).isoformat()
    assistant_msg = {
        "id": secrets.token_hex(10),
        "session_id": sid,
        "role": "assistant",
        "content": reply_text,
        "created_at": reply_created,
    }
    await db.agent_messages.insert_one(assistant_msg)

    # Update session title (once) and updated_at
    updates = {"updated_at": reply_created}
    if session.get("title") in (None, "", "New chat"):
        updates["title"] = msg[:60]
    await db.agent_sessions.update_one({"id": sid}, {"$set": updates})

    return {
        "session_id": sid,
        "user_message": {k: v for k, v in user_msg.items() if k != "_id"},
        "assistant_message": {k: v for k, v in assistant_msg.items() if k != "_id"},
    }


# ============ DASHBOARD =============================================================
@api_router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user)):
    uid = user["id"]
    analyses = await db.analyses.find({"user_id": uid, "status": {"$in": ["done", None]}, "overall_score": {"$exists": True}}, {"_id": 0, "id": 1, "title": 1, "source_url": 1, "overall_score": 1, "created_at": 1}).sort("created_at", -1).to_list(500)
    domains = await db.domains.find({"user_id": uid, "status": {"$in": ["done", None]}}, {"_id": 0, "id": 1, "domain": 1, "ai_readiness_score": 1, "created_at": 1}).sort("created_at", -1).to_list(200)
    vis = await db.visibility.find({"user_id": uid}, {"_id": 0, "id": 1, "brand": 1, "visibility_score": 1, "created_at": 1}).sort("created_at", -1).to_list(200)
    cites = await db.citations.count_documents({"user_id": uid})
    reddits = await db.reddit.count_documents({"user_id": uid})

    def avg(vals):
        vals = [v for v in vals if isinstance(v, (int, float))]
        return round(sum(vals) / len(vals)) if vals else 0

    activity = []
    for a in analyses[:6]:
        activity.append({"type": "AEO Content", "label": a["title"], "score": a.get("overall_score", 0), "created_at": a["created_at"], "link": f"/app/analysis/{a['id']}"})
    for d in domains[:4]:
        activity.append({"type": "Domain", "label": d["domain"], "score": d.get("ai_readiness_score", 0), "created_at": d["created_at"], "link": "/app/domain"})
    for v in vis[:4]:
        activity.append({"type": "Visibility", "label": v["brand"], "score": v.get("visibility_score", 0), "created_at": v["created_at"], "link": "/app/visibility"})
    activity.sort(key=lambda x: x["created_at"], reverse=True)

    return {
        "stats": {
            "analyses": len(analyses), "domains": len(domains), "visibility_runs": len(vis),
            "citation_runs": cites, "reddit_runs": reddits,
            "avg_content_score": avg([a.get("overall_score") for a in analyses]),
            "avg_domain_score": avg([d.get("ai_readiness_score") for d in domains]),
            "avg_visibility": avg([v.get("visibility_score") for v in vis]),
        },
        "content_trend": [{"date": a["created_at"], "score": a.get("overall_score", 0), "label": a["title"]} for a in list(reversed(analyses))[-12:]],
        "visibility_trend": [{"date": v["created_at"], "score": v.get("visibility_score", 0), "label": v["brand"]} for v in list(reversed(vis))[-12:]],
        "activity": activity[:10],
    }


# --- Projects: One-project-per-domain unified dashboard ---
PROJECT_LIST_PROJECTION = {
    "_id": 0, "id": 1, "domain": 1, "status": 1, "created_at": 1, "updated_at": 1,
    "site_health_score": 1, "ai_readiness_score": 1, "avg_perf_score": 1,
    "avg_seo_score": 1, "avg_aeo_score": 1, "total_pages": 1, "total_issues": 1,
    "ai_citations_count": 1, "prompt_rankings_count": 1, "prompt_top_count": 1,
    "brand": 1, "error": 1,
}


def _normalize_domain(raw: str) -> str:
    d = (raw or "").strip().lower().replace("https://", "").replace("http://", "").strip("/")
    d = d.split("/")[0]
    if d.startswith("www."):
        d = d[4:]
    return d


async def _run_project_scan(project_id: str, user_id: str, domain: str):
    """Background task: runs the full scan and persists results to Mongo."""
    from projects import run_full_project_scan
    try:
        result = await run_full_project_scan(domain, llm_json)
        set_doc = {
            "status": result.get("status", "done"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "brand": result.get("brand") or {},
            "site_health_score": result.get("site_health_score", 0),
            "ai_readiness_score": result.get("ai_readiness_score", 0),
            "avg_perf_score": result.get("avg_perf_score", 0),
            "avg_seo_score": result.get("avg_seo_score", 0),
            "avg_aeo_score": result.get("avg_aeo_score", 0),
            "total_pages": result.get("total_pages", 0),
            "total_issues": result.get("total_issues", 0),
            "ai_citations_count": result.get("ai_citations_count", 0),
            "prompt_rankings_count": result.get("prompt_rankings_count", 0),
            "prompt_top_count": result.get("prompt_top_count", 0),
            "technical_readiness": result.get("technical_readiness") or {},
            "brand_presence": result.get("brand_presence") or {},
            "pr_list": result.get("pr_list") or [],
            "competitor_intel": result.get("competitor_intel") or {},
            "error": result.get("error"),
        }
        await db.projects.update_one({"id": project_id}, {"$set": set_doc})
        await db.project_pages.delete_many({"project_id": project_id})
        await db.project_citations.delete_many({"project_id": project_id})
        await db.project_rankings.delete_many({"project_id": project_id})
        pages = result.get("pages") or []
        citations = result.get("citations") or []
        rankings = result.get("rankings") or []
        if pages:
            await db.project_pages.insert_many([{**p, "project_id": project_id, "id": secrets.token_hex(8)} for p in pages])
        if citations:
            await db.project_citations.insert_many([{**c, "project_id": project_id, "id": secrets.token_hex(8)} for c in citations])
        if rankings:
            await db.project_rankings.insert_many([{**r, "project_id": project_id, "id": secrets.token_hex(8)} for r in rankings])
    except Exception as e:
        logger.exception(f"project scan failed: {e}")
        await db.projects.update_one({"id": project_id}, {"$set": {
            "status": "error", "error": str(e)[:400],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }})


@api_router.post("/projects")
async def create_project(body: ProjectInput, user: dict = Depends(get_current_user)):
    from projects import new_project_doc
    from subscriptions import is_active, plan_of
    domain = _normalize_domain(body.domain)
    if not domain or "." not in domain:
        raise HTTPException(status_code=400, detail="Enter a valid domain, e.g. example.com")
    # Access + project-limit gate (admins bypass)
    if not user.get("full_access"):
        if not is_active(user):
            raise HTTPException(status_code=402, detail={
                "code": "payment_required",
                "message": "Your subscription is inactive. Complete or renew your plan to create projects.",
            })
        p = plan_of(user)
        limit = (p or {}).get("project_limit", 0)
        current = await db.projects.count_documents({"user_id": user["id"]})
        # Allow re-scanning an existing project (handled below) without counting toward the limit
        will_be_new = await db.projects.find_one({"user_id": user["id"], "domain": domain}) is None
        if will_be_new and current >= limit:
            raise HTTPException(status_code=402, detail={
                "code": "project_limit_reached",
                "message": f"Your {p['name']} plan allows {limit} project(s). Upgrade to add more.",
                "limit": limit, "plan": p["slug"],
            })
    existing = await db.projects.find_one({"user_id": user["id"], "domain": domain}, {"_id": 0})
    if existing:
        await db.projects.update_one({"id": existing["id"]}, {"$set": {
            "status": "processing", "updated_at": datetime.now(timezone.utc).isoformat(),
            "error": None,
        }})
        asyncio.create_task(_run_project_scan(existing["id"], user["id"], domain))
        return {"id": existing["id"], "domain": domain, "status": "processing"}
    doc = new_project_doc(user["id"], domain)
    await db.projects.insert_one(doc)
    asyncio.create_task(_run_project_scan(doc["id"], user["id"], domain))
    return {"id": doc["id"], "domain": domain, "status": "processing"}


@api_router.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)):
    docs = await db.projects.find({"user_id": user["id"]}, PROJECT_LIST_PROJECTION).sort("updated_at", -1).to_list(200)
    return docs


@api_router.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    pages = await db.project_pages.find({"project_id": project_id}, {"_id": 0}).sort("seo_score", 1).to_list(500)
    citations = await db.project_citations.find({"project_id": project_id}, {"_id": 0}).to_list(200)
    rankings = await db.project_rankings.find({"project_id": project_id}, {"_id": 0}).to_list(50)
    return {**doc, "pages": pages, "citations": citations, "rankings": rankings}


@api_router.post("/projects/{project_id}/rescan")
async def rescan_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    if doc.get("status") == "processing":
        return {"id": project_id, "status": "processing", "domain": doc["domain"]}
    await db.projects.update_one({"id": project_id}, {"$set": {
        "status": "processing", "updated_at": datetime.now(timezone.utc).isoformat(), "error": None,
    }})
    asyncio.create_task(_run_project_scan(project_id, user["id"], doc["domain"]))
    return {"id": project_id, "status": "processing", "domain": doc["domain"]}


@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str, user: dict = Depends(get_current_user)):
    doc = await db.projects.find_one({"id": project_id, "user_id": user["id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Project not found")
    await db.projects.delete_one({"id": project_id})
    await db.project_pages.delete_many({"project_id": project_id})
    await db.project_citations.delete_many({"project_id": project_id})
    await db.project_rankings.delete_many({"project_id": project_id})
    return {"ok": True}


app.include_router(api_router)

# Admin OTP auth flow (registration + login + password reset).
# Kept in a separate router so the admin URLs don't collide with the
# standard user signup/login endpoints under /api/auth/.
from admin_auth import admin_router as _admin_router  # noqa: E402
app.include_router(_admin_router)

# Subscription + Stripe checkout endpoints
from subscriptions import subs_router as _subs_router, stripe_webhook_router as _stripe_webhook_router  # noqa: E402
app.include_router(_subs_router)
app.include_router(_stripe_webhook_router, prefix="/api")

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
    now_iso = datetime.now(timezone.utc).isoformat()
    if existing is None:
        await db.users.insert_one({"email": admin_email, "password_hash": hash_password(admin_password),
                                   "name": "Admin", "role": "admin", "created_at": now_iso,
                                   "password_set_at": now_iso, "admin_verified": True})
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {
            "password_hash": hash_password(admin_password),
            "password_set_at": now_iso,
        }})
    # Ensure TTL index for admin OTPs
    await db.admin_otps.create_index("expires_at", expireAfterSeconds=0)
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
