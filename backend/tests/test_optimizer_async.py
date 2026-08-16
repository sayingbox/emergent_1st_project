"""Iteration 6: Content Optimizer async flow, 404 handling, freshness, list resilience.

- POST /api/analyses returns {id, status:'processing'} immediately.
- Background _run_analysis transitions to 'done' or 'error'.
- 404 URLs must end in status='error' (not 'done').
- Same URL analyzed twice yields two independent 'done' docs (fresh scores allowed).
- GET /api/analyses, /api/analyses/history, /api/dashboard must not 500 and must
  filter processing/error out of listings.
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

SUPER_EMAIL = "kiskobiswal@gmail.com"
SUPER_PW = "Kisko@123"


@pytest.fixture(scope="module")
def auth():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PW}, timeout=15)
    assert r.status_code == 200, r.text
    return s


def _poll_analysis(auth, aid, deadline_s=180):
    deadline = time.time() + deadline_s
    last = None
    while time.time() < deadline:
        time.sleep(4)
        r = auth.get(f"{API}/analyses/{aid}", timeout=15)
        assert r.status_code == 200, r.text
        last = r.json()
        s = last.get("status")
        if s in ("done", "error"):
            return last
    pytest.fail(f"analysis {aid} did not finish in {deadline_s}s: last={last}")


class TestOptimizerAsync:
    def test_post_url_returns_processing_fast(self, auth):
        t0 = time.time()
        r = auth.post(f"{API}/analyses",
                      json={"input_type": "url",
                            "content": "https://en.wikipedia.org/wiki/Content_marketing",
                            "target_query": "what is content marketing"},
                      timeout=10)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "processing", d
        assert "id" in d
        assert elapsed < 5.0, f"POST should be near-instant, took {elapsed:.2f}s"

    def test_valid_url_reaches_done_wikipedia(self, auth):
        r = auth.post(f"{API}/analyses",
                      json={"input_type": "url",
                            "content": "https://en.wikipedia.org/wiki/Content_marketing",
                            "target_query": "what is content marketing"},
                      timeout=10)
        assert r.status_code == 200
        aid = r.json()["id"]
        report = _poll_analysis(auth, aid, deadline_s=200)
        assert report["status"] == "done", f"expected done, got {report}"
        assert isinstance(report.get("overall_score"), int)
        assert 0 <= report["overall_score"] <= 100
        assert isinstance(report.get("dimensions"), list) and len(report["dimensions"]) >= 5
        assert isinstance(report.get("recommendations"), list)
        assert report.get("word_count", 0) >= 1000, f"expected thousands of words on wiki page, got {report.get('word_count')}"
        title = (report.get("title") or "").lower()
        assert "content marketing" in title, f"title should reflect real page: {report.get('title')}"

    def test_404_url_ends_in_error(self, auth):
        r = auth.post(f"{API}/analyses",
                      json={"input_type": "url",
                            "content": "https://blog.hubspot.com/marketing/what-is-content-marketing",
                            "target_query": "content marketing"},
                      timeout=10)
        assert r.status_code == 200
        aid = r.json()["id"]
        report = _poll_analysis(auth, aid, deadline_s=120)
        assert report["status"] == "error", f"404 page must NOT be scored 'done'. Got: {report}"
        err = (report.get("error") or "").lower()
        assert ("404" in err or "not found" in err or "http 4" in err), f"error should mention 404/not found: {err}"

    def test_text_input_reaches_done(self, auth):
        text = (
            "# What is Semantic Search?\n\n"
            "Semantic search understands the intent and contextual meaning of a query rather than "
            "matching keywords literally. It uses embeddings to compare vector similarity between "
            "documents and queries. \n\n"
            "## Benefits\n- Better relevance\n- Handles synonyms\n- Understands intent\n\n"
            "## How it works\nAn embedding model converts text into dense vectors, stored in a vector "
            "database. At query time the query embedding is compared to document embeddings using "
            "cosine similarity, and the closest documents are returned as results."
        )
        r = auth.post(f"{API}/analyses",
                      json={"input_type": "text", "content": text, "target_query": "what is semantic search"},
                      timeout=10)
        assert r.status_code == 200
        aid = r.json()["id"]
        report = _poll_analysis(auth, aid, deadline_s=180)
        assert report["status"] == "done", report
        assert isinstance(report["overall_score"], int) and 0 <= report["overall_score"] <= 100
        assert isinstance(report["dimensions"], list) and len(report["dimensions"]) >= 5

    def test_rerun_same_url_produces_fresh_independent_reports(self, auth):
        url = "https://en.wikipedia.org/wiki/Content_marketing"
        # First run
        r1 = auth.post(f"{API}/analyses",
                       json={"input_type": "url", "content": url, "target_query": "what is content marketing"},
                       timeout=10)
        assert r1.status_code == 200
        aid1 = r1.json()["id"]
        rep1 = _poll_analysis(auth, aid1, deadline_s=200)
        assert rep1["status"] == "done", rep1

        # Second run
        r2 = auth.post(f"{API}/analyses",
                       json={"input_type": "url", "content": url, "target_query": "what is content marketing"},
                       timeout=10)
        assert r2.status_code == 200
        aid2 = r2.json()["id"]
        assert aid1 != aid2, "each analyze call must produce a distinct id"
        rep2 = _poll_analysis(auth, aid2, deadline_s=200)
        assert rep2["status"] == "done", rep2

        # Both should show up in list
        lst = auth.get(f"{API}/analyses", timeout=15)
        assert lst.status_code == 200
        ids = {a["id"] for a in lst.json()}
        assert aid1 in ids and aid2 in ids, f"both runs must be listed, got {ids}"

        # Independent docs (created_at differ; overall_score can be same, that's fine)
        assert rep1.get("created_at") != rep2.get("created_at")

    def test_list_and_history_filter_processing_and_dashboard_ok(self, auth):
        # Fire an analysis that will be processing for ~30-60s
        r = auth.post(f"{API}/analyses",
                      json={"input_type": "url",
                            "content": "https://en.wikipedia.org/wiki/Retrieval-augmented_generation",
                            "target_query": "what is RAG"},
                      timeout=10)
        assert r.status_code == 200
        pending_id = r.json()["id"]

        # Immediately check list/history/dashboard don't 500 and don't include processing
        lst = auth.get(f"{API}/analyses", timeout=15)
        assert lst.status_code == 200
        assert not any(a["id"] == pending_id for a in lst.json()), \
            "list should exclude currently-processing analyses"

        hist = auth.get(f"{API}/analyses/history", timeout=15)
        assert hist.status_code == 200
        # history groups by url/title: [{key, points:[{id, score, ...}]}]
        pending_in_hist = False
        for grp in hist.json():
            for p in grp.get("points", []):
                if p.get("id") == pending_id:
                    pending_in_hist = True
        assert not pending_in_hist, "history should exclude currently-processing analyses"

        dash = auth.get(f"{API}/dashboard", timeout=20)
        assert dash.status_code == 200, dash.text
        assert "stats" in dash.json()
