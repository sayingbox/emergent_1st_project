"""TinyFish Search + Fetch client.

Search finds REAL URLs (source of truth for verified links); Fetch returns clean
page text. Both endpoints are free on TinyFish. We NEVER let the LLM invent URLs —
every link we display comes from a real TinyFish search result.
"""
import os
import asyncio
import logging
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

TINYFISH_API_KEY = os.environ.get("TINYFISH_API_KEY", "")
SEARCH_URL = "https://api.search.tinyfish.ai"
FETCH_URL = "https://api.fetch.tinyfish.ai"

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


async def tf_search(query: str, domain_type: str = "web", max_results: int = 10,
                    recency_minutes: int = None, purpose: str = None, page: int = None) -> list:
    """Run one TinyFish web/news search. Returns list of result dicts (real URLs)."""
    if not TINYFISH_API_KEY:
        logger.warning("TINYFISH_API_KEY missing")
        return []
    params = {"query": query}
    if domain_type and domain_type != "web":
        params["domain_type"] = domain_type
    if recency_minutes:
        params["recency_minutes"] = recency_minutes
    if purpose:
        params["purpose"] = purpose
    if page:
        params["page"] = page
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(SEARCH_URL, params=params, headers=_headers())
            r.raise_for_status()
            data = r.json()
        return (data.get("results") or [])[:max_results]
    except Exception as e:
        logger.warning(f"tf_search failed for '{query}': {e}")
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
