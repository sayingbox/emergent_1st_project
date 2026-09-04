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

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') if 'REACT_APP_BACKEND_URL' in os.environ else 'https://zero-error-deploy-4.preview.emergentagent.com'
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
    def test_domain_analyze_post_is_async(self, auth_session):
        """POST /api/domain/analyze now returns {id, status:'processing'} instantly."""
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "notion.so"}, timeout=10)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "processing"
        assert "id" in d and d.get("domain") == "notion.so"

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


# ---------- Iteration 3: Superadmin entitlement ----------
SUPERADMIN_EMAIL = "kiskobiswal@gmail.com"
SUPERADMIN_PW = "super123"


class TestSuperadminEntitlement:
    def test_superadmin_login_grants_admin_and_full_access(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/login",
                   json={"email": SUPERADMIN_EMAIL, "password": SUPERADMIN_PW},
                   timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["email"] == SUPERADMIN_EMAIL
        assert d["role"] == "admin", f"expected role admin got {d.get('role')}"
        assert d["full_access"] is True, f"expected full_access True got {d.get('full_access')}"

        # /api/auth/me also returns the same entitlements
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        me_d = me.json()
        assert me_d["email"] == SUPERADMIN_EMAIL
        assert me_d["role"] == "admin"
        assert me_d["full_access"] is True

    def test_normal_user_has_no_full_access(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json"})
        r = s.post(f"{API}/auth/login",
                   json={"email": TEST_EMAIL, "password": TEST_PW},
                   timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "user"
        assert d["full_access"] is False, f"normal user should not have full_access, got {d.get('full_access')}"
        # /api/auth/me matches
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        assert me.json()["full_access"] is False


# ---------- Iteration 4: Domain async job (Serper-verified, strict, no hallucination) ----------
def _poll_domain(auth_session, job_id, deadline_s=180):
    deadline = time.time() + deadline_s
    report = None
    while time.time() < deadline:
        time.sleep(4)
        gr = auth_session.get(f"{API}/domain/{job_id}", timeout=15)
        assert gr.status_code == 200, gr.text
        report = gr.json()
        s = report.get("status")
        if s == "done":
            return report
        if s == "error":
            pytest.fail(f"domain job errored: {report.get('error')}")
    pytest.fail(f"job did not finish in {deadline_s}s, last status={report.get('status') if report else None}")


class TestDomainAsyncJob:
    """POST /api/domain/analyze returns {id,status:'processing'} fast.
    Poll GET /api/domain/{id} to done. Verify Serper-verified citations/rankings and
    Claude in engines_checked, strict topic ties, and no fabrication for obscure sites."""

    def test_domain_post_returns_processing_fast(self, auth_session):
        t0 = time.time()
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "stripe.com"}, timeout=5)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "processing"
        assert elapsed < 3.0, f"POST should be near-instant, took {elapsed:.2f}s"
        assert "id" in d

    def test_domain_empty_400(self, auth_session):
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": ""}, timeout=15)
        assert r.status_code == 400

    def test_stripe_verified_citations_and_rankings(self, auth_session):
        """Well-known domain: expect verified real citation domains, Claude in engines,
        every ranking prompt tied to a top_topic AND has a numeric google_rank."""
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "stripe.com"}, timeout=10)
        assert r.status_code == 200, r.text
        job_id = r.json()["id"]
        report = _poll_domain(auth_session, job_id, deadline_s=180)

        # Engines checked must include Claude in the exact required order.
        assert report.get("engines_checked") == ["Google", "ChatGPT", "Claude", "Perplexity", "Gemini"], \
            report.get("engines_checked")

        # Verified flag + Serper data source
        assert report.get("verified") is True
        assert "Serper" in (report.get("data_source") or "")

        cites = report.get("citation_sources", [])
        prompts = report.get("ranking_prompts", [])
        # For stripe.com we expect meaningful signal (self-test showed 18 cites / 15 rankings)
        assert isinstance(cites, list) and len(cites) >= 5, f"stripe.com should have >=5 verified citations, got {len(cites)}"
        assert isinstance(prompts, list) and len(prompts) >= 3, f"stripe.com should have >=3 verified rankings, got {len(prompts)}"

        # Each citation_source entry has all required fields, no self-reference
        for c in cites:
            for k in ("source", "url", "title", "snippet", "query", "position"):
                assert k in c, f"citation_source missing {k}: {c}"
            # source must not be the target domain itself
            assert "stripe.com" not in (c["source"] or "").lower() or c["source"] != "stripe.com"

        # Every ranking prompt: verified=True and has integer google_rank in 1..10
        for p in prompts:
            assert p.get("verified") is True, f"prompt not verified: {p}"
            gr = p.get("google_rank")
            assert isinstance(gr, int) and 1 <= gr <= 10, f"invalid google_rank: {p}"
            # url is on the target domain (matches _same_domain semantics)
            u = (p.get("url") or "").lower()
            assert "stripe.com" in u, f"ranking_prompts[i].url should be on stripe.com: {u}"

        # Every ranking prompt topic must map to a top_topic (strict topic tie)
        top_topics = [t.strip().lower() for t in report.get("top_topics", []) if isinstance(t, str) and t.strip()]
        assert top_topics, "top_topics missing/empty"

        def matches(pt: str) -> bool:
            pt = (pt or "").strip().lower()
            return bool(pt) and any(pt == tt or pt in tt or tt in pt for tt in top_topics)

        off_topic = [p for p in prompts if not matches(p.get("topic", ""))]
        assert not off_topic, f"{len(off_topic)} ranking_prompts off-topic. eg {off_topic[0] if off_topic else None} vs {top_topics}"

        # Metrics must reflect counts (no fabricated DA/backlinks/traffic anymore)
        m = report.get("metrics") or {}
        assert m.get("verified_citations") == len(cites)
        assert m.get("verified_rankings") == len(prompts)
        for legacy in ("domain_authority", "backlinks", "traffic"):
            assert legacy not in m, f"legacy fabricated metric {legacy} should not be present: {m}"

    def test_citetail_strict_no_hallucination(self, auth_session):
        """Obscure domain: strict mode returns few/zero citations and zero rankings.
        Big sites like en.wikipedia.org must NOT be listed unless they truly appear."""
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "citetail.com"}, timeout=10)
        assert r.status_code == 200
        job_id = r.json()["id"]
        report = _poll_domain(auth_session, job_id, deadline_s=180)

        cites = report.get("citation_sources", [])
        prompts = report.get("ranking_prompts", [])
        # Strict acceptance: few/zero. Not a bug.
        assert isinstance(cites, list) and len(cites) <= 10, f"strict mode: expected <=10 citations for citetail.com, got {len(cites)}"
        # Not enforcing zero (some incidental match is OK), but assert small set
        # Ranking prompts should be zero or very few (self-test showed 0)
        assert isinstance(prompts, list) and len(prompts) <= 3, f"strict mode: expected <=3 rankings for citetail.com, got {len(prompts)}"

        # Every citation must contain the brand name or domain literal in title+snippet+url
        # (otherwise it's a fabricated 'big site' with no real link to the brand)
        brand_key = "citetail"
        for c in cites:
            blob = f"{c.get('title','')} {c.get('snippet','')} {c.get('url','')}".lower()
            assert brand_key in blob or "citetail.com" in blob, (
                f"hallucinated citation (no brand link): {c}"
            )

        # Engines must still include Claude
        assert "Claude" in (report.get("engines_checked") or []), report.get("engines_checked")

    def test_notion_or_stripe_citation_sources_are_real_domains(self, auth_session):
        """Spot-check that returned citation source domains are plausible (registrable
        domain, not internal/local, not equal to target)."""
        r = auth_session.post(f"{API}/domain/analyze", json={"domain": "notion.so"}, timeout=10)
        assert r.status_code == 200
        job_id = r.json()["id"]
        report = _poll_domain(auth_session, job_id, deadline_s=180)

        cites = report.get("citation_sources", [])
        assert len(cites) >= 5, f"notion.so should surface >=5 real citations, got {len(cites)}"

        bad = []
        for c in cites:
            src = (c.get("source") or "").lower()
            url = (c.get("url") or "").lower()
            # Well-formed registrable domain: has a dot, not localhost/private
            if not src or "." not in src or src.endswith(".local") or src == "notion.so" or not url.startswith("http"):
                bad.append(c)
        assert not bad, f"{len(bad)} malformed citation sources: {bad[:2]}"


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
