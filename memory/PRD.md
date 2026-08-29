# GEOrank — GEO/AEO Content Optimizer

## Original Problem Statement
Build a tool that ingests content (URL or pasted text/markdown/HTML), scores it 0–100 across 8 GEO/AEO dimensions with sub-checks, generates actionable recommendations, auto-generates JSON-LD schema, simulates AI-engine citation for a query, finds unanswered question gaps, and tracks score history per URL. Per-user accounts, all 7 features, modern SaaS dashboard.

## Architecture
- **Frontend**: React 19 + CRA/craco, Tailwind, shadcn/ui, framer-motion, recharts, sonner. Manrope/IBM Plex fonts. Routes: /login, /app, /app/history, /app/analysis/:id.
- **Backend**: FastAPI + Motor (MongoDB). JWT httpOnly-cookie auth (bcrypt). LLM via emergentintegrations `claude-sonnet-4-6` + EMERGENT_LLM_KEY.
- **Ingestion**: requests + BeautifulSoup (lxml) for URL scrape; markdown/HTML/text normalization.

## User Personas
- Content marketers / SEO specialists optimizing pages for AI search citation.

## Core Requirements (static)
1. Content ingestion (URL scrape or paste) with normalization.
2. 8-dimension 0–100 scoring with sub-checks.
3. Recommendations panel (prioritized).
4. JSON-LD schema generator (copy/download).
5. AI Visibility Simulator (per target query).
6. Question Gap Finder (ranked).
7. Per-user History & comparison charts.

## Implemented (2026-08-09)
- JWT email/password auth (register/login/logout/me), admin seed.
- POST /api/analyses runs full LLM audit → scores, sub-checks, summary answer, recommendations, JSON-LD, detected schema types.
- Simulate + gaps endpoints; list/history/get/delete.
- Full dashboard UI: analyze form, recent list, detail (gauge, dimensions, fixes, schema terminal viewer, simulator, gaps), history area charts.
- Verified end-to-end via curl + screenshots.

## Domain Analysis deep-report + platform (2026-08-12)
- **Data depth**: domain report now returns 50+ AI citation sources and 50+ ranking prompts (llm_json max_tokens=8000).
- **Contextual relevance**: ranking_prompts carry a `topic` field and are server-side filtered to the report's top_topics (0 off-topic).
- **Async job**: POST /api/domain/analyze returns {id,status:'processing'} instantly; background task fills it; GET /api/domain/{id} polled by UI (loading card, 3s interval, 180s cap). Avoids the ~60s ingress timeout.
- **Superadmin**: SUPERADMIN_EMAILS={kiskobiswal@gmail.com} → apply_entitlements() forces role=admin, full_access=true in register/login/me. Normal users full_access=false.
- **Remember Me**: login `remember` flag → 15-day cookies vs short session.
- **JS scraper**: /api/analyses url input renders JS-heavy pages via headless Chromium; executable path from PLAYWRIGHT_CHROME_EXECUTABLE_PATH in backend/.env (+ hardcoded /usr/local/bin/browser-use-chromium fallback). Verified 17→259 words on a JS demo page.
- Domain UI: View More toggles (show 5 → all) for citation sources & ranking prompts.
- Testing: iteration_3 all features pass; scraper regression fixed after report.
- Dark sidebar layout (Overview / Generative Engine (GEO) / Answer Engine (AEO)) matching requested design.
- **Dashboard** (GET /api/dashboard): aggregate stats, content-score trend, recent activity, tools grid.
- **Domain Analysis** (POST /api/domain/analyze): AI-readiness score, category breakdown, quick wins, top topics, competitors; past reports.
- **Visibility Tracker** (POST /api/visibility): brand + prompts → per-engine mention/recommendation, visibility score, share of voice, recommendations.
- **Citation Sources** (POST /api/citations): query + optional domain → ranked likely-cited sources + user-domain-cited banner.
- **Reddit Finder** (POST /api/reddit): topic → relevant subreddits, discussion threads, content ideas.
- All new GEO features are AI-simulated (Claude Sonnet 4.6). Content Optimizer moved to /app/optimizer.
- Testing agent iteration_1: 100% backend + frontend pass.

