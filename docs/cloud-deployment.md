# Memory Anki Cloud Trial

This branch keeps the current local SQLite + Tailscale workflow intact and adds
the minimum switches needed to try a private cloud deployment.

## Runtime Shape

- Local private mode remains unchanged: FastAPI serves the API and optionally the built web app from local SQLite.
- Cloud trial mode uses Vercel for both `apps/web` and the FastAPI function, with Supabase Postgres for the database.
- The frontend uses same-origin `/api/v1` when hosted by Vercel, so `VITE_API_ORIGIN` can stay empty.

## Required Cloud Environment

Vercel environment:

```text
MEMORY_ANKI_DATABASE_URL=postgresql+psycopg://...
MEMORY_ANKI_CORS_ORIGINS=https://your-vercel-preview.vercel.app
MEMORY_ANKI_DEPLOY_TARGET=cloud
MEMORY_ANKI_RUN_MODE=serve
```

If you deploy the API somewhere outside Vercel later, set the frontend host:

```text
VITE_API_ORIGIN=https://your-render-api.onrender.com
```

Keep provider secrets such as `DASHSCOPE_API_KEY` only in the backend host.
Never expose service-role or model-provider secrets through Vite variables.

## First Trial Steps

1. Create a Supabase project and copy the pooled Postgres connection string.
2. Deploy the repository to Vercel using `vercel.json`.
3. Fill `MEMORY_ANKI_DATABASE_URL`, `MEMORY_ANKI_DEPLOY_TARGET=cloud`, and AI provider keys in Vercel.
4. Enable Vercel deployment protection for private access.
5. Open `/api/v1/runtime-health` on the Vercel deployment and confirm it returns `ok: true`.
6. Run the UI against the same Vercel deployment before migrating real study data.

## Known Gaps Before Full Cloud Use

- Existing Alembic migrations include SQLite-specific guards; cloud trial currently bootstraps the ORM baseline and still needs a reviewed Supabase migration before real data migration.
- Attachment and generated-file storage still use the local filesystem; Supabase Storage adapter work is still required.
- Backup/restore code reads SQLite files directly and should stay local-only until rewritten for Postgres snapshots.
