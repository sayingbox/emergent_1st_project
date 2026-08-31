#!/usr/bin/env python3
"""
Bug-fix regression test suite for:
1. Auth session length (2 hours, not 15 min)
2. Content Optimizer re-scan cache-busting
3. Regression - existing endpoints still work
"""

import requests
import time
import json
import sys
import base64
from datetime import datetime, timezone
from typing import Dict, Any, Optional

# Read BASE_URL from frontend/.env
with open('/app/frontend/.env', 'r') as f:
    for line in f:
        if line.startswith('REACT_APP_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip() + '/api'
            break

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

class BugfixTester:
    def __init__(self):
        self.session = requests.Session()
        self.failures = []
        self.successes = []
        
    def add_failure(self, test_name: str, reason: str):
        self.failures.append({"test": test_name, "reason": reason})
        log_error(f"{test_name}: {reason}")
        
    def add_success(self, test_name: str, detail: str = ""):
        self.successes.append(test_name)
        msg = test_name
        if detail:
            msg += f" ({detail})"
        log_success(msg)
    
    def decode_jwt_without_verify(self, token: str) -> Optional[Dict[str, Any]]:
        """Decode JWT without signature verification"""
        try:
            # JWT has 3 parts: header.payload.signature
            parts = token.split('.')
            if len(parts) != 3:
                return None
            
            # Decode the payload (middle part)
            payload = parts[1]
            # Add padding if needed
            padding = 4 - len(payload) % 4
            if padding != 4:
                payload += '=' * padding
            
            decoded = base64.urlsafe_b64decode(payload)
            return json.loads(decoded)
        except Exception as e:
            log_error(f"Failed to decode JWT: {e}")
            return None
    
    def test_auth_session_length_2h(self) -> bool:
        """Test 1: Auth session length must be 2 hours (120 min), not 15 min"""
        log_info("\n=== TEST 1: AUTH SESSION LENGTH (2 HOURS) ===")
        
        # Create a fresh session for this test
        test_session = requests.Session()
        
        try:
            # Login with remember=false
            log_info("Logging in with remember=false...")
            resp = test_session.post(
                f"{BASE_URL}/auth/login",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "remember": False}
            )
            
            if resp.status_code != 200:
                self.add_failure("Auth login (remember=false)", f"Status {resp.status_code}: {resp.text}")
                return False
            
            user_data = resp.json()
            if "id" not in user_data or "email" not in user_data:
                self.add_failure("Auth login (remember=false)", f"Invalid response: {user_data}")
                return False
            
            log_success(f"Login successful: {user_data.get('email')}")
            
            # Extract access_token from Set-Cookie header
            # Note: Multiple Set-Cookie headers are sent separately
            raw_headers = resp.raw.headers if hasattr(resp, 'raw') else None
            
            access_token = None
            max_age = None
            
            # Try to get all Set-Cookie headers
            if raw_headers:
                set_cookie_headers = raw_headers.getlist('Set-Cookie')
                
                for header in set_cookie_headers:
                    # Check if this is the access_token cookie
                    if header.startswith('access_token='):
                        parts = header.split(';')
                        
                        # First part is the cookie value
                        access_token = parts[0].split('=', 1)[1]
                        
                        # Parse attributes
                        for part in parts[1:]:
                            part = part.strip()
                            if part.startswith('Max-Age='):
                                max_age = int(part.split('=', 1)[1])
                        
                        break
            else:
                # Fallback: try to parse from single Set-Cookie header
                set_cookie_header = resp.headers.get('Set-Cookie', '')
                
                if set_cookie_header.startswith('access_token='):
                    parts = set_cookie_header.split(';')
                    access_token = parts[0].split('=', 1)[1]
                    
                    for part in parts[1:]:
                        part = part.strip()
                        if part.startswith('Max-Age='):
                            max_age = int(part.split('=', 1)[1])
            
            if not access_token:
                self.add_failure("Auth login", "access_token not found in Set-Cookie")
                return False
            
            log_info(f"Extracted access_token: {access_token[:20]}...")
            
            # Decode JWT without verification
            payload = self.decode_jwt_without_verify(access_token)
            if not payload:
                self.add_failure("JWT decode", "Failed to decode JWT")
                return False
            
            log_info(f"JWT payload: {json.dumps(payload, indent=2)}")
            
            # Check exp and iat
            exp = payload.get('exp')
            iat = payload.get('iat')
            
            if not exp:
                self.add_failure("JWT exp", "exp field not found in JWT")
                return False
            
            # Calculate TTL
            current_time = datetime.now(timezone.utc).timestamp()
            
            if iat:
                ttl_seconds = exp - iat
            else:
                # If no iat, use current time as approximation
                ttl_seconds = exp - current_time
            
            ttl_minutes = ttl_seconds / 60
            
            log_info(f"JWT TTL: {ttl_minutes:.2f} minutes ({ttl_seconds:.0f} seconds)")
            
            # Check if TTL is ~120 minutes (accept 115-125 min window)
            if 115 <= ttl_minutes <= 125:
                self.add_success("JWT TTL is ~120 minutes", f"{ttl_minutes:.2f} min")
            else:
                self.add_failure("JWT TTL", f"Expected 115-125 min, got {ttl_minutes:.2f} min")
                return False
            
            # Check Max-Age attribute
            if max_age:
                log_info(f"Cookie Max-Age: {max_age} seconds ({max_age/60:.2f} minutes)")
                
                # Check if Max-Age is ~7200 (accept 7100-7300)
                if 7100 <= max_age <= 7300:
                    self.add_success("Cookie Max-Age is ~7200 seconds", f"{max_age}s")
                else:
                    self.add_failure("Cookie Max-Age", f"Expected 7100-7300s, got {max_age}s")
                    return False
            else:
                log_warning("Max-Age not found in Set-Cookie (may be using Expires instead)")
            
            # Test GET /api/auth/me with the cookie
            log_info("Testing GET /api/auth/me with the cookie...")
            me_resp = test_session.get(f"{BASE_URL}/auth/me")
            
            if me_resp.status_code == 200:
                me_data = me_resp.json()
                if "id" in me_data and "email" in me_data:
                    self.add_success("GET /api/auth/me works with 2h session cookie")
                else:
                    self.add_failure("GET /api/auth/me", f"Invalid response: {me_data}")
                    return False
            else:
                self.add_failure("GET /api/auth/me", f"Status {me_resp.status_code}: {me_resp.text}")
                return False
            
            return True
            
        except Exception as e:
            self.add_failure("Auth session length test", f"Exception: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def test_auth_remember_me_15_days(self) -> bool:
        """Test remember=true gives ~15 days TTL"""
        log_info("\n=== SANITY CHECK: REMEMBER-ME (15 DAYS) ===")
        
        # Create a fresh session for this test
        test_session = requests.Session()
        
        try:
            # Login with remember=true
            log_info("Logging in with remember=true...")
            resp = test_session.post(
                f"{BASE_URL}/auth/login",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "remember": True}
            )
            
            if resp.status_code != 200:
                self.add_failure("Auth login (remember=true)", f"Status {resp.status_code}: {resp.text}")
                return False
            
            # Extract access_token from Set-Cookie header
            set_cookie_header = resp.headers.get('Set-Cookie', '')
            if not set_cookie_header:
                self.add_failure("Auth login (remember=true)", "No Set-Cookie header found")
                return False
            
            # Parse access_token
            access_token = None
            for cookie_part in set_cookie_header.split(';'):
                cookie_part = cookie_part.strip()
                if cookie_part.startswith('access_token='):
                    access_token = cookie_part.split('=', 1)[1]
                    break
            
            if not access_token:
                self.add_failure("Auth login (remember=true)", "access_token not found in Set-Cookie")
                return False
            
            # Decode JWT
            payload = self.decode_jwt_without_verify(access_token)
            if not payload:
                self.add_failure("JWT decode (remember=true)", "Failed to decode JWT")
                return False
            
            # Calculate TTL
            exp = payload.get('exp')
            iat = payload.get('iat')
            
            if not exp:
                self.add_failure("JWT exp (remember=true)", "exp field not found in JWT")
                return False
            
            current_time = datetime.now(timezone.utc).timestamp()
            
            if iat:
                ttl_seconds = exp - iat
            else:
                ttl_seconds = exp - current_time
            
            ttl_days = ttl_seconds / 86400
            
            log_info(f"JWT TTL (remember=true): {ttl_days:.2f} days")
            
            # Check if TTL is ~15 days (accept 14-16 days window)
            if 14 <= ttl_days <= 16:
                self.add_success("Remember-me JWT TTL is ~15 days", f"{ttl_days:.2f} days")
                return True
            else:
                self.add_failure("Remember-me JWT TTL", f"Expected 14-16 days, got {ttl_days:.2f} days")
                return False
            
        except Exception as e:
            self.add_failure("Remember-me test", f"Exception: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def test_content_optimizer_cache_busting(self) -> bool:
        """Test 2: Content Optimizer re-scan cache-busting"""
        log_info("\n=== TEST 2: CONTENT OPTIMIZER RE-SCAN CACHE-BUSTING ===")
        
        # Use the main session (already authenticated)
        try:
            # First analysis
            log_info("Creating first analysis for https://example.com...")
            resp1 = self.session.post(
                f"{BASE_URL}/analyses",
                json={
                    "input_type": "url",
                    "content": "https://example.com",
                    "target_query": None
                }
            )
            
            if resp1.status_code != 200:
                self.add_failure("POST /api/analyses (first)", f"Status {resp1.status_code}: {resp1.text}")
                return False
            
            data1 = resp1.json()
            
            if "id" not in data1:
                self.add_failure("POST /api/analyses (first)", f"No 'id' in response: {data1}")
                return False
            
            analysis_id_1 = data1["id"]
            status_1 = data1.get("status", "unknown")
            
            log_info(f"First analysis created: id={analysis_id_1}, status={status_1}")
            
            # Poll first analysis until done
            if status_1 in ["pending", "running", "processing"]:
                log_info(f"Polling first analysis {analysis_id_1}...")
                analysis_data_1 = self.poll_analysis(analysis_id_1, max_wait=90)
                
                if not analysis_data_1:
                    self.add_failure("First analysis polling", "Failed to complete")
                    return False
                
                final_status_1 = analysis_data_1.get("status")
                log_info(f"First analysis completed with status: {final_status_1}")
                
                if final_status_1 != "done":
                    self.add_failure("First analysis", f"Expected status 'done', got '{final_status_1}'")
                    return False
                
                # Check source_url does NOT contain _cb param
                source_url_1 = analysis_data_1.get("source_url", "")
                if "_cb=" in source_url_1:
                    self.add_failure("First analysis source_url", f"Contains _cb param: {source_url_1}")
                    return False
                
                if source_url_1 != "https://example.com":
                    self.add_failure("First analysis source_url", f"Expected 'https://example.com', got '{source_url_1}'")
                    return False
                
                self.add_success("First analysis completed", f"id={analysis_id_1}, source_url={source_url_1}")
            else:
                # Analysis completed immediately (unlikely but possible)
                log_info(f"First analysis completed immediately with status: {status_1}")
                
                if status_1 != "done":
                    self.add_failure("First analysis", f"Expected status 'done', got '{status_1}'")
                    return False
                
                source_url_1 = data1.get("source_url", "")
                if "_cb=" in source_url_1:
                    self.add_failure("First analysis source_url", f"Contains _cb param: {source_url_1}")
                    return False
                
                self.add_success("First analysis completed immediately", f"id={analysis_id_1}")
            
            # Second analysis with SAME URL
            log_info("Creating second analysis for https://example.com (SAME URL)...")
            resp2 = self.session.post(
                f"{BASE_URL}/analyses",
                json={
                    "input_type": "url",
                    "content": "https://example.com",
                    "target_query": None
                }
            )
            
            if resp2.status_code != 200:
                self.add_failure("POST /api/analyses (second)", f"Status {resp2.status_code}: {resp2.text}")
                return False
            
            data2 = resp2.json()
            
            if "id" not in data2:
                self.add_failure("POST /api/analyses (second)", f"No 'id' in response: {data2}")
                return False
            
            analysis_id_2 = data2["id"]
            status_2 = data2.get("status", "unknown")
            
            log_info(f"Second analysis created: id={analysis_id_2}, status={status_2}")
            
            # Verify different IDs (proves no server-side dedupe)
            if analysis_id_1 == analysis_id_2:
                self.add_failure("Cache-busting", f"Both analyses have same ID: {analysis_id_1} (server-side dedupe detected)")
                return False
            
            self.add_success("Second analysis has different ID", f"id1={analysis_id_1}, id2={analysis_id_2}")
            
            # Poll second analysis until done
            if status_2 in ["pending", "running", "processing"]:
                log_info(f"Polling second analysis {analysis_id_2}...")
                analysis_data_2 = self.poll_analysis(analysis_id_2, max_wait=90)
                
                if not analysis_data_2:
                    self.add_failure("Second analysis polling", "Failed to complete")
                    return False
                
                final_status_2 = analysis_data_2.get("status")
                log_info(f"Second analysis completed with status: {final_status_2}")
                
                if final_status_2 != "done":
                    self.add_failure("Second analysis", f"Expected status 'done', got '{final_status_2}'")
                    return False
                
                # Check source_url does NOT contain _cb param
                source_url_2 = analysis_data_2.get("source_url", "")
                if "_cb=" in source_url_2:
                    self.add_failure("Second analysis source_url", f"Contains _cb param: {source_url_2}")
                    return False
                
                if source_url_2 != "https://example.com":
                    self.add_failure("Second analysis source_url", f"Expected 'https://example.com', got '{source_url_2}'")
                    return False
                
                self.add_success("Second analysis completed", f"id={analysis_id_2}, source_url={source_url_2}")
            else:
                # Analysis completed immediately
                log_info(f"Second analysis completed immediately with status: {status_2}")
                
                if status_2 != "done":
                    self.add_failure("Second analysis", f"Expected status 'done', got '{status_2}'")
                    return False
                
                source_url_2 = data2.get("source_url", "")
                if "_cb=" in source_url_2:
                    self.add_failure("Second analysis source_url", f"Contains _cb param: {source_url_2}")
                    return False
                
                self.add_success("Second analysis completed immediately", f"id={analysis_id_2}")
            
            self.add_success("Cache-busting verified", "Both analyses completed with fresh content")
            return True
            
        except Exception as e:
            self.add_failure("Content Optimizer cache-busting test", f"Exception: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def poll_analysis(self, analysis_id: str, max_wait: int = 90) -> Optional[Dict[str, Any]]:
        """Poll GET /api/analyses/{id} until status is 'done' or 'error'"""
        start_time = time.time()
        poll_count = 0
        
        while time.time() - start_time < max_wait:
            poll_count += 1
            
            try:
                resp = self.session.get(f"{BASE_URL}/analyses/{analysis_id}")
                
                if resp.status_code == 200:
                    data = resp.json()
                    status = data.get("status")
                    
                    if status == "done":
                        elapsed = time.time() - start_time
                        log_info(f"Analysis {analysis_id} completed in {elapsed:.1f}s ({poll_count} polls)")
                        return data
                    elif status == "error":
                        error_msg = data.get("error", "Unknown error")
                        log_error(f"Analysis {analysis_id} failed: {error_msg}")
                        return None
                    else:
                        # Still processing
                        time.sleep(3)
                        continue
                else:
                    log_error(f"GET /api/analyses/{analysis_id} returned {resp.status_code}")
                    return None
                    
            except Exception as e:
                log_error(f"Exception polling analysis {analysis_id}: {e}")
                return None
        
        log_error(f"Analysis {analysis_id} timed out after {max_wait}s")
        return None
    
    def test_regression_endpoints(self) -> bool:
        """Test 3: Regression - existing endpoints still work"""
        log_info("\n=== TEST 3: REGRESSION - EXISTING ENDPOINTS ===")
        
        endpoints = [
            ("GET", "/domain", 200),
            ("GET", "/visibility", 200),
            ("GET", "/citations", 200),
            ("GET", "/reddit", 200),
            ("GET", "/analyses", 200),
            ("GET", "/analyses/history", 200),
            ("GET", "/dashboard", 200),
        ]
        
        all_passed = True
        
        for method, path, expected_status in endpoints:
            try:
                if method == "GET":
                    resp = self.session.get(f"{BASE_URL}{path}")
                else:
                    resp = self.session.post(f"{BASE_URL}{path}", json={})
                
                if resp.status_code == expected_status:
                    self.add_success(f"{method} {path} → {resp.status_code}")
                else:
                    self.add_failure(f"{method} {path}", f"Expected {expected_status}, got {resp.status_code}: {resp.text[:200]}")
                    all_passed = False
                    
            except Exception as e:
                self.add_failure(f"{method} {path}", f"Exception: {e}")
                all_passed = False
        
        return all_passed
    
    def run_all_tests(self):
        """Run all bug-fix regression tests"""
        print("\n" + "="*80)
        print("BUG-FIX REGRESSION TEST SUITE")
        print("="*80 + "\n")
        
        log_info(f"Base URL: {BASE_URL}")
        log_info(f"Test credentials: {TEST_EMAIL} / {TEST_PASSWORD}")
        
        # Test 1: Auth session length (2 hours)
        test1_passed = self.test_auth_session_length_2h()
        
        # Sanity check: Remember-me (15 days)
        self.test_auth_remember_me_15_days()
        
        # Login for subsequent tests
        log_info("\n=== AUTHENTICATING FOR TESTS 2 & 3 ===")
        try:
            resp = self.session.post(
                f"{BASE_URL}/auth/login",
                json={"email": TEST_EMAIL, "password": TEST_PASSWORD, "remember": False}
            )
            
            if resp.status_code == 200:
                log_success("Authenticated successfully")
            else:
                log_error(f"Authentication failed: {resp.status_code}")
                return False
        except Exception as e:
            log_error(f"Authentication exception: {e}")
            return False
        
        # Test 2: Content Optimizer cache-busting
        test2_passed = self.test_content_optimizer_cache_busting()
        
        # Test 3: Regression endpoints
        test3_passed = self.test_regression_endpoints()
        
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
        
        print("\n" + "="*80)
        
        # Overall result
        all_passed = test1_passed and test2_passed and test3_passed
        
        if all_passed:
            print(f"\n{Colors.GREEN}✓ ALL TESTS PASSED{Colors.RESET}\n")
        else:
            print(f"\n{Colors.RED}✗ SOME TESTS FAILED{Colors.RESET}\n")
        
        return all_passed

if __name__ == "__main__":
    tester = BugfixTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
