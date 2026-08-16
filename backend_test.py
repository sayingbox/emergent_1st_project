#!/usr/bin/env python3
"""
Backend regression test suite for Domain Analysis (LLM-only, Serper removed)
Tests all critical backend endpoints with focus on domain analysis flow.
"""

import requests
import time
import json
import sys
from typing import Dict, Any, Optional

# Base URL from frontend/.env
BASE_URL = "https://github-deploy-84.preview.emergentagent.com/api"

# Test credentials from /app/memory/test_credentials.md
TEST_EMAIL = "admin@geo.com"
TEST_PASSWORD = "admin123"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def log_success(msg: str):
    print(f"{Colors.GREEN}✓ {msg}{Colors.RESET}")

def log_error(msg: str):
    print(f"{Colors.RED}✗ {msg}{Colors.RESET}")

def log_info(msg: str):
    print(f"{Colors.BLUE}ℹ {msg}{Colors.RESET}")

def log_warning(msg: str):
    print(f"{Colors.YELLOW}⚠ {msg}{Colors.RESET}")

class BackendTester:
    def __init__(self):
        self.session = requests.Session()
        self.user_id = None
        self.access_token = None
        self.failures = []
        self.successes = []
        
    def add_failure(self, test_name: str, reason: str):
        self.failures.append({"test": test_name, "reason": reason})
        log_error(f"{test_name}: {reason}")
        
    def add_success(self, test_name: str):
        self.successes.append(test_name)
        log_success(test_name)
        
    def test_auth_register_login(self) -> bool:
        """Test auth registration and login with cookies"""
        log_info("Testing auth flow (register/login)...")
        
        # Try login first with existing credentials
        try:
            resp = self.session.post(
                f"{BASE_URL}/auth/login",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "remember": True}
            )
            
            if resp.status_code == 200:
                data = resp.json()
                if "id" in data and "email" in data:
                    self.user_id = data["id"]
                    # Check cookies
                    if "access_token" in self.session.cookies and "refresh_token" in self.session.cookies:
                        self.add_success("Auth login with cookies")
                        return True
                    else:
                        self.add_failure("Auth login", "No cookies set")
                        return False
                else:
                    self.add_failure("Auth login", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("Auth login", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("Auth login", f"Exception: {e}")
            return False
            
    def test_auth_me(self) -> bool:
        """Test GET /api/auth/me with cookies"""
        log_info("Testing GET /api/auth/me...")
        
        try:
            resp = self.session.get(f"{BASE_URL}/auth/me")
            
            if resp.status_code == 200:
                data = resp.json()
                if "id" in data and "email" in data:
                    self.add_success("GET /api/auth/me")
                    return True
                else:
                    self.add_failure("GET /api/auth/me", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("GET /api/auth/me", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("GET /api/auth/me", f"Exception: {e}")
            return False
            
    def test_domain_analyze_instant_response(self) -> Optional[str]:
        """Test POST /api/domain/analyze returns instantly with processing status"""
        log_info("Testing POST /api/domain/analyze (instant response)...")
        
        try:
            start_time = time.time()
            resp = self.session.post(
                f"{BASE_URL}/domain/analyze",
                json={"domain": "stripe.com"}
            )
            elapsed = time.time() - start_time
            
            if resp.status_code == 200:
                data = resp.json()
                
                # Check response time
                if elapsed > 5:
                    self.add_failure("POST /api/domain/analyze (instant)", f"Took {elapsed:.2f}s (should be < 5s)")
                    return None
                    
                # Check response shape
                if "id" not in data or "domain" not in data or "status" not in data:
                    self.add_failure("POST /api/domain/analyze", f"Missing fields in response: {data}")
                    return None
                    
                if data["status"] != "processing":
                    self.add_failure("POST /api/domain/analyze", f"Expected status 'processing', got '{data['status']}'")
                    return None
                    
                if data["domain"] != "stripe.com":
                    self.add_failure("POST /api/domain/analyze", f"Expected domain 'stripe.com', got '{data['domain']}'")
                    return None
                    
                self.add_success(f"POST /api/domain/analyze (instant, {elapsed:.2f}s)")
                return data["id"]
                
            else:
                self.add_failure("POST /api/domain/analyze", f"Status {resp.status_code}: {resp.text}")
                return None
                
        except Exception as e:
            self.add_failure("POST /api/domain/analyze", f"Exception: {e}")
            return None
            
    def test_domain_poll_until_done(self, job_id: str, max_wait: int = 180) -> Optional[Dict[str, Any]]:
        """Poll GET /api/domain/{id} until status is 'done' or timeout"""
        log_info(f"Polling GET /api/domain/{job_id} (max {max_wait}s)...")
        
        start_time = time.time()
        poll_count = 0
        
        while time.time() - start_time < max_wait:
            poll_count += 1
            
            try:
                resp = self.session.get(f"{BASE_URL}/domain/{job_id}")
                
                if resp.status_code == 200:
                    data = resp.json()
                    status = data.get("status")
                    
                    if status == "done":
                        elapsed = time.time() - start_time
                        self.add_success(f"GET /api/domain/{job_id} reached 'done' in {elapsed:.1f}s ({poll_count} polls)")
                        return data
                        
                    elif status == "error":
                        error_msg = data.get("error", "Unknown error")
                        self.add_failure("Domain analysis", f"Job failed with error: {error_msg}")
                        return None
                        
                    elif status == "processing":
                        # Still processing, wait and retry
                        time.sleep(5)
                        continue
                        
                    else:
                        self.add_failure("Domain analysis", f"Unknown status: {status}")
                        return None
                        
                else:
                    self.add_failure(f"GET /api/domain/{job_id}", f"Status {resp.status_code}: {resp.text}")
                    return None
                    
            except Exception as e:
                self.add_failure(f"GET /api/domain/{job_id}", f"Exception: {e}")
                return None
                
        self.add_failure("Domain analysis", f"Timeout after {max_wait}s")
        return None
        
    def verify_domain_response_shape(self, data: Dict[str, Any]) -> bool:
        """Verify the domain analysis response has all required fields"""
        log_info("Verifying domain analysis response shape...")
        
        errors = []
        
        # Check data_source
        expected_data_source = "AI-simulated (Claude Sonnet 4.6, Emergent LLM key)"
        if data.get("data_source") != expected_data_source:
            errors.append(f"data_source: expected '{expected_data_source}', got '{data.get('data_source')}'")
            
        # Check ai_readiness_score
        ai_score = data.get("ai_readiness_score")
        if not isinstance(ai_score, int) or not (0 <= ai_score <= 100):
            errors.append(f"ai_readiness_score: expected int 0-100, got {ai_score}")
            
        # Check metrics
        metrics = data.get("metrics", {})
        required_metrics = ["domain_authority", "page_authority", "trust_score", 
                           "estimated_backlinks", "referring_domains", "estimated_monthly_traffic"]
        for metric in required_metrics:
            if metric not in metrics:
                errors.append(f"metrics.{metric}: missing")
            elif metric in ["domain_authority", "page_authority", "trust_score"]:
                # These should be integers 0-100
                val = metrics[metric]
                if not isinstance(val, int) or not (0 <= val <= 100):
                    errors.append(f"metrics.{metric}: expected int 0-100, got {val}")
            else:
                # These should be strings
                val = metrics[metric]
                if not isinstance(val, str):
                    errors.append(f"metrics.{metric}: expected string, got {type(val).__name__}")
                    
        # Check categories
        categories = data.get("categories", [])
        if not isinstance(categories, list) or len(categories) != 5:
            errors.append(f"categories: expected array of 5 items, got {len(categories) if isinstance(categories, list) else 'not an array'}")
        else:
            for i, cat in enumerate(categories):
                if not isinstance(cat, dict):
                    errors.append(f"categories[{i}]: not an object")
                elif not all(k in cat for k in ["label", "score", "note"]):
                    errors.append(f"categories[{i}]: missing required fields (label/score/note)")
                    
        # Check top_topics
        top_topics = data.get("top_topics", [])
        if not isinstance(top_topics, list) or len(top_topics) < 6:
            errors.append(f"top_topics: expected array of >= 6 items, got {len(top_topics) if isinstance(top_topics, list) else 'not an array'}")
        else:
            for i, topic in enumerate(top_topics[:3]):  # Check first 3
                if not isinstance(topic, dict):
                    errors.append(f"top_topics[{i}]: not an object")
                elif not all(k in topic for k in ["topic", "authority", "relevance"]):
                    errors.append(f"top_topics[{i}]: missing required fields (topic/authority/relevance)")
                    
        # Check citation_sources
        citation_sources = data.get("citation_sources", [])
        if not isinstance(citation_sources, list) or len(citation_sources) < 50:
            errors.append(f"citation_sources: expected array of >= 50 items, got {len(citation_sources) if isinstance(citation_sources, list) else 'not an array'}")
        else:
            for i, source in enumerate(citation_sources[:3]):  # Check first 3
                if not isinstance(source, dict):
                    errors.append(f"citation_sources[{i}]: not an object")
                elif not all(k in source for k in ["source", "url", "type", "authority", "why"]):
                    errors.append(f"citation_sources[{i}]: missing required fields")
                elif not isinstance(source.get("authority"), int):
                    errors.append(f"citation_sources[{i}].authority: expected int, got {type(source.get('authority')).__name__}")
                    
        # Check ranking_prompts
        ranking_prompts = data.get("ranking_prompts", [])
        if not isinstance(ranking_prompts, list) or len(ranking_prompts) < 50:
            errors.append(f"ranking_prompts: expected array of >= 50 items, got {len(ranking_prompts) if isinstance(ranking_prompts, list) else 'not an array'}")
        else:
            # Verify every prompt.topic matches one of top_topics[].topic
            topic_names = {t.get("topic", "").lower() for t in top_topics if isinstance(t, dict)}
            
            for i, prompt in enumerate(ranking_prompts[:5]):  # Check first 5
                if not isinstance(prompt, dict):
                    errors.append(f"ranking_prompts[{i}]: not an object")
                elif not all(k in prompt for k in ["prompt", "topic", "position", "engines", "intent"]):
                    errors.append(f"ranking_prompts[{i}]: missing required fields")
                else:
                    # Check topic match
                    prompt_topic = prompt.get("topic", "").lower()
                    if not any(prompt_topic in tn or tn in prompt_topic for tn in topic_names):
                        errors.append(f"ranking_prompts[{i}].topic '{prompt.get('topic')}' does not match any top_topics")
                        
                    # Check position
                    if prompt.get("position") not in ["top", "recommended", "passing"]:
                        errors.append(f"ranking_prompts[{i}].position: expected 'top'|'recommended'|'passing', got '{prompt.get('position')}'")
                        
                    # Check engines is array
                    if not isinstance(prompt.get("engines"), list):
                        errors.append(f"ranking_prompts[{i}].engines: expected array, got {type(prompt.get('engines')).__name__}")
                        
        # Check quick_wins
        quick_wins = data.get("quick_wins", [])
        if not isinstance(quick_wins, list) or not (5 <= len(quick_wins) <= 8):
            errors.append(f"quick_wins: expected array of 5-8 items, got {len(quick_wins) if isinstance(quick_wins, list) else 'not an array'}")
            
        # Check competitors
        competitors = data.get("competitors", [])
        if not isinstance(competitors, list) or not (6 <= len(competitors) <= 12):
            errors.append(f"competitors: expected array of 6-12 items, got {len(competitors) if isinstance(competitors, list) else 'not an array'}")
            
        # Check engines_checked
        if "engines_checked" not in data:
            errors.append("engines_checked: missing")
            
        # Check for Serper references
        response_str = json.dumps(data).lower()
        if "serper" in response_str or "verified google" in response_str or "serper_api_key" in response_str:
            errors.append("Response contains Serper/verified Google references (should be removed)")
            
        if errors:
            for error in errors:
                self.add_failure("Domain response shape", error)
            return False
        else:
            self.add_success("Domain response shape verification")
            log_info(f"  - citation_sources: {len(citation_sources)} items")
            log_info(f"  - ranking_prompts: {len(ranking_prompts)} items")
            log_info(f"  - top_topics: {len(top_topics)} items")
            log_info(f"  - categories: {len(categories)} items")
            log_info(f"  - quick_wins: {len(quick_wins)} items")
            log_info(f"  - competitors: {len(competitors)} items")
            return True
            
    def test_domain_list_excludes_processing(self) -> bool:
        """Test GET /api/domain excludes processing jobs"""
        log_info("Testing GET /api/domain (should exclude processing)...")
        
        try:
            resp = self.session.get(f"{BASE_URL}/domain")
            
            if resp.status_code == 200:
                data = resp.json()
                
                if not isinstance(data, list):
                    self.add_failure("GET /api/domain", f"Expected array, got {type(data).__name__}")
                    return False
                    
                # Check no processing jobs
                processing_jobs = [d for d in data if d.get("status") == "processing"]
                if processing_jobs:
                    self.add_failure("GET /api/domain", f"Found {len(processing_jobs)} processing jobs (should be excluded)")
                    return False
                    
                self.add_success(f"GET /api/domain (excludes processing, {len(data)} reports)")
                return True
                
            else:
                self.add_failure("GET /api/domain", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("GET /api/domain", f"Exception: {e}")
            return False
            
    def test_domain_get_404(self) -> bool:
        """Test GET /api/domain/{bad-id} returns 404"""
        log_info("Testing GET /api/domain/{bad-id} (should return 404)...")
        
        try:
            resp = self.session.get(f"{BASE_URL}/domain/nonexistent-job-id-12345")
            
            if resp.status_code == 404:
                self.add_success("GET /api/domain/{bad-id} returns 404")
                return True
            else:
                self.add_failure("GET /api/domain/{bad-id}", f"Expected 404, got {resp.status_code}")
                return False
                
        except Exception as e:
            self.add_failure("GET /api/domain/{bad-id}", f"Exception: {e}")
            return False
            
    def test_domain_analyze_invalid_domain(self) -> bool:
        """Test POST /api/domain/analyze with invalid domain returns 400"""
        log_info("Testing POST /api/domain/analyze with invalid domain...")
        
        invalid_domains = ["notadomain", "", "   ", "invalid"]
        
        for domain in invalid_domains:
            try:
                resp = self.session.post(
                    f"{BASE_URL}/domain/analyze",
                    json={"domain": domain}
                )
                
                if resp.status_code == 400:
                    self.add_success(f"POST /api/domain/analyze with '{domain}' returns 400")
                else:
                    self.add_failure(f"POST /api/domain/analyze with '{domain}'", f"Expected 400, got {resp.status_code}")
                    return False
                    
            except Exception as e:
                self.add_failure(f"POST /api/domain/analyze with '{domain}'", f"Exception: {e}")
                return False
                
        return True
        
    def test_analyses_endpoint(self) -> bool:
        """Test POST /api/analyses with URL input"""
        log_info("Testing POST /api/analyses...")
        
        try:
            resp = self.session.post(
                f"{BASE_URL}/analyses",
                json={
                    "input_type": "url",
                    "content": "https://stripe.com/docs/payments",
                    "target_query": "how to accept payments online"
                }
            )
            
            if resp.status_code == 200:
                data = resp.json()
                if "id" in data and "overall_score" in data:
                    self.add_success("POST /api/analyses")
                    return True
                else:
                    self.add_failure("POST /api/analyses", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("POST /api/analyses", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("POST /api/analyses", f"Exception: {e}")
            return False
            
    def test_visibility_endpoint(self) -> bool:
        """Test POST /api/visibility"""
        log_info("Testing POST /api/visibility...")
        
        try:
            resp = self.session.post(
                f"{BASE_URL}/visibility",
                json={
                    "brand": "Stripe",
                    "domain": "stripe.com",
                    "prompts": ["best payment processor", "how to accept online payments"]
                }
            )
            
            if resp.status_code == 200:
                data = resp.json()
                if "visibility_score" in data and "results" in data:
                    self.add_success("POST /api/visibility")
                    return True
                else:
                    self.add_failure("POST /api/visibility", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("POST /api/visibility", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("POST /api/visibility", f"Exception: {e}")
            return False
            
    def test_citations_endpoint(self) -> bool:
        """Test POST /api/citations"""
        log_info("Testing POST /api/citations...")
        
        try:
            resp = self.session.post(
                f"{BASE_URL}/citations",
                json={
                    "query": "best payment gateway for startups",
                    "domain": "stripe.com"
                }
            )
            
            if resp.status_code == 200:
                data = resp.json()
                if "sources" in data and "user_domain_cited" in data:
                    self.add_success("POST /api/citations")
                    return True
                else:
                    self.add_failure("POST /api/citations", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("POST /api/citations", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("POST /api/citations", f"Exception: {e}")
            return False
            
    def test_reddit_endpoint(self) -> bool:
        """Test POST /api/reddit"""
        log_info("Testing POST /api/reddit...")
        
        try:
            resp = self.session.post(
                f"{BASE_URL}/reddit",
                json={"topic": "payment processing"}
            )
            
            if resp.status_code == 200:
                data = resp.json()
                if "subreddits" in data and "threads" in data:
                    self.add_success("POST /api/reddit")
                    return True
                else:
                    self.add_failure("POST /api/reddit", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("POST /api/reddit", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("POST /api/reddit", f"Exception: {e}")
            return False
            
    def test_dashboard_endpoint(self) -> bool:
        """Test GET /api/dashboard"""
        log_info("Testing GET /api/dashboard...")
        
        try:
            resp = self.session.get(f"{BASE_URL}/dashboard")
            
            if resp.status_code == 200:
                data = resp.json()
                if "stats" in data and "activity" in data:
                    self.add_success("GET /api/dashboard")
                    return True
                else:
                    self.add_failure("GET /api/dashboard", f"Invalid response: {data}")
                    return False
            else:
                self.add_failure("GET /api/dashboard", f"Status {resp.status_code}: {resp.text}")
                return False
                
        except Exception as e:
            self.add_failure("GET /api/dashboard", f"Exception: {e}")
            return False
            
    def run_all_tests(self):
        """Run all backend tests"""
        print("\n" + "="*80)
        print("BACKEND REGRESSION TEST SUITE")
        print("Domain Analysis (LLM-only, Serper removed)")
        print("="*80 + "\n")
        
        # Auth tests
        print("\n--- AUTH TESTS ---")
        if not self.test_auth_register_login():
            log_error("Auth failed, cannot continue")
            return False
            
        self.test_auth_me()
        
        # Domain analysis tests (HIGH PRIORITY)
        print("\n--- DOMAIN ANALYSIS TESTS (HIGH PRIORITY) ---")
        job_id = self.test_domain_analyze_instant_response()
        
        if job_id:
            domain_data = self.test_domain_poll_until_done(job_id, max_wait=180)
            
            if domain_data:
                self.verify_domain_response_shape(domain_data)
                
        self.test_domain_list_excludes_processing()
        self.test_domain_get_404()
        self.test_domain_analyze_invalid_domain()
        
        # Light regression tests
        print("\n--- LIGHT REGRESSION TESTS ---")
        self.test_analyses_endpoint()
        self.test_visibility_endpoint()
        self.test_citations_endpoint()
        self.test_reddit_endpoint()
        self.test_dashboard_endpoint()
        
        # Summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"{Colors.GREEN}Passed: {len(self.successes)}{Colors.RESET}")
        print(f"{Colors.RED}Failed: {len(self.failures)}{Colors.RESET}")
        
        if self.failures:
            print(f"\n{Colors.RED}FAILURES:{Colors.RESET}")
            for failure in self.failures:
                print(f"  - {failure['test']}: {failure['reason']}")
                
        print("\n" + "="*80 + "\n")
        
        return len(self.failures) == 0

if __name__ == "__main__":
    tester = BackendTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
