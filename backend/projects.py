"""
Projects: "One Project" per domain — a unified dashboard that runs a deep crawl,
per-page SEO/AEO issue detection, static Lighthouse-style performance scoring,
web-citation discovery, and AI prompt-ranking checks.

This module exposes helpers used by server.py; it does NOT define FastAPI routes
(routes stay in server.py so we don't split the app).
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import secrets
import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse, urljoin

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger("citetail.projects")

# ----------------------- config --------------------------------------------

DEFAULT_MAX_PAGES = 25
CRAWL_TIMEOUT_S = 12
CRAWL_CONCURRENCY = 6
CITATION_CANDIDATES = 15
RANKING_PROMPTS = 8

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
NO_CACHE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Cache-Control": "no-cache, no-store, max-age=0",
    "Pragma": "no-cache",
}

# ----------------------- deep crawl ----------------------------------------


def _norm_url(u: str) -> str:
    u = (u or "").split("#")[0].rstrip("/")
    return u


def _same_domain(link: str, root_host: str) -> bool:
    try:
        h = (urlparse(link).netloc or "").lower()
        if not h:
            return False
        if h.startswith("www."):
            h = h[4:]
        rh = root_host[4:] if root_host.startswith("www.") else root_host
        return h == rh or h.endswith("." + rh)
    except Exception:
        return False


def _fetch_page_sync(url: str) -> dict:
    """Synchronous fetch that also captures timing/size (used with asyncio.to_thread)."""
    started = time.perf_counter()
    status = None
    text = ""
    err = None
    try:
        r = requests.get(url, headers=NO_CACHE_HEADERS, timeout=CRAWL_TIMEOUT_S, allow_redirects=True)
        status = r.status_code
        text = r.text or ""
    except Exception as e:
        err = str(e)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return {
        "url": url,
        "status": status,
        "html": text,
        "load_time_ms": elapsed_ms,
        "size_kb": round(len(text.encode("utf-8", errors="ignore")) / 1024, 1),
        "error": err,
    }


async def _fetch_page(url: str) -> dict:
    return await asyncio.to_thread(_fetch_page_sync, url)


async def deep_crawl(domain: str, max_pages: int = DEFAULT_MAX_PAGES) -> list[dict]:
    """
    BFS-crawl a site starting from https://domain. Returns a list of page dicts
    (each with html, load_time_ms, size_kb, status). At most max_pages pages,
    same-registrable-domain only.
    """
    root_candidates = [f"https://{domain}", f"http://{domain}"]
    root_html = ""
    root_url = ""
    root_page = None
    for cand in root_candidates:
        page = await _fetch_page(cand)
        if page.get("status") and 200 <= page["status"] < 400 and page.get("html"):
            root_html, root_url, root_page = page["html"], cand, page
            break
    if not root_page:
        return []

    root_host = (urlparse(root_url).netloc or "").lower()
    pages: list[dict] = [root_page]
    seen: set[str] = {_norm_url(root_url)}

    # Seed queue with links from the homepage
    queue: list[str] = []
    try:
        soup = BeautifulSoup(root_html, "lxml")
        for a in soup.find_all("a", href=True):
            full = _norm_url(urljoin(root_url, a["href"].strip()))
            if not full or full in seen:
                continue
            p = urlparse(full)
            if p.scheme not in ("http", "https"):
                continue
            if not _same_domain(full, root_host):
                continue
            if any(full.lower().endswith(ext) for ext in (
                ".pdf", ".zip", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp",
                ".mp4", ".mp3", ".ico", ".css", ".js", ".xml",
            )):
                continue
            queue.append(full)
    except Exception as e:
        logger.warning(f"deep_crawl: parse homepage failed: {e}")

    # De-dup while preserving order
    ordered_queue: list[str] = []
    dedup: set[str] = set()
    for u in queue:
        if u in dedup:
            continue
        dedup.add(u)
        ordered_queue.append(u)

    # Fetch in parallel with a small concurrency bound
    sem = asyncio.Semaphore(CRAWL_CONCURRENCY)

    async def worker(u: str) -> Optional[dict]:
        async with sem:
            page = await _fetch_page(u)
            return page

    # We'll fetch in chunks so we can BFS-expand from new pages too
    while ordered_queue and len(pages) < max_pages:
        take = ordered_queue[: max(0, max_pages - len(pages))]
        ordered_queue = ordered_queue[len(take):]
        results = await asyncio.gather(*(worker(u) for u in take))
        for page in results:
            if not page:
                continue
            nu = _norm_url(page["url"])
            if nu in seen:
                continue
            seen.add(nu)
            if page.get("status") and 200 <= page["status"] < 400 and page.get("html"):
                pages.append(page)
                if len(pages) >= max_pages:
                    break
                # Expand: discover more internal links from this page
                try:
                    soup = BeautifulSoup(page["html"], "lxml")
                    for a in soup.find_all("a", href=True):
                        full = _norm_url(urljoin(page["url"], a["href"].strip()))
                        if not full or full in seen or full in dedup:
                            continue
                        p = urlparse(full)
                        if p.scheme not in ("http", "https"):
                            continue
                        if not _same_domain(full, root_host):
                            continue
                        if any(full.lower().endswith(ext) for ext in (
                            ".pdf", ".zip", ".jpg", ".jpeg", ".png", ".gif", ".svg",
                            ".webp", ".mp4", ".mp3", ".ico", ".css", ".js", ".xml",
                        )):
                            continue
                        dedup.add(full)
                        ordered_queue.append(full)
                except Exception:
                    pass

    return pages


# ----------------------- issue detection -----------------------------------

ISSUE_DEFS = {
    "missing_title": {"severity": "high", "category": "seo",
                       "message": "Page is missing a <title> tag or the title is empty."},
    "short_title": {"severity": "medium", "category": "seo",
                     "message": "Title tag is too short (under 20 characters) — add descriptive keywords."},
    "long_title": {"severity": "low", "category": "seo",
                    "message": "Title tag exceeds 65 characters — will be truncated in search results."},
    "missing_meta_description": {"severity": "high", "category": "seo",
                                  "message": "No <meta name=\"description\"> found."},
    "thin_content": {"severity": "high", "category": "seo",
                      "message": "Page has fewer than 300 words — considered thin content."},
    "no_h1": {"severity": "high", "category": "seo",
               "message": "Page has no <h1> heading."},
    "multiple_h1": {"severity": "medium", "category": "seo",
                     "message": "Page has more than one <h1> heading — pick a single primary heading."},
    "no_schema": {"severity": "medium", "category": "seo",
                   "message": "No structured data (JSON-LD schema) found."},
    "images_missing_alt": {"severity": "medium", "category": "seo",
                            "message": "One or more <img> tags are missing an alt attribute."},
    "slow_page": {"severity": "high", "category": "performance",
                   "message": "Page load time exceeds 3 seconds."},
    "large_page": {"severity": "medium", "category": "performance",
                    "message": "HTML payload is larger than 500 KB."},
    "broken_internal_links": {"severity": "high", "category": "seo",
                               "message": "One or more internal links appear broken."},
    "no_canonical": {"severity": "medium", "category": "seo",
                      "message": "No <link rel=\"canonical\"> found."},
    "no_open_graph": {"severity": "low", "category": "seo",
                       "message": "No OpenGraph meta tags found — bad for social sharing."},
    # AI-specific
    "no_faq_schema": {"severity": "medium", "category": "aeo",
                       "message": "No FAQPage schema — AI engines prefer FAQ-structured content."},
    "no_answer_paragraph": {"severity": "high", "category": "aeo",
                             "message": "No clear opening answer paragraph — hurts AI extractability."},
    "no_citation_statistics": {"severity": "medium", "category": "aeo",
                                "message": "No citation-worthy statistics (%, $) with numbers — AI engines prefer quotable data."},
    "no_author_info": {"severity": "medium", "category": "aeo",
                        "message": "No author byline or Author schema — hurts E-E-A-T signals."},
}


def _visible_words(soup: BeautifulSoup) -> int:
    for t in soup(["script", "style", "noscript", "nav", "footer", "header", "svg", "form"]):
        t.decompose()
    text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
    return len([w for w in text.split(" ") if w])


def _first_paragraph_text(soup: BeautifulSoup) -> str:
    p = soup.find("p")
    if not p:
        return ""
    return re.sub(r"\s+", " ", p.get_text(" ", strip=True))


def analyze_page(page: dict) -> dict:
    """Given a fetched page dict, return the full per-page analysis with issues + scores."""
    html = page.get("html") or ""
    url = page["url"]
    load_time_ms = int(page.get("load_time_ms") or 0)
    size_kb = float(page.get("size_kb") or 0)
    soup = BeautifulSoup(html, "lxml") if html else BeautifulSoup("", "lxml")

    title_raw = soup.title.string if (soup.title and soup.title.string) else None
    title = title_raw.strip() if title_raw else None
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_desc = (meta_desc_tag.get("content") or "").strip() if meta_desc_tag else ""
    h1s = soup.find_all("h1")
    h2s = soup.find_all("h2")
    canonical = soup.find("link", attrs={"rel": "canonical"})
    og = soup.find("meta", attrs={"property": re.compile(r"^og:")})
    ld_scripts = soup.find_all("script", attrs={"type": "application/ld+json"})
    imgs = soup.find_all("img")
    imgs_missing_alt = sum(1 for i in imgs if not (i.get("alt") or "").strip())
    word_count = _visible_words(BeautifulSoup(html, "lxml"))
    first_para = _first_paragraph_text(BeautifulSoup(html, "lxml"))

    # Detect schema types (JSON-LD)
    schema_types: set[str] = set()
    for s in ld_scripts:
        try:
            data = json.loads((s.string or "").strip())
        except Exception:
            continue

        def _collect(obj):
            if isinstance(obj, dict):
                t = obj.get("@type")
                if isinstance(t, list):
                    for x in t:
                        schema_types.add(str(x))
                elif t:
                    schema_types.add(str(t))
                for v in obj.values():
                    _collect(v)
            elif isinstance(obj, list):
                for v in obj:
                    _collect(v)
        _collect(data)

    has_schema = len(schema_types) > 0
    has_faq_schema = any(t.lower() == "faqpage" for t in schema_types)
    has_author_schema = any(t.lower() in ("person", "author") for t in schema_types) or bool(
        soup.find(attrs={"itemprop": "author"})
    )
    # Author heuristic outside schema
    if not has_author_schema:
        text_head = soup.get_text(" ", strip=True)[:800].lower()
        if re.search(r"\bby [a-z][a-z '.-]{1,40}\b", text_head) or "written by" in text_head:
            has_author_schema = True

    # Statistics heuristic: presence of at least one % / $ figure alongside a number
    body_text = soup.get_text(" ", strip=True)[:6000]
    has_stats = bool(re.search(r"\d+\s?%", body_text) or re.search(r"\$\s?\d+[\d,\.]*", body_text) or
                     re.search(r"\b\d{2,}(?:\.\d+)?\s?(million|billion|users|customers|companies|percent)\b",
                               body_text.lower()))

    # Answer paragraph heuristic: first <p> has 20-80 words and appears near start
    apara_ok = 20 <= len(first_para.split()) <= 80 if first_para else False

    issues: list[dict] = []

    def add(code):
        d = ISSUE_DEFS[code]
        issues.append({"code": code, "severity": d["severity"], "category": d["category"], "message": d["message"]})

    # SEO issues
    if not title:
        add("missing_title")
    else:
        if len(title) < 20:
            add("short_title")
        elif len(title) > 65:
            add("long_title")
    if not meta_desc:
        add("missing_meta_description")
    if word_count < 300:
        add("thin_content")
    if len(h1s) == 0:
        add("no_h1")
    elif len(h1s) > 1:
        add("multiple_h1")
    if not has_schema:
        add("no_schema")
    if imgs_missing_alt > 0:
        add("images_missing_alt")
    if not canonical:
        add("no_canonical")
    if not og:
        add("no_open_graph")
    # Performance
    if load_time_ms > 3000:
        add("slow_page")
    if size_kb > 500:
        add("large_page")
    # AEO
    if not has_faq_schema:
        add("no_faq_schema")
    if not apara_ok:
        add("no_answer_paragraph")
    if not has_stats:
        add("no_citation_statistics")
    if not has_author_schema:
        add("no_author_info")

    # Scores 0-100 (higher is better)
    # Performance: 0ms => 100; 4000ms => 0. size >500KB => penalty.
    perf_time = max(0, min(100, round(100 - (load_time_ms / 40))))
    perf_size = 100 if size_kb <= 200 else max(0, 100 - int((size_kb - 200) / 10))
    perf_score = round((perf_time * 0.7) + (perf_size * 0.3))

    seo_issue_weight = {"high": 15, "medium": 8, "low": 3}
    seo_penalty = sum(seo_issue_weight.get(i["severity"], 0) for i in issues if i["category"] == "seo")
    seo_score = max(0, 100 - seo_penalty)

    aeo_issue_weight = {"high": 25, "medium": 12, "low": 5}
    aeo_penalty = sum(aeo_issue_weight.get(i["severity"], 0) for i in issues if i["category"] == "aeo")
    aeo_score = max(0, 100 - aeo_penalty)

    return {
        "url": url,
        "status": page.get("status"),
        "title": title,
        "meta_description": meta_desc,
        "word_count": word_count,
        "load_time_ms": load_time_ms,
        "size_kb": size_kb,
        "h1_count": len(h1s),
        "h2_count": len(h2s),
        "img_count": len(imgs),
        "imgs_missing_alt": imgs_missing_alt,
        "has_schema": has_schema,
        "has_faq_schema": has_faq_schema,
        "has_author": has_author_schema,
        "has_canonical": bool(canonical),
        "has_open_graph": bool(og),
        "schema_types": sorted(schema_types),
        "perf_score": perf_score,
        "seo_score": seo_score,
        "aeo_score": aeo_score,
        "issues": issues,
        "issue_count": len(issues),
    }


# ----------------------- health aggregation --------------------------------


def aggregate_project(analyzed_pages: list[dict], citations: list[dict], rankings: list[dict]) -> dict:
    if not analyzed_pages:
        return {
            "site_health_score": 0,
            "ai_readiness_score": 0,
            "avg_perf_score": 0,
            "avg_seo_score": 0,
            "avg_aeo_score": 0,
            "total_issues": 0,
            "total_pages": 0,
            "ai_citations_count": 0,
            "prompt_rankings_count": 0,
            "prompt_top_count": 0,
        }
    n = len(analyzed_pages)
    perf = sum(p["perf_score"] for p in analyzed_pages) / n
    seo = sum(p["seo_score"] for p in analyzed_pages) / n
    aeo = sum(p["aeo_score"] for p in analyzed_pages) / n
    site_health = round(perf * 0.30 + seo * 0.55 + aeo * 0.15)
    verified_cites = [c for c in citations if c.get("verified")]
    top_positions = [r for r in rankings if (r.get("position") in ("top", "recommended"))]
    ai_readiness = round(aeo * 0.45 + (min(100, len(verified_cites) * 8)) * 0.30 +
                        (min(100, len(top_positions) * 12)) * 0.25)
    return {
        "site_health_score": site_health,
        "ai_readiness_score": ai_readiness,
        "avg_perf_score": round(perf),
        "avg_seo_score": round(seo),
        "avg_aeo_score": round(aeo),
        "total_issues": sum(p["issue_count"] for p in analyzed_pages),
        "total_pages": n,
        "ai_citations_count": len(verified_cites),
        "prompt_rankings_count": len(rankings),
        "prompt_top_count": len(top_positions),
    }


# ----------------------- citation crawler ----------------------------------

CITATION_SYSTEM = """You are a citation-source predictor.
Given a target domain and a short business summary, list the 15 most likely third-party URLs
across the web that ALREADY MENTION this brand — real, currently-live URLs like Wikipedia,
LinkedIn company page, Crunchbase, G2/Capterra/Trustpilot/Clutch/Glassdoor, YouTube channel,
industry directories, well-known news outlets or reference wikis.
NEVER fabricate deep slugs. When unsure, use realistic profile-style URLs (e.g.
https://www.crunchbase.com/organization/<slug>). Return ONLY valid minified JSON."""


def citation_prompt(domain: str, brand_name: str, brand_summary: str) -> str:
    return f"""TARGET_DOMAIN: {domain}
BRAND: {brand_name}
SUMMARY: {brand_summary}

Return JSON:
{{"candidates":[{{"url":"https://...","source_domain":"example.com","type":"official|editorial|community|reference|competitor","why":"one-line reason"}}]}}
Provide exactly 15 candidates ranked by likelihood. Prefer well-known authoritative sites."""


def _extract_snippet(html: str, needle: str, ctx: int = 160) -> str:
    """Find the first occurrence of `needle` in the page's visible text and return a snippet around it."""
    try:
        soup = BeautifulSoup(html, "lxml")
        for t in soup(["script", "style", "noscript", "nav", "footer", "svg"]):
            t.decompose()
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))
        lower = text.lower()
        idx = lower.find(needle.lower())
        if idx < 0:
            return ""
        start = max(0, idx - ctx)
        end = min(len(text), idx + len(needle) + ctx)
        snip = text[start:end]
        return ("… " if start > 0 else "") + snip + (" …" if end < len(text) else "")
    except Exception:
        return ""


