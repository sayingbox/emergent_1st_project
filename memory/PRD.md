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

## Platform expansion (2026-08-09) — sidebar + GEO tools
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
