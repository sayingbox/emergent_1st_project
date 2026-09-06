"""TinyFish Search + Fetch client.

Search finds REAL URLs (source of truth for verified links); Fetch returns clean
page text. Both endpoints are free on TinyFish. We NEVER let the LLM invent URLs —
every link we display comes from a real TinyFish search result.
"""
import os
import time
import asyncio
import logging
from urllib.parse import urlparse

import httpx

try:
    from ddgs import DDGS
except Exception:  # pragma: no cover - optional
    DDGS = None

logger = logging.getLogger(__name__)

TINYFISH_API_KEY = os.environ.get("TINYFISH_API_KEY", "")
SEARCH_URL = "https://api.search.tinyfish.ai"
FETCH_URL = "https://api.fetch.tinyfish.ai"

# Primary web-search providers for AI citation sources.
# Serper.dev (real Google results — best for `site:` citation queries) is tried
# first, Tavily (AI search API) second, then TinyFish, then DuckDuckGo. Every URL
# returned is a REAL search result — we never let the LLM invent links.
SERPER_API_KEY = os.environ.get("SERPER_API_KEY", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")
SERPER_SEARCH_URL = "https://google.serper.dev/search"
SERPER_NEWS_URL = "https://google.serper.dev/news"
TAVILY_SEARCH_URL = "https://api.tavily.com/search"

# Cap concurrency against the external search providers so a burst of ~18
# concurrent citation-source searches doesn't trip provider rate limits.
_PROVIDER_SEM = asyncio.Semaphore(6)

# Global throttle so concurrent callers (reviews + opportunities + competitor
# intel all fire at once during a project scan) don't trip TinyFish's rate limit.
# A semaphore caps concurrency; a paced lock spaces requests over time.
_SEARCH_SEM = asyncio.Semaphore(2)
_RATE_LOCK = asyncio.Lock()
_MIN_INTERVAL = 0.5  # seconds between consecutive TinyFish requests
_last_call = 0.0


async def _pace():
    """Ensure at least _MIN_INTERVAL between outgoing TinyFish requests."""
    global _last_call
    async with _RATE_LOCK:
        wait = _MIN_INTERVAL - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.monotonic()

# Heuristic authority per known source host (0-100) for citation ranking.
HOST_AUTHORITY = {
    "wikipedia.org": 96, "linkedin.com": 88, "crunchbase.com": 86, "g2.com": 88,
    "capterra.com": 84, "trustpilot.com": 82, "producthunt.com": 80, "clutch.co": 80,
    "wellfound.com": 78, "angel.co": 76, "github.com": 85, "youtube.com": 84,
    "reddit.com": 82, "medium.com": 70, "techcrunch.com": 92, "forbes.com": 92,
    "businessinsider.com": 88, "theverge.com": 88, "wired.com": 88, "bloomberg.com": 92,
    "glassdoor.com": 78, "facebook.com": 76, "instagram.com": 74, "twitter.com": 78,
    "x.com": 78, "gartner.com": 90, "getapp.com": 78, "sourceforge.net": 72,
    "slashdot.org": 70, "ycombinator.com": 84, "producthunt.com/products": 80,
}

TYPE_BY_HOST = {
    "wikipedia.org": "encyclopedia",
    "g2.com": "review", "capterra.com": "review", "trustpilot.com": "review",
    "clutch.co": "review", "getapp.com": "review", "sourceforge.net": "review",
    "crunchbase.com": "directory", "wellfound.com": "directory", "angel.co": "directory",
    "linkedin.com": "social", "twitter.com": "social", "x.com": "social",
    "facebook.com": "social", "instagram.com": "social",
    "youtube.com": "video", "reddit.com": "forum", "github.com": "documentation",
    "producthunt.com": "directory",
}


def host_of(url: str) -> str:
    try:
        h = urlparse(url if url.startswith("http") else "https://" + url).netloc.lower()
        return h[4:] if h.startswith("www.") else h
    except Exception:
        return ""


def root_domain(host: str) -> str:
    """crunchbase.com from www.crunchbase.com; keeps last two labels."""
    host = (host or "").lower()
    if host.startswith("www."):
        host = host[4:]
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


def authority_for(url: str) -> int:
    rd = root_domain(host_of(url))
    return HOST_AUTHORITY.get(rd, 55)


def type_for(url: str, domain_type: str = "web") -> str:
    if domain_type == "news":
        return "news"
    rd = root_domain(host_of(url))
    return TYPE_BY_HOST.get(rd, "reference")


def _headers():
    return {"X-API-Key": TINYFISH_API_KEY}


def _ddgs_search_sync(query: str, domain_type: str, max_results: int) -> list:
    """Real-web search fallback via DuckDuckGo (no key). Returns TinyFish-shaped result dicts."""
    if DDGS is None:
        return []
    try:
        with DDGS() as ddg:
            raw = ddg.news(query, max_results=max_results) if domain_type == "news" else ddg.text(query, max_results=max_results)
        out = []
        for r in raw or []:
            url = r.get("href") or r.get("url") or ""
            if not url:
                continue
            host = urlparse(url).netloc.lower()
            if host.startswith("www."):
                host = host[4:]
            out.append({
                "url": url,
                "title": r.get("title") or "",
                "snippet": r.get("body") or r.get("excerpt") or "",
                "site_name": host,
                "date": r.get("date") or "",
            })
        return out
    except Exception as e:
        logger.warning(f"ddgs fallback failed for '{query}': {e}")
        return []


async def _serper_search(query: str, domain_type: str, max_results: int) -> list:
    """Real Google results via Serper.dev. Returns TinyFish-shaped dicts."""
    if not SERPER_API_KEY:
        return []
    is_news = domain_type == "news"
    url = SERPER_NEWS_URL if is_news else SERPER_SEARCH_URL
    headers = {"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"}
    body = {"q": query, "num": max(10, max_results)}
    try:
        async with _PROVIDER_SEM:
            async with httpx.AsyncClient(timeout=25) as client:
                r = await client.post(url, json=body, headers=headers)
                r.raise_for_status()
                data = r.json()
    except Exception as e:
        logger.warning(f"serper search failed for '{query}': {e}")
        return []
    items = data.get("news") if is_news else data.get("organic")
    out = []
    for it in (items or []):
        link = it.get("link") or ""
        if not link or "/external_clicks" in link or "/event_tracking" in link:
            continue
        host = host_of(link)
        out.append({
            "url": link,
            "title": it.get("title") or "",
            "snippet": it.get("snippet") or "",
            "site_name": it.get("source") or host,
            "date": it.get("date") or "",
        })
    return out[:max_results]


async def _tavily_search(query: str, domain_type: str, max_results: int) -> list:
    """Real web results via Tavily AI search. Returns TinyFish-shaped dicts."""
    if not TAVILY_API_KEY:
        return []
    body = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "max_results": max(5, max_results),
        "topic": "news" if domain_type == "news" else "general",
        "search_depth": "basic",
    }
    try:
        async with _PROVIDER_SEM:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(TAVILY_SEARCH_URL, json=body,
                                      headers={"Content-Type": "application/json"})
                r.raise_for_status()
                data = r.json()
    except Exception as e:
        logger.warning(f"tavily search failed for '{query}': {e}")
        return []
    out = []
    for it in (data.get("results") or []):
        link = it.get("url") or ""
        if not link:
            continue
        out.append({
            "url": link,
            "title": it.get("title") or "",
            "snippet": (it.get("content") or "")[:400],
            "site_name": host_of(link),
            "date": it.get("published_date") or "",
        })
    return out[:max_results]