async def discover_citations(domain: str, brand_name: str, brand_summary: str, llm_call) -> list[dict]:
    """LLM proposes candidate citation URLs → HTTP-fetch each → verify the domain is mentioned in the page's HTML."""
    try:
        prompt = citation_prompt(domain, brand_name or domain, brand_summary or "")
        result = await llm_call(CITATION_SYSTEM, prompt, f"cite-{domain}")
        candidates = result.get("candidates") or []
    except Exception as e:
        logger.warning(f"discover_citations: LLM prompt failed: {e}")
        candidates = []

    seen_urls: set[str] = set()
    unique: list[dict] = []
    for c in candidates:
        u = (c.get("url") or "").strip()
        if not u or u in seen_urls or not u.startswith(("http://", "https://")):
            continue
        seen_urls.add(u)
        unique.append(c)
    unique = unique[:CITATION_CANDIDATES]

    sem = asyncio.Semaphore(6)

    async def verify(c: dict) -> dict:
        u = c["url"]
        needle_variants = [domain]
        if domain.startswith("www."):
            needle_variants.append(domain[4:])
        else:
            needle_variants.append("www." + domain)
        try:
            async with sem:
                page = await _fetch_page(u)
        except Exception:
            page = {"status": None, "html": ""}
        html = page.get("html") or ""
        status = page.get("status")
        verified = False
        snippet = ""
        if status and 200 <= status < 400 and html:
            for n in needle_variants:
                s = _extract_snippet(html, n)
                if s:
                    verified = True
                    snippet = s
                    break
        return {
            "url": u,
            "source_domain": c.get("source_domain") or (urlparse(u).netloc or "").lower(),
            "type": c.get("type") or "reference",
            "why": c.get("why") or "",
            "http_status": status,
            "verified": verified,
            "snippet": snippet[:400],
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        }

    verified_all = await asyncio.gather(*(verify(c) for c in unique))
    verified_all.sort(key=lambda r: (not r["verified"], -(r["http_status"] or 0)))
    return verified_all


