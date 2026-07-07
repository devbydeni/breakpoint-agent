# BreakPoint Agent

AI-powered business model stress-testing engine. Feed it your assumptions — pricing, churn, CAC, costs, growth — and it systematically breaks them to show you where your model is fragile, where it's resilient, and what path leads to profitability.

## What it does

BreakPoint Agent takes a set of business model inputs and runs them through a multi-stage analysis pipeline:

1. **Scenario Generation** — Produces 10-15 scenarios across four types: base case, stress tests (adverse shifts), optimistic cases, and combined stress (multiple variables failing simultaneously)
2. **24-Month Financial Projections** — Calculates revenue trajectories, break-even points, LTV:CAC ratios, and gross margins for every scenario
3. **Vulnerability Ranking** — Ranks each assumption by its impact on break-even timing using delta analysis
4. **AI Narrative Layer** — Uses Google Gemini to generate executive summaries, plain-language vulnerability explanations, contextual input suggestions, and follow-up Q&A chat

## Access methods

BreakPoint can be used three ways, all backed by the **same in-process analysis engine** so results are identical everywhere:

| Method | Start with | Best for |
|--------|-----------|----------|
| **CLI** | `npm run cli -- example` | Quick local runs, scripting, CI |
| **REST API** | `npm start` | Web clients, programmatic integration |
| **Telegram bot** | `npm run bot` | Conversational, on-the-go analysis |

See **[USAGE.md](USAGE.md)** for the full guide to every command, endpoint, and bot flow.

## Architecture

```
core/                  # Shared engine (used by CLI, API, and bot)
  analysisEngine.js      runAnalysis() — the full pipeline, decoupled from HTTP
  sessionStore.js        Centralized session persistence
  inputSchema.js         Input field definitions + validation
  presenter.js           Human-readable rendering of results

cli/                   # Command line interface
  breakpoint.js          analyze / example / sessions / show / chat / health

telegram/              # Telegram bot
  bot.js                 Dependency-free long-polling bot

ai/                    # Gemini integration layer
  geminiClient.js        Core API client with retry + streaming
  chatHandler.js         Contextual Q&A about analysis results
  inputAssist.js         Real-time field-level suggestions
  summaryGenerator.js    Executive summary generation
  vulnerabilityNarrator.js  Plain-language risk explanations
  contextBuilder.js      Formats analysis data for AI prompts
  rateLimitHandler.js    24-hour quota tracking
  prompts/               Prompt templates

services/              # Business logic engine
  scenarioEngine.js      Generates stress/optimistic/combined scenarios
  scenarioTypes.js       Scenario templates per business type
  vulnerabilityRanker.js Ranks assumptions by break-even impact
  sensitivityAnalysis.js Tests assumption sensitivity (25%/50% shifts)
  projectionCalculator.js 24-month P&L projections
  breakEvenCalculator.js Break-even month + financial health

controllers/           # HTTP orchestration (delegates to core/)
  analysisController.js  Thin REST layer over the shared engine

middleware/            # Express middleware
  apiKeyAuth.js          Optional API-key authentication
  errorHandler.js        Central error + 404 handling

utils/                 # Financial formulas
  formulas.js            LTV, CAC ratio, margins, unit economics
  calculations.js        Utility calculation functions
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` or `/api` | Service discovery — lists all endpoints |
| GET | `/api/health` | Health check (always public) |
| POST | `/api/analyze` | Run full analysis on business model inputs |
| GET | `/api/analyze/:id` | Fetch completed analysis results |
| GET | `/api/sessions` | List saved analysis sessions |
| GET | `/api/sessions/compare?ids=a,b` | Compare two analyses |
| GET | `/api/vulnerabilities/:analysisId` | Enriched vulnerability list |
| POST | `/api/chat` | Contextual Q&A about results (supports streaming) |
| POST | `/api/ai/input-assist` | Get AI suggestions for input fields |

**Optional auth:** set `API_KEY` in `.env` to require an `x-api-key` (or `Authorization: Bearer`) header on every `/api` request. Leave it blank to keep the API open for local development.

## Quick Start

```bash
# Clone
git clone https://github.com/postleo/breakpoint-agent.git
cd breakpoint-agent

# Configure
cp .env.example .env
# Add your GEMINI_API_KEY to .env (optional — see note below)

# Install
npm install
```

Then pick an access method:

```bash
# CLI — no server needed
npm run cli -- example

# REST API — starts on port 3001
npm run dev

# Telegram bot — set TELEGRAM_BOT_TOKEN in .env first
npm run bot
```

> **AI is optional.** Without `GEMINI_API_KEY`, analyses still run in deterministic mode (full numbers + a rule-based summary). AI narratives, executive summaries, and chat require a key.

## Example Request

Inputs are nested under `inputs`; `confidence` is optional. Note `monthlyChurn` is a percent (e.g. `5` = 5%).

```bash
curl -X POST http://localhost:3001/api/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": {
      "businessType": "saas",
      "pricing": 49,
      "monthlyChurn": 5,
      "cac": 200,
      "fixedCosts": 15000,
      "variableCostPerUnit": 5,
      "monthlyNewCustomers": 50,
      "billingCycle": "monthly",
      "currentRunway": 12
    },
    "confidence": { "monthlyChurn": "low" }
  }'
```

The equivalent from the CLI:

```bash
npm run cli -- analyze --businessType saas --pricing 49 --monthlyChurn 5 \
  --cac 200 --fixedCosts 15000 --variableCostPerUnit 5 \
  --monthlyNewCustomers 50 --currentRunway 12
```

## Tech Stack

- **Runtime:** Node.js + Express
- **AI:** Google Gemini (gemini-3-flash-preview)
- **Language:** JavaScript (ES modules)
- **Dependencies:** Minimal — express, cors, dotenv, @google/generative-ai
- **CLI & Telegram bot:** zero additional dependencies (built on Node's `readline` and global `fetch`)

## License

GPL-3.0 — see [LICENSE](LICENSE) for details.