## Backlog (P1/P2)
- P1: Real "People Also Ask" scrape/API to augment gap finder.
- P1: Re-analyze from a stored URL in one click (currently re-paste URL).
- P2: Export full report as PDF; team/workspace sharing; scheduled re-audits.

## Test Credentials
See /app/memory/test_credentials.md

## 2026-06 Fork: Login Bug Fix
- Root cause: users open app via alias URL (llm-domain-metrics.preview.emergentagent.com) while REACT_APP_BACKEND_URL is the canonical UUID URL → cross-origin credentialed requests blocked → "Something went wrong" on login/register.
- Fix: /app/frontend/src/lib/api.js now falls back to window.location.origin when it differs from the env backend origin.
- Superadmin account kiskobiswal@gmail.com created (password Kisko@123).
- Verified by testing agent: 6/6 auth flows pass on BOTH hostnames (iteration_5.json).

## 2026-06 Crawl-First Domain Analysis (rebuilt)
User spec: Domain Analysis must follow a strict crawl-first workflow.
- **1. Business Discovery**: `crawl_business()` fetches the live homepage + up to 3 key internal pages (scored by service/about/product keywords) via `fetch_html` (static + Chromium fallback). Extracts titles, headings, body text.
- **2. Topic Identification**: LLM (Claude Sonnet 4.6) is fed ONLY the crawled content → `discovered_services` (with on-site evidence quotes) → `top_topics` derived from those services.
- **3. AI Search Ranking**: `ai_search_rankings` — one entry per topic, whether/where it surfaces across ChatGPT, Claude, Gemini, Perplexity (LLM-estimated, per user choice).
- **4. Verified AI Citations**: LLM proposes real source URLs; backend HTTP-verifies EVERY URL concurrently (`verify_live_urls`, HEAD→GET, live statuses only) and DROPS dead links. Only verified-live URLs shown (marked `verified:true`, "Live" badge).
- **5. Topic-Based Ranking Prompts**: `ranking_prompts` generated per discovered topic (e.g. "content moderation company"); tied to `top_topics`.
- **6. Relevant Competitors**: `competitors` now objects {domain, topic, note} — companies ranking for the SAME topics in AI search.
- Google AI Overviews removed from ENGINES_CHECKED (now ChatGPT/Claude/Perplexity/Gemini).
- Frontend `DomainAnalysis.js`: new "Discovered business & services" (+crawled page links), "AI Search ranking" per-topic, "Live" verified badges on citations, richer competitor cards.
- Files: `/app/backend/server.py` (crawl_business, verify_live_urls, DOMAIN_SYSTEM, domain_prompt, _run_domain_analysis), `/app/frontend/src/pages/DomainAnalysis.js`.
- Verified end-to-end on foiwe.com: crawled 4 real pages, 9 services, 9 topics, 21 HTTP-verified live citations, 25 topic-based prompts, 9 topic-matched competitors. ~70s run.

## 2026-06 Content Optimizer: Cloudflare timeout + accuracy fixes
- **Bug**: POST /api/analyses ran fetch+Chromium+LLM synchronously (45-90s) → exceeded ~60s ingress/Cloudflare timeout → "origin returned invalid/incomplete response" (520).
- **Fix (async job)**: POST inserts a `status:'processing'` doc, returns `{id,status}` instantly, spawns `_run_analysis` background task; frontend `Dashboard.js` polls GET /api/analyses/{id} every 3s (cap 180s), navigates on 'done', toasts on 'error'.
- **Accuracy — 404 rejection**: `fetch_html` now raises on HTTP 404/410 so bad URLs become `status:'error'` (not a scored 404 page). Verified: hubspot 404 → error; wikipedia Content_marketing → done, 3610 words, score 62.
- **Re-run freshness**: `_run_analysis` uses a unique LLM session `analyze-{job_id}` (and domain uses `domain-{job_id}`) so re-analyzing improved content yields a NEW report, never cached context. Each run = a new independent doc.
- **Resilience**: list_analyses/history/dashboard exclude processing (and errored) docs; no 500s.
- Verified by testing agent iteration_6.json: backend 6/6, frontend 2/2, no issues.

