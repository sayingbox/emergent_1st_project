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
- LLM analyses via Emergent Universal LLM key (OpenAI/Anthropic/Gemini)
- Rendering via Playwright Chromium (installed at /pw-browsers)

## Deferred
- Resend/OTP admin flow (skipped per user choice)
- TinyFish API key (optional; empty by default)
- Full backend LLM test suite (`backend_test.py`, `aeo_optimizer_test.py`) — will consume LLM credits

## Backlog
- P1: Verify each analyzer end-to-end with a real URL scan
- P2: Turn on OTP + Resend once Resend key is provided and domain verified
- P2: Wire TinyFish API key if user opts in for higher-fidelity crawling