# ----------------------- prompt ranking ------------------------------------

RANKING_SYSTEM = """You are a GEO/AEO analyst simulating how ChatGPT, Perplexity,
Google AI Overviews and Gemini would respond to search-style prompts, and whether a
given brand appears in those AI answers. Base predictions on the brand's real market
prominence. Return ONLY valid minified JSON."""


def ranking_prompt(domain: str, brand: str, summary: str, services: list[str]) -> str:
    return f"""BRAND: {brand} ({domain})
SUMMARY: {summary}
CORE_SERVICES: {json.dumps(services[:8])}

Step 1: derive {RANKING_PROMPTS} realistic search-style prompts a user would ask an AI
engine on the topics this brand plays in. Prefer commercial-intent prompts like
"best <category> for <use case>" or "top <thing> in <year>".

Step 2: for EACH prompt predict whether the brand appears in AI answers.

Return JSON:
{{"prompts":[{{"prompt":"...","position":"top|recommended|passing|none","mentioned":<bool>,"engines":{{"chatgpt":<bool>,"perplexity":<bool>,"google_ai":<bool>,"gemini":<bool>}},"note":"one line"}}]}}
Exactly {RANKING_PROMPTS} objects, ranked by relevance."""


async def rank_prompts(domain: str, brand: str, summary: str, services: list[str], llm_call) -> list[dict]:
    try:
        res = await llm_call(RANKING_SYSTEM, ranking_prompt(domain, brand or domain, summary or "", services or []),
                             f"rank-{domain}")
        rows = res.get("prompts") or []
    except Exception as e:
        logger.warning(f"rank_prompts: LLM failed: {e}")
        rows = []
    out: list[dict] = []
    for r in rows[:RANKING_PROMPTS]:
        out.append({
            "prompt": (r.get("prompt") or "").strip(),
            "position": r.get("position") or "none",
            "mentioned": bool(r.get("mentioned")),
            "engines": r.get("engines") or {},
            "note": r.get("note") or "",
        })
    return [r for r in out if r["prompt"]]