## 2026-06 PDF export + 5-tier score colours
- **PDF export**: new `/app/frontend/src/lib/pdf.js` (jsPDF, text-based/selectable, branded dark header). `exportContentReport(a)` and `exportDomainReport(r)` build complete reports (all sections, not just the active tab / not truncated by "view more"). Buttons: `export-pdf-btn` on AnalysisDetail, `export-domain-pdf-btn` on DomainAnalysis score card.
- **Score colour tiers** (`ScoreGauge.js` colorFor, used app-wide via `scoreColor`): ≥80 strong green #15803D, ≥70 light green #22C55E, ≥60 light yellow #EAB308, ≥50 amber #D97706, <50 red #DC2626.
- Verified via screenshots: both Export PDF buttons fire ("PDF exported"), no console/jsPDF errors; colours render correctly (62→light-yellow, 72→light-green, 55→amber, 40→red).

## 2026-06 Rebrand to Citetail + emerald redesign
- **Logo**: user's emerald double-chevron logo saved to `/app/frontend/public/logo.png` (+ `src/assets/logo.png`); used in Sidebar (desktop + mobile), Auth screen, and as favicon/apple-touch-icon. Page title → "Citetail — AI Answer Visibility".
- **Brand colour**: replaced royal blue `#002FA7` (and sidebar `#5b8bff`) app-wide with emerald `#18C090` (hover `#129E75`, tint `rgba(24,192,144,0.1)`). Functional 5-tier score colours untouched.
- **Design blueprint**: `/app/design_guidelines.json` (from design_agent).
- **Sidebar**: logo lockup, emerald active state (left border + tint), fixed mobile wordmark ("GEOrank"→Citetail), emerald avatar.
- **Auth**: premium split screen — dark `#0B0B0F` left panel with emerald radial glow, logo, feature bullets; emerald primary button.
- **Overview dashboard** (`Overview.js`): emerald hero band with glow + "Analyze a domain" CTA, framer-motion staggered entrance, stat cards with emerald icon chips + tier-coloured values, emerald recharts area (custom tooltip), clean activity list, emerald tools grid.
- Verified via screenshots (login + dashboard); no console errors. Frontend-only visual change.

## Brand Consistency + PR Coverage (2025-07)
- **Brand Consistency Checker** (GEO): POST/GET /api/brand. Input brand + optional domain → Claude (claude-sonnet-4-6) returns consistency_score, canonical info, 12 platforms (social/directories/reviews) with name/description/features/pricing/present, inconsistencies (severity), recommendations. Frontend /app/brand with grouped platform cards, favicon logos, past checks.
- **PR Coverage** (GEO): POST/GET /api/pr. Input brand + optional domain → Claude returns press[] (publication, logo domain, headline, description, url, type) + pitch_categories[] (outlets/beats by category). Frontend /app/pr with two tabs (Press Coverage / Media Pitch List), publication logos via google favicon.
- Both are LLM-knowledge-based (no live scraping / no extra API keys), following existing visibility/citations/reddit pattern. Sidebar updated under "Generative Engine (GEO)".

