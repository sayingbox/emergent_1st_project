#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: "Domain Analysis: remove Serper/Tavily integration, revert to LLM-only (Claude Sonnet 4.6), restore detailed metrics (DA, PA, Trust, Backlinks, Referring Domains, Monthly Traffic), keep 50+ AI citation sources and ranking prompts."

backend:
  - task: "Domain Analysis LLM-only refactor (Serper removed)"
    implemented: true
    working: true
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Removed Serper API integration entirely (SERPER_API_KEY, _serper_sync, serper_search, _same_domain, _domain_of, _visibility_score, CANDIDATE_SYSTEM helpers). Rewrote _run_domain_analysis to be a single Claude Sonnet 4.6 LLM call via llm_json(max_tokens=16000) producing the full detailed schema: domain_authority/page_authority/trust_score/estimated_backlinks/referring_domains/estimated_monthly_traffic + categories + top_topics (as objects with authority/relevance) + citation_sources (source/url/type/authority/why) + ranking_prompts (prompt/topic/position/engines/intent) + quick_wins + competitors. Ranking prompts are still tied server-side to top_topics (if a returned topic is off, snapped to top topic). Kept the async job pattern (POST returns id/processing, GET /domain/{id} for polling). Direct backend test on stripe.com: 72 citation sources, 67 ranking prompts, DA=91, PA=88, Trust=96, backlinks=4.2M, referring_domains=98K, monthly_traffic=22M, 5 categories, 8 top_topics, 8 quick_wins, 10 competitors. All requested fields restored and depth exceeds 50+."
        - working: true
          agent: "testing"
          comment: "16/16 backend tests PASSED. Domain flow verified end-to-end: instant POST (0.08s), poll to done in 111.9s. Response contains all 6 detailed metrics, 62 citation sources, 63 ranking prompts (all tied to top_topics), 5 categories, 8 top_topics with authority/relevance, 8 quick wins, 10 competitors, data_source='AI-simulated (Claude Sonnet 4.6, Emergent LLM key)'. GET /api/domain excludes processing jobs. 404 on bad id, 400 on invalid domain. No Serper/verified references anywhere. Regression on auth/analyses/visibility/citations/reddit/dashboard all pass."
        - working: true
          agent: "testing"
          comment: "COMPREHENSIVE REGRESSION TEST PASSED (16/16 tests). Domain Analysis flow fully verified: (1) POST /api/domain/analyze with stripe.com returns instant response (0.08s) with {id, domain, status:'processing'}. (2) GET /api/domain/{id} polling completed in 111.9s (23 polls) reaching status:'done'. (3) Response shape FULLY VERIFIED: data_source='AI-simulated (Claude Sonnet 4.6, Emergent LLM key)', ai_readiness_score=int(0-100), metrics contains ALL 6 required fields (domain_authority, page_authority, trust_score, estimated_backlinks, referring_domains, estimated_monthly_traffic), categories=5 items, top_topics=8 items (>=6), citation_sources=62 items (>=50), ranking_prompts=63 items (>=50) with all prompts.topic matching top_topics, quick_wins=8 items (5-8), competitors=10 items (6-12), engines_checked present. NO Serper/verified Google references found. (4) GET /api/domain correctly excludes processing jobs. (5) GET /api/domain/{bad-id} returns 404. (6) POST /api/domain/analyze with invalid domains returns 400. Light regression PASSED: POST /api/auth/register+login (cookies working), GET /api/auth/me, POST /api/analyses (url input), POST /api/visibility, POST /api/citations, POST /api/reddit, GET /api/dashboard all working correctly."

frontend:
  - task: "Domain Analysis UI — detailed metrics + 50+ list"
    implemented: true
    working: "NA"
    file: "frontend/src/pages/DomainAnalysis.js"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: "NA"
          agent: "main"
          comment: "Restored SEO & authority metrics card with 6 metrics (Domain Authority, Page Authority, Trust Score, Backlinks, Referring Domains, Est. Monthly Traffic) + category Bars. Restored citation source rows with type badge/why/authority, ranking prompts with position/topic/intent/engines. top_topics rendered as authority/relevance bars. Kept View N more / Show less toggles and polling flow. Removed 'Verified via Google' / Serper copy. Gauge label back to AI READINESS."

metadata:
  created_by: "main_agent"
  version: "1.2"
  test_sequence: 2
  run_ui: false

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    - agent: "main"
      message: "Domain Analysis reverted to LLM-only per user request. Serper integration fully removed from backend. Detailed metrics + 50+ entries verified via direct curl (stripe.com: 72 sources / 67 prompts). Please regression-test the domain flow: POST /api/domain/analyze returns {id, status:'processing'}; GET /api/domain/{id} eventually returns status:'done' with metrics.domain_authority/page_authority/trust_score/estimated_backlinks/referring_domains/estimated_monthly_traffic populated, citation_sources length >= 50, ranking_prompts length >= 50 (each with topic + position + engines + intent), categories (5), top_topics (>=6 objects with authority/relevance), quick_wins, competitors, and data_source='AI-simulated (Claude Sonnet 4.6, Emergent LLM key)'. Also verify /api/domain listing excludes 'processing' jobs and GET /api/domain/{id} returns 404 for wrong job. Auth uses cookies from POST /api/auth/register or /api/auth/login (remember flag). Existing regression (auth/analyses/visibility/citations/reddit/dashboard) should still pass."
    - agent: "testing"
      message: "✅ ALL BACKEND TESTS PASSED (16/16). Domain Analysis LLM-only refactor fully verified and working correctly. Comprehensive test results: (1) Domain analysis instant response < 5s ✓ (2) Polling completes in ~112s with status 'done' ✓ (3) Response shape 100% compliant: data_source correct, ai_readiness_score valid, all 6 metrics present, 62 citation_sources (>=50), 63 ranking_prompts (>=50) with topic matching, 8 top_topics, 5 categories, 8 quick_wins, 10 competitors, engines_checked present, NO Serper references ✓ (4) GET /api/domain excludes processing ✓ (5) 404 for bad job_id ✓ (6) 400 for invalid domains ✓ (7) Light regression all passed: auth (cookies working), analyses, visibility, citations, reddit, dashboard ✓. NO ISSUES FOUND. Backend is production-ready. Main agent should summarize and finish."