# ----------------------- brand discovery -----------------------------------

BRAND_SYSTEM = """You infer a brand's real name, one-line summary, and top core services
from the ACTUAL crawled homepage/pages. Never invent services the crawl doesn't support.
Return ONLY valid minified JSON."""


def brand_prompt(domain: str, pages: list[dict]) -> str:
    ctx = []
    for pg in pages[:5]:
        html = pg.get("html", "")
        soup = BeautifulSoup(html, "lxml")
        for t in soup(["script", "style", "noscript"]):
            t.decompose()
        text = re.sub(r"\s+", " ", soup.get_text(" ", strip=True))[:2000]
        ctx.append({"url": pg["url"], "text": text})
    return f"""DOMAIN: {domain}
CRAWL: {json.dumps(ctx)[:8000]}

Return JSON: {{"brand":"official name","summary":"1-2 sentence factual description","services":["service 1","service 2","service 3"]}}"""


async def discover_brand(domain: str, pages: list[dict], llm_call) -> dict:
    try:
        res = await llm_call(BRAND_SYSTEM, brand_prompt(domain, pages), f"brand-{domain}")
        return {
            "brand": (res.get("brand") or "").strip() or domain,
            "summary": (res.get("summary") or "").strip(),
            "services": [s.strip() for s in (res.get("services") or []) if s and isinstance(s, str)][:8],
        }
    except Exception as e:
        logger.warning(f"discover_brand: LLM failed: {e}")
        return {"brand": domain, "summary": "", "services": []}