## Real-data upgrade via TinyFish (2025-07)
- **Integration**: TinyFish Search + Fetch APIs (both free). Key in backend/.env as TINYFISH_API_KEY. Helper module: backend/tinyfish_client.py (tf_search, tf_search_many, tf_fetch, host/authority/type helpers). All displayed links come from real TinyFish search results — LLM never invents URLs (only structures/classifies real evidence).
- **#1 Single search box**: Brand Consistency & PR now take one input `query` (brand name OR domain). Backend inputs accept query/brand/domain.
- **#2 Brand Consistency**: real per-platform `site:` searches across 12 platforms → real listing URLs (multiple links each), found/uncertain/not_found status via brand-relevance filter (_mentions_brand drops namesakes). LLM structures canonical + features/pricing/inconsistencies from real snippets + fetched homepage. Verified: Citetail → real Crunchbase + G2 listings.
- **#3 PR Coverage**: web searches (news/funding/feature queries) → direct publisher article URLs; drops own-domain, social, and search-redirect wrappers; LLM relevance-filters + classifies type; pitch list of real outlets. Verified: Notion → TechCrunch/CNBC/Wikipedia real article links.
- **#4 Domain Analysis citation sources**: replaced hallucinated LLM citations with real_citation_sources() — real TinyFish results across wikipedia/crunchbase/g2/capterra/linkedin/etc + news, brand-relevance filtered. Falls back to LLM+HTTP-verify only if search returns nothing. Verified: citetail.com → real G2/Crunchbase/SourceForge citations.
- Testing: verified end-to-end via live backend calls (per user request, automated test agent skipped — user tests manually).

## Brand/PR enhancements (2025-07)
- Brand Consistency now 18 platforms: social (+YouTube, +Reddit), directories (+Tracxn, +GoodFirms, +IndieHackers), reviews (+Gartner).
- PR Coverage: paginated multi-query TinyFish search (6 queries x 3 pages) -> up to 50 real press items. Filters to real PR only (excludes directories/review/social/reference/app-store via NON_PR_HOSTS). Each item labelled pr_type: "paid" (press-release wires: PRNewswire/BusinessWire/GlobeNewswire/etc) vs "organic" (editorial). Frontend shows paid/organic badge.

## Project Audit expansion + compact UI (2025-07)
- Project scan (projects.py run_full_project_scan) now returns 4 new sections, persisted in server.py _run_project_scan set_doc and shown as new tabs in ProjectDetail.js:
  - technical_readiness: speed_score, crawl_score, avg/median load, page size, sitemap/robots/https, schema & canonical coverage, slowest pages (pure compute + 2 HTTP checks, 0 LLM).
  - brand_presence: TinyFish site: search across 10 key platforms, real links (0 LLM).
  - pr_list: TinyFish paginated press search, paid/organic labels (0 LLM).
  - competitor_intel: 1 LLM call finds 4 competitors; TinyFish computes AI Share of Voice (presence across 6 platforms) + Gap Analysis (platforms where competitors listed but brand isn't). Only +1 LLM call per scan.
- NOTE: existing projects must be Re-scanned to populate new sections.
- Compact SEMrush-style UI: PageHeader (ui-bits.js) smaller title/subtitle/margins (global); search-box cards p-6/mb-8 -> p-4/mb-5 across 8 tool pages; Sidebar.js compacted (py-1.5, space-y-4, 16px icons, 13px text) so all menu items fit on laptop screens.

## Premium UI redesign (2025-07)
- New palette: electric indigo/violet accent (#6366F1 / #8B5CF6 / #4F7DFF) replacing green (#18C090) app-wide (global sed across pages+components + index.css rewrite).
- Deep navy/slate sidebar gradient (.sidebar-rail: #0F1B33->#0A1120 with indigo/violet radial glows), indigo active-nav glow, indigo avatar/logo.
- Typography: Inter body + Manrope headings, tighter letter-spacing.
- Micro-animations: page rise on route change (Layout keyed .animate-rise), button hover lift + gradient, card-hover indigo glow, styled scrollbars, indigo focus rings.
- Also #2 earlier this session: added Claude, Copilot, Grok to AI engine lists (Domain, Visibility, Project rankings) backend+frontend.
- Zero LLM credits (pure styling). Admin registration+OTP (Resend) still pending user's RESEND_API_KEY.
