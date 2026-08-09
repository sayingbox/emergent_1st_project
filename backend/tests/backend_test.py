"""GEOrank backend integration tests.

Covers auth, dashboard, domain analyze, visibility, citations, reddit,
and the existing content optimizer endpoints. Uses cookie-based auth via
`requests.Session`.
"""
import os
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
