# PipeIQ Scaffold

This repo is a greenfield scaffold for the PipeIQ PRD with two runnable surfaces:

- `apps/web`: React + Vite dashboard scaffold for onboarding, connection setup, and AI SDR chat.
- `services/agent-api`: FastAPI service for workspace metadata, manual Composio authorization, and OpenAI Agents SDK orchestration.

## Why the backend is Python

The PRD calls for a Node/Hono backend, but this scaffold intentionally moves the agent runtime and connection layer to Python because the requested SDK stack is:

- `composio`
- `composio-openai-agents`
- `openai-agents`

That keeps the manual authorization flow native to the current SDKs you asked to use. The API contracts are simple enough that you can still swap in Hono later without reworking the frontend.

## Repo Layout

```text
apps/
  web/                 React UI scaffold
services/
  agent-api/           FastAPI + Composio + OpenAI Agents SDK
PipeIQ_PRD_v2.docx     Source PRD
```

## Local Setup

### 1. Frontend

```bash
cd apps/web
npm install
npm run dev
```

### 2. Agent API

```bash
python -m venv .venv
.\.venv\Scripts\activate
pip install -e services/agent-api
copy services\agent-api\.env.example services\agent-api\.env
uvicorn pipeiq_api.main:app --app-dir services/agent-api/src --reload --port 8000
```

## Environment

The backend runs in a useful offline mode for the UI scaffold, but the real flows require:

- `COMPOSIO_API_KEY`
- `OPENAI_API_KEY`
- optional Composio auth config ids for white-labeled OAuth

See [services/agent-api/.env.example](/D:/Lead%20Outbound%20Agent/services/agent-api/.env.example).
See [docs/composio-manual-auth.md](/D:/Lead%20Outbound%20Agent/docs/composio-manual-auth.md) for the exact SDK flow used in this repo.
See [schema.sql](/D:/Lead%20Outbound%20Agent/supabase/schema.sql) for the Supabase/Postgres migration target that mirrors the PRD tables.

## What is implemented

- workspace and roadmap scaffold based on the PRD
- manual Composio authorization endpoint with `manage_connections=False`
- frontend onboarding cards for required and optional integrations
- initial AI SDR chat route using OpenAI Agents SDK with local PipeIQ tools
- clear service boundaries for future Apollo, Instantly, Supabase, Trigger.dev, and Stripe work

## What is intentionally stubbed

- persistent storage
- Supabase auth and database tables
- Trigger.dev jobs and webhook processing
- Instantly API operations
- Apollo enrichment and scoring

Those are represented as explicit next-step seams instead of hidden TODOs in random files.