async def tf_search(query: str, domain_type: str = "web", max_results: int = 10,
                    recency_minutes: int = None, purpose: str = None, page: int = None) -> list:
    """Run one web/news search for REAL URLs (never model-invented).

    Provider priority: Serper.dev (Google) → Tavily → TinyFish → DuckDuckGo.
    The first provider that returns results wins."""
    # 1) Serper.dev — best for `site:` citation-source queries
    serper = await _serper_search(query, domain_type, max_results)
    if serper:
        return serper
    # 2) Tavily — AI search API
    tavily = await _tavily_search(query, domain_type, max_results)
    if tavily:
        return tavily
    # 3) TinyFish (if configured)
    if not TINYFISH_API_KEY:
        # 4) DuckDuckGo fallback: real URLs, no key required
        return await asyncio.to_thread(_ddgs_search_sync, query, domain_type, max_results)
    params = {"query": query}
    if domain_type and domain_type != "web":
        params["domain_type"] = domain_type
    if recency_minutes:
        params["recency_minutes"] = recency_minutes
    if purpose:
        params["purpose"] = purpose
    if page:
        params["page"] = page
    # Throttled + paced + retry-on-429 so bursts of concurrent searches aren't dropped.
    attempts = 4
    async with _SEARCH_SEM:
        for attempt in range(attempts):
            await _pace()
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    r = await client.get(SEARCH_URL, params=params, headers=_headers())
                if r.status_code == 429:
                    if attempt < attempts - 1:
                        await asyncio.sleep(2 * (2 ** attempt))  # 2, 4, 8s
                        continue
                    logger.warning(f"tf_search rate-limited (429) for '{query}'")
                    return []
                r.raise_for_status()
                return (r.json().get("results") or [])[:max_results]
            except Exception as e:
                if attempt < attempts - 1:
                    await asyncio.sleep(1.0 * (attempt + 1))
                    continue
                logger.warning(f"tf_search failed for '{query}': {e}")
                return []
    return []


async def tf_search_many(queries: list, domain_type: str = "web", max_results: int = 6,
                         purpose: str = None) -> list:
    """Run several searches concurrently; returns a list aligned with `queries`."""
    tasks = [tf_search(q, domain_type=domain_type, max_results=max_results, purpose=purpose) for q in queries]
    return await asyncio.gather(*tasks)


async def tf_fetch(urls: list, fmt: str = "markdown", ttl: int = None, purpose: str = None) -> dict:
    """Fetch clean text for up to 10 URLs. Returns {'results':[...], 'errors':[...]}"""
    if not TINYFISH_API_KEY or not urls:
        return {"results": [], "errors": []}
    body = {"urls": urls[:10], "format": fmt}
    if ttl is not None:
        body["ttl"] = ttl
    if purpose:
        body["purpose"] = purpose
    try:
        async with httpx.AsyncClient(timeout=70) as client:
            r = await client.post(FETCH_URL, json=body, headers={**_headers(), "Content-Type": "application/json"})
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning(f"tf_fetch failed: {e}")
        return {"results": [], "errors": [{"url": u, "error": str(e)} for u in urls]}


def looks_like_domain(text: str) -> bool:
    t = (text or "").strip()
    return "." in t and " " not in t and "/" not in t.rstrip("/")


def brand_name_from_domain(domain: str) -> str:
    core = root_domain(host_of(domain) or domain)
    label = core.split(".")[0] if core else domain
    return label.replace("-", " ").title()