# ----------------------- top-level runner ----------------------------------


async def run_full_project_scan(domain: str, llm_call, max_pages: int = DEFAULT_MAX_PAGES) -> dict:
    """
    Orchestrator: deep-crawl the domain, analyze each page, discover the brand via LLM,
    find citations, rank prompts. Returns a dict ready to be persisted.
    """
    # 1) Deep crawl
    raw_pages = await deep_crawl(domain, max_pages=max_pages)
    if not raw_pages:
        return {
            "status": "error",
            "error": "Could not reach or crawl this domain.",
            "pages": [], "citations": [], "rankings": [], "brand": {},
            **aggregate_project([], [], []),
        }

    # 2) Per-page analysis (CPU work — run in threads)
    analyzed = await asyncio.gather(*(asyncio.to_thread(analyze_page, p) for p in raw_pages))

    # 3) Brand discovery (LLM)
    brand = await discover_brand(domain, raw_pages, llm_call)

    # 4) Citations + Rankings in parallel (independent LLM calls + HTTP)
    citations_task = discover_citations(domain, brand["brand"], brand["summary"], llm_call)
    rankings_task = rank_prompts(domain, brand["brand"], brand["summary"], brand["services"], llm_call)
    citations, rankings = await asyncio.gather(citations_task, rankings_task)

    aggregates = aggregate_project(analyzed, citations, rankings)

    return {
        "status": "done",
        "brand": brand,
        "pages": analyzed,
        "citations": citations,
        "rankings": rankings,
        **aggregates,
    }


def new_project_doc(user_id: str, domain: str) -> dict:
    return {
        "id": secrets.token_hex(12),
        "user_id": user_id,
        "domain": domain,
        "status": "processing",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "site_health_score": None,
        "ai_readiness_score": None,
        "total_pages": 0,
        "total_issues": 0,
        "ai_citations_count": 0,
        "prompt_rankings_count": 0,
        "prompt_top_count": 0,
        "brand": {},
        "error": None,
    }
