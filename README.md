# PipeIQ

PipeIQ is an AI-powered autonomous outbound platform for B2B teams. The product scope and operating model are defined in [PipeIQ_PRD_v2.docx](/D:/Lead%20Outbound%20Agent/PipeIQ_PRD_v2.docx).

## Repo Layout

```text
apps/
  web/         React + Vite desktop frontend
services/
  api/         Node.js + Hono backend
packages/
  shared/      Shared TypeScript types
supabase/
  schema.sql   Supabase/Postgres schema draft
docs/
```

## Stack

- Frontend: React + Vite + TypeScript + Tailwind
- Backend: Node.js + Hono + TypeScript
- AI: OpenAI `gpt-4o` via the `openai` npm package
- Integrations: Composio via `@composio/core`
- Data/Auth: Supabase

## Local Development

```bash
npm install
npm run dev
```

Individual services:

```bash
npm run dev:web
npm run dev:api
```

Build:

```bash
npm run build:web
npm run build:api
```

## Environment

Backend environment variables live in [services/api/.env.example](/D:/Lead%20Outbound%20Agent/services/api/.env.example).

Frontend environment variables live in [apps/web/.env.example](/D:/Lead%20Outbound%20Agent/apps/web/.env.example).

## Notes

- `supabase/schema.sql` is preserved as-is from the current product plan.
- `docs/` is preserved as-is.
- The frontend still uses the existing product scaffold and now talks to the Hono backend.
