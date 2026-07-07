# BreakPoint Agent — Usage Guide

BreakPoint Agent can be accessed three ways, all powered by the **same in-process analysis engine** (`core/analysisEngine.js`), so results are identical no matter how you reach it:

1. [Command Line (CLI)](#1-command-line-cli)
2. [REST API](#2-rest-api)
3. [Telegram Bot](#3-telegram-bot)

- [Setup (shared)](#setup-shared)
- [Input reference](#input-reference)
- [Understanding the output](#understanding-the-output)
- [Troubleshooting](#troubleshooting)

---

## Setup (shared)

All three channels share the same install and configuration.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env
```

Then edit `.env`:

| Variable | Required for | Notes |
|----------|--------------|-------|
| `GEMINI_API_KEY` | AI features everywhere | Without it, analyses still run in **deterministic mode** (numbers + a rule-based summary), but AI executive summaries, vulnerability narratives, and chat are disabled. |
| `PORT` | REST API | Defaults to `3001`. |
| `NODE_ENV` | REST API | `development` or `production`. |
| `CLIENT_URL` | REST API | CORS origin (default `http://localhost:5173`). |
| `API_KEY` | REST API (optional) | If set, the API requires this key on every request. Comma-separate to allow several keys. Leave blank to keep the API open. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot | Get one from [@BotFather](https://t.me/BotFather). |

> **AI is optional.** Every channel works without `GEMINI_API_KEY` — you still get scenarios, projections, break-even, LTV:CAC, and vulnerability rankings. Only the natural-language layers require a key.

---

## 1. Command Line (CLI)

The CLI runs the full pipeline **in-process — no server required**. It's the fastest way to get an analysis.

### Running it

```bash
# Via npm script
npm run cli -- <command> [options]

# Directly
node cli/breakpoint.js <command> [options]

# Or link it globally so you can call `breakpoint` anywhere
npm link
breakpoint <command> [options]
```

> When using `npm run cli`, put `--` before your arguments so npm passes them through.

### Commands

| Command | Description |
|---------|-------------|
| `analyze` | Run a full analysis (see the three input methods below) |
| `example` | Run a ready-made SaaS example |
| `sessions` | List saved analyses |
| `show <id>` | Show a saved analysis (add `--scenarios` for the scenario table) |
| `chat <id> "<question>"` | Ask a follow-up about an analysis (requires `GEMINI_API_KEY`) |
| `health [--test]` | Show CLI/AI status; `--test` pings Gemini |
| `help` | Show built-in help and every input field |

**Global options:** `--json` (raw JSON output), `--no-ai` (skip AI narratives even if a key is set).

### Three ways to provide inputs to `analyze`

**a) Flags** — one flag per field:

```bash
node cli/breakpoint.js analyze \
  --businessType saas \
  --pricing 49 \
  --monthlyChurn 5 \
  --cac 200 \
  --fixedCosts 15000 \
  --variableCostPerUnit 5 \
  --monthlyNewCustomers 50 \
  --billingCycle monthly \
  --currentRunway 12
```

**b) Interactive** — guided prompts (press Enter to accept defaults):

```bash
node cli/breakpoint.js analyze -i
```

**c) JSON file** — accepts either a raw inputs object or a `{ "inputs": {...}, "confidence": {...} }` envelope:

```bash
node cli/breakpoint.js analyze --file my-model.json
```

Example `my-model.json`:

```json
{
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
  "confidence": {
    "pricing": "high",
    "monthlyChurn": "low",
    "cac": "mid"
  }
}
```

### Example session

```bash
# Run the built-in example
node cli/breakpoint.js example

# List what you've saved
node cli/breakpoint.js sessions

# Re-open a specific analysis with the scenario table
node cli/breakpoint.js show analysis-1699999999999-abc123 --scenarios

# Ask a follow-up question (needs GEMINI_API_KEY)
node cli/breakpoint.js chat analysis-1699999999999-abc123 "What's my single biggest risk?"

# Machine-readable output for scripting
node cli/breakpoint.js analyze --file my-model.json --json > result.json
```

---

## 2. REST API

Start the HTTP server for programmatic or web-client access.

```bash
npm start        # production
npm run dev      # auto-reload with nodemon
```

The server listens on `http://localhost:3001` (configurable via `PORT`).

### Authentication (optional)

- If `API_KEY` is **not** set, the API is open — good for local development.
- If `API_KEY` **is** set, send it on every request (except `/api/health`):
  - Header `x-api-key: <your-key>`, or
  - Header `Authorization: Bearer <your-key>`
- Missing key → `401`; wrong key → `403`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` or `/api` | Service discovery — lists all endpoints |
| GET | `/api/health` | Health check (always public) |
| POST | `/api/analyze` | Run a full analysis |
| GET | `/api/analyze/:id` | Fetch a completed analysis by id |
| GET | `/api/sessions` | List saved analyses (summaries) |
| GET | `/api/sessions/compare?ids=a,b` | Compare two analyses |
| GET | `/api/vulnerabilities/:analysisId` | Enriched vulnerability list |
| POST | `/api/chat` | Contextual Q&A about an analysis (supports streaming) |
| POST | `/api/ai/input-assist` | AI suggestion for a single input field |

### Request/response examples

**Run an analysis** — note inputs are nested under `inputs`, and `confidence` is optional:

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

Response:

```json
{ "success": true, "data": { "analysisId": "analysis-...", "status": "completed", "scenarioCount": 10 } }
```

**Fetch the full result** (scenarios, projections, vulnerabilities, summary):

```bash
curl http://localhost:3001/api/analyze/analysis-1699999999999-abc123
```

**Chat about a result:**

```bash
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{ "message": "What is my biggest risk?", "analysisId": "analysis-1699999999999-abc123" }'
```

For a streaming (Server-Sent Events) response, add `"streaming": true`. Chunks arrive as `data: {"text":"..."}` lines, terminated by `data: [DONE]`.

**With API key auth enabled:**

```bash
curl http://localhost:3001/api/sessions -H "x-api-key: your-key"
```

> AI-dependent endpoints (`/api/chat`, `/api/ai/input-assist`) require `GEMINI_API_KEY`. `/api/analyze` works without it (deterministic summary, no AI narratives).

---

## 3. Telegram Bot

Chat with BreakPoint directly in Telegram. The bot is dependency-free (long-polling) and runs the same engine in-process.

### One-time setup

1. In Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`. Follow the prompts and copy the token it gives you.
2. Add it to `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456:ABC-your-token
   ```
   (Add `GEMINI_API_KEY` too if you want AI summaries and `/chat`.)
3. Start the bot:
   ```bash
   npm run bot
   ```
   You should see `✓ BreakPoint Telegram bot running as @yourbot`.

### Bot commands

| Command | Description |
|---------|-------------|
| `/start`, `/help` | Show the welcome/help message |
| `/analyze` | Guided walkthrough — the bot asks one question per input field |
| `/example` | Run the ready-made SaaS example |
| `/sessions` | List recent analyses |
| `/result [id]` | Show your latest analysis, or a specific one by id |
| `/chat <question>` | Ask about your latest analysis (needs `GEMINI_API_KEY`) |
| `/cancel` | Abort the current `/analyze` walkthrough |

### How the guided flow works

- After `/analyze`, the bot asks for each field in turn (e.g. "Price per customer ($)").
- Required fields must be answered; for optional fields you can reply `skip` to accept the default.
- When all fields are collected, the bot runs the analysis and replies with the full breakdown, then remembers the result so you can immediately use `/chat`.

Example conversation:

```
You:  /analyze
Bot:  Question 1/11 — Business type (required) ...
You:  saas
Bot:  Question 2/11 — Price per customer ($) ...
You:  49
...
Bot:  (full analysis: base case, vulnerabilities, executive summary)
You:  /chat which assumption should I validate first?
Bot:  (AI answer grounded in your analysis)
```

---

## Input reference

Fields marked **\*** are required. Everything else defaults to `0` (or `monthly` for billing cycle).

| Field | Type | Required | Meaning |
|-------|------|:--------:|---------|
| `businessType` | enum | **\*** | `saas`, `subscription`, `ecommerce`, `physical`, `marketplace`, or `other`. Drives which stress scenarios are generated. |
| `pricing` | number | **\*** | Revenue per customer per billing cycle |
| `monthlyChurn` | number | **\*** | Percent of customers lost per month (e.g. `5` = 5%) |
| `cac` | number | **\*** | Customer acquisition cost |
| `fixedCosts` | number | **\*** | Fixed monthly costs (rent, salaries, tooling) |
| `monthlyNewCustomers` | number | **\*** | New customers acquired per month |
| `billingCycle` | enum | | `monthly` (default) or `annual` |
| `variableCostPerUnit` | number | | Cost to serve one customer |
| `currentRevenue` | number | | Starting MRR |
| `currentCustomers` | number | | Customers you already have |
| `currentRunway` | number | | Months of cash remaining |

**Confidence (optional):** a map of field name → `high` \| `mid` \| `low`. Low-confidence assumptions are weighted as more concerning in the vulnerability ranking; high-confidence ones are down-weighted. Only supported via the JSON file (CLI) and the API body today.

---

## Understanding the output

Every analysis returns:

- **Base case** — break-even month (or "never within 24 months"), LTV:CAC ratio, net margin, month-24 MRR, 12-month revenue, and a health rating (`healthy` / `borderline` / `failing`).
- **Scenarios** — 10–15 variants: base, stress tests (churn/CAC up, pricing down), optimistic cases, and combined worst cases. Each has its own 24-month projection and break-even.
- **Vulnerabilities** — assumptions ranked by how much a shift moves your break-even, with an impact level (`High`/`Medium`/`Low`) and a plain-English consequence. Items that are both high-impact and low-confidence are **flagged**.
- **Executive summary** — a short narrative (AI-generated when a key is set, rule-based otherwise).

Results are persisted to `storage/sessions.json` and shared across all three channels — an analysis you create via the API can be opened in the CLI, and vice versa.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| "Chat requires GEMINI_API_KEY" | Set `GEMINI_API_KEY` in `.env`. Chat and input-assist are AI-only. |
| Executive summary looks generic / templated | Running in deterministic mode (no `GEMINI_API_KEY`). Numbers are still accurate. |
| API returns `401` / `403` | `API_KEY` is set. Send `x-api-key` or `Authorization: Bearer` with the correct value. |
| "We've hit our daily analysis capacity" | Gemini rate limit reached. Analyses still run; AI narratives fall back until the limit resets. |
| Bot won't start / "TELEGRAM_BOT_TOKEN is not set" | Add the token from @BotFather to `.env`. |
| `npm run cli` ignores my flags | Add `--` before the arguments: `npm run cli -- analyze --pricing 49`. |
| Validation errors on `analyze` | Provide all required fields (see [Input reference](#input-reference)) or run `node cli/breakpoint.js help`. |
