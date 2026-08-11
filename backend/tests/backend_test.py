"""GEOrank backend integration tests.

Covers auth, dashboard, domain analyze, visibility, citations, reddit,
and the existing content optimizer endpoints. Uses cookie-based auth via
`requests.Session`.
"""
import os
import re
import time
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if 'REACT_APP_BACKEND_URL' in os.environ else 'https://content-scorer-29.preview.emergentagent.com'
API = f"{BASE_URL}/api"

TEST_EMAIL = f"tester1@geo.com"
TEST_PW = "pass123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def auth_session(session):
    r = session.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PW}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("email") == TEST_EMAIL
    # cookies now on session
    return session


# ---------- Auth ----------
class TestAuth:
    def test_login_success(self, auth_session):
        r = auth_session.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == TEST_EMAIL

    def test_login_wrong_pw(self, session):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_me_unauthenticated(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401


# ---------- Remember-me cookie behavior (iteration 2) ----------
def _cookie_maxage(set_cookie_headers, name):
    """Return int Max-Age of the given cookie name from a list of Set-Cookie headers."""
    for h in set_cookie_headers:
        if h.startswith(f"{name}="):
            m = re.search(r"[Mm]ax-[Aa]ge=(\d+)", h)
            if m:
                return int(m.group(1))
    return None


class TestRememberMe:
    def test_remember_true_15_day_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": TEST_EMAIL, "password": TEST_PW, "remember": True},
                   timeout=15)
        assert r.status_code == 200, r.text
        # requests exposes multi-Set-Cookie via r.raw.headers (case-insensitive multimap)
        set_cookies = r.raw.headers.getlist("Set-Cookie") if hasattr(r.raw.headers, "getlist") else r.headers.get("Set-Cookie", "").split(",")
        access_max = _cookie_maxage(set_cookies, "access_token")
        refresh_max = _cookie_maxage(set_cookies, "refresh_token")
        assert access_max == 15 * 86400, f"expected 1296000, got {access_max} (headers: {set_cookies})"
        assert refresh_max == 15 * 86400, f"expected 1296000, got {refresh_max}"
        # Land on /app: verify user object is returned
        assert r.json()["email"] == TEST_EMAIL
        # /api/auth/me still works with the session cookies
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        assert me.json()["email"] == TEST_EMAIL

    def test_remember_false_short_cookie(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": TEST_EMAIL, "password": TEST_PW, "remember": False},
                   timeout=15)
        assert r.status_code == 200, r.text
        set_cookies = r.raw.headers.getlist("Set-Cookie") if hasattr(r.raw.headers, "getlist") else r.headers.get("Set-Cookie", "").split(",")
        access_max = _cookie_maxage(set_cookies, "access_token")
        refresh_max = _cookie_maxage(set_cookies, "refresh_token")
        assert access_max == 900, f"expected 900, got {access_max}"
        assert refresh_max == 7 * 86400, f"expected 604800, got {refresh_max}"

    def test_remember_default_omitted_short_cookie(self):
        # Backward-compat: if remember flag omitted, treat as False -> short session
        s = requests.Session()
        r = s.post(f"{API}/auth/login",
                   json={"email": TEST_EMAIL, "password": TEST_PW},
                   timeout=15)
        assert r.status_code == 200
        set_cookies = r.raw.headers.getlist("Set-Cookie") if hasattr(r.raw.headers, "getlist") else r.headers.get("Set-Cookie", "").split(",")
        access_max = _cookie_maxage(set_cookies, "access_token")
        assert access_max == 900


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_shape(self, auth_session):
        r = auth_session.get(f"{API}/dashboard", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "stats" in d and "content_trend" in d and "visibility_trend" in d and "activity" in d
        s = d["stats"]
        for k in ["analyses", "domains", "visibility_runs", "citation_runs", "reddit_runs",
                  "avg_content_score", "avg_domain_score", "avg_visibility"]:
            assert k in s, f"missing key {k}"


# ---------- Domain analyze (LLM) ----------
class TestDomain:
    def test_domain_analyze_and_list(self, auth_session):
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "notion.so"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        # structural fields
        for k in ["id", "domain", "ai_readiness_score", "categories", "quick_wins", "top_topics", "competitors", "brand_summary"]:
            assert k in d, f"missing {k}"
        assert isinstance(d["ai_readiness_score"], int)
        assert 0 <= d["ai_readiness_score"] <= 100
        assert isinstance(d["categories"], list) and len(d["categories"]) >= 3
        assert isinstance(d["quick_wins"], list) and len(d["quick_wins"]) >= 1
        # brand recognition: notion should be known
        assert d.get("known_by_ai") in (True, False)
        # non-empty AI content
        assert len(d.get("brand_summary", "")) > 10

        # list
        rl = auth_session.get(f"{API}/domain", timeout=15)
        assert rl.status_code == 200
        arr = rl.json()
        assert any(x["id"] == d["id"] for x in arr)

    def test_domain_empty_400(self, auth_session):
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": ""}, timeout=15)
        assert r.status_code == 400


# ---------- Visibility (LLM) ----------
class TestVisibility:
    def test_visibility_scan(self, auth_session):
        payload = {
            "brand": "Notion",
            "domain": "notion.so",
            "prompts": ["best note taking app for teams", "top project management tools"],
        }
        r = auth_session.post(f"{API}/visibility", json=payload, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "visibility_score" in d and "share_of_voice" in d
        assert isinstance(d["results"], list) and len(d["results"]) == 2
        first = d["results"][0]
        for k in ["prompt", "mentioned", "position", "engines"]:
            assert k in first
        engines = first["engines"]
        for e in ["chatgpt", "perplexity", "google_ai", "gemini"]:
            assert e in engines
        # sanity
        assert 0 <= d["visibility_score"] <= 100

    def test_visibility_missing_prompts_400(self, auth_session):
        r = auth_session.post(f"{API}/visibility", json={"brand": "X", "prompts": []}, timeout=15)
        assert r.status_code == 400


# ---------- Citations (LLM) ----------
class TestCitations:
    def test_citations_with_domain(self, auth_session):
        r = auth_session.post(f"{API}/citations", json={"query": "best crm for startups", "domain": "hubspot.com"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("query") == "best crm for startups"
        assert isinstance(d["sources"], list) and len(d["sources"]) >= 3
        s0 = d["sources"][0]
        for k in ["domain", "title", "type", "likelihood"]:
            assert k in s0
        assert d.get("user_domain") == "hubspot.com"
        assert d.get("user_domain_cited") in (True, False, None)


# ---------- Reddit (LLM) ----------
class TestReddit:
    def test_reddit_find(self, auth_session):
        r = auth_session.post(f"{API}/reddit", json={"topic": "project management software"}, timeout=90)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("topic") == "project management software"
        assert isinstance(d["subreddits"], list) and len(d["subreddits"]) >= 3
        assert isinstance(d["threads"], list) and len(d["threads"]) >= 3
        assert d["subreddits"][0].get("name", "").startswith("r/") or d["subreddits"][0].get("name") is not None


# ---------- Content Optimizer (existing) ----------
class TestOptimizer:
    def test_analyze_text_and_detail(self, auth_session):
        text = (
            "# What is Retrieval-Augmented Generation?\n\n"
            "Retrieval-Augmented Generation (RAG) is a technique that combines a large language model "
            "with an external knowledge source. RAG improves factuality by retrieving relevant documents "
            "before generating an answer. \n\n"
            "## How does RAG work?\n\n"
            "A retriever finds relevant snippets from a vector database and passes them to the generator, "
            "which produces a grounded answer. \n\n"
            "## Benefits\n- Fewer hallucinations\n- Up-to-date information\n- Source citations\n"
        )
        r = auth_session.post(f"{API}/analyses", json={"input_type": "text", "content": text, "target_query": "what is RAG"}, timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "id" in d and isinstance(d["overall_score"], int)
        assert isinstance(d["dimensions"], list) and len(d["dimensions"]) >= 5
        # persistence via GET
        aid = d["id"]
        r2 = auth_session.get(f"{API}/analyses/{aid}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["id"] == aid

        # list
        rl = auth_session.get(f"{API}/analyses", timeout=15)
        assert rl.status_code == 200
        assert any(a["id"] == aid for a in rl.json())


# ---------- URL analysis + JS scraper fallback (iteration 2) ----------
# The full URL analysis takes 30-70s (Chromium render + LLM). The preview ingress
# cuts around 60s. We drive this test through the in-cluster backend
# (http://localhost:8001) so the request completes end-to-end. This still exercises
# the same real code path a user hits.
LOCAL_API = "http://localhost:8001/api"


class TestUrlAnalysis:
    def test_url_analysis_js_heavy_page(self):
        s = requests.Session()
        r = s.post(f"{LOCAL_API}/auth/login",
                   json={"email": TEST_EMAIL, "password": TEST_PW}, timeout=15)
        assert r.status_code == 200, r.text
        # requests may not persist Secure cookies on http://localhost; extract token
        # from Set-Cookie and use Authorization header (backend supports both).
        access = None
        cookies = r.raw.headers.getlist("Set-Cookie") if hasattr(r.raw.headers, "getlist") else []
        for h in cookies:
            m = re.match(r"access_token=([^;]+)", h)
            if m:
                access = m.group(1)
                break
        assert access, f"could not extract access_token from cookies: {cookies}"
        s.headers.update({"Authorization": f"Bearer {access}"})

        r = s.post(
            f"{LOCAL_API}/analyses",
            json={"input_type": "url", "content": "https://quotes.toscrape.com/js/",
                  "target_query": "famous quotes"},
            timeout=150,
        )
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:400]}"
        d = r.json()
        for k in ("id", "title", "word_count", "dimensions", "overall_score"):
            assert k in d, f"missing {k}"
        # JS-rendered content -> word_count must be well above static (~17 words)
        assert isinstance(d["word_count"], int)
        assert d["word_count"] >= 100, f"word_count too low, static-only fetch suspected: {d['word_count']}"
        assert isinstance(d["overall_score"], int) and 0 <= d["overall_score"] <= 100
        assert isinstance(d["dimensions"], list) and len(d["dimensions"]) >= 5
        # persistence via GET
        aid = d["id"]
        r2 = s.get(f"{LOCAL_API}/analyses/{aid}", timeout=15)
        assert r2.status_code == 200
        assert r2.json()["source_url"] == "https://quotes.toscrape.com/js/"
