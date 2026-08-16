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
