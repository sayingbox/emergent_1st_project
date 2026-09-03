# Citetail — GEO/AEO Content Optimizer

## Import Status (2026-02)
Imported from GitHub `sayingbox/emergent_1st_project`.

## Stack
- Frontend: React 19 + CRACO + Tailwind + shadcn/ui, routed under `/app/*`
- Backend: FastAPI (`/api` prefix), motor/pymongo, emergentintegrations (LlmChat), Playwright (Chromium)
- DB: MongoDB (local `mongodb://localhost:27017`, DB=`test_database`)
- Auth: JWT + bcrypt (email/password), admin seeded on boot

## Env
`backend/.env`: MONGO_URL, DB_NAME, CORS_ORIGINS, EMERGENT_LLM_KEY, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, FRONTEND_URL
`frontend/.env`: REACT_APP_BACKEND_URL

## Admin credentials
`admin@citetail.com` / `admin123` (see `/app/memory/test_credentials.md`).

## Features Wired
- Auth (login/register/me/logout), admin seed on startup
- Projects (CRUD), Overview, Domain analysis, Visibility, Citations, Sentiment,
  Reddit, Brand consistency, PR coverage, AI Agent, Optimizer, History, Analysis detail
- Project dashboard extras: Distribution by LLM + By Country (audit insights),
  6 competitors, Citation Opportunities tab (TinyFish community/forum/Q&A search),
  Reviews tab (TinyFish ratings across G2/Capterra/Trustpilot/TrustRadius/ProductHunt/
  Clutch/GetApp/SoftwareAdvice/Gartner/Yelp/Google; excludes Glassdoor/Indeed/AmbitionBox)
- LLM analyses via Emergent Universal LLM key (OpenAI/Anthropic/Gemini)
- TinyFish API key wired (real web/news search + fetch); DuckDuckGo fallback if absent
- Rendering via Playwright Chromium (installed at /pw-browsers)

## Deferred
- GEO → Citation Sources: By Query now returns up to 40 live links (was 12) each tagged with the AI engines using it as a source; By Domain returns up to 60 sources (was ~15) each showing the source page (title + domain) with the AI engines picking up the reference below. Engine tagging is a deterministic heuristic (0 LLM credit; TinyFish search only).
- Domain Analysis report v2: Web Citations up to 60 (real TinyFish URLs) each showing source page title + which AI engines pick it up; Ranking Prompts cap raised (20-40, all shown via toggle); new Distribution-by-LLM section (engine logos, derived from prompt rankings); new AI Share of Voice (brand + competitors by AI-engine mentions, folded into the single domain LLM call); new By Country section. No extra LLM calls vs. before.
- Audit report v2 (project detail): Pages crawl limit 50 + homepage first; per-issue & site-level "how to fix" suggestions; Brand adds Wikipedia + Twitter/X; Competitors metric now AI-engine mention share (ChatGPT/Perplexity/Gemini/Claude/Grok/Copilot) with engine-based Gap Analysis; Web Citations up to 40 with source title + picked-up-by engines; Prompt Rankings up to 25.
- Resend/OTP admin flow (skipped per user choice)
- TinyFish API key (optional; empty by default)
- Full backend LLM test suite (`backend_test.py`, `aeo_optimizer_test.py`) — will consume LLM credits

## Backlog
- P1: Verify each analyzer end-to-end with a real URL scan
- P2: Turn on OTP + Resend once Resend key is provided and domain verified
- P2: Wire TinyFish API key if user opts in for higher-fidelity crawling
