# Learning Assessment Workspace

An open family learning MVP for interactive worksheets, handwritten or
photographed work, AI-assisted feedback, correction cycles, and spaced review.

## Product

Parents create or import a structured question set, review it, and assign it to
a child. Children answer with choices, text, on-screen handwriting, photos, or
printed paper. A provider-neutral background job grades the full submission and
returns per-question feedback for correction and later review.

The canonical MVP requirements are in [docs/mvp-spec.md](docs/mvp-spec.md).

## Architecture

- `apps/web`: Next.js static-export PWA deployed to Cloudflare Pages.
- `apps/api`: FastAPI application and PostgreSQL-backed background worker.
- `supabase`: PostgreSQL migrations, RLS policies, Auth, and private Storage.
- `compose.yaml`: local API, worker, and web containers.

Production delivery uses `study.hypnochunk.com` for the static frontend and
`api.study.hypnochunk.com` for the Docker API. The production AI provider is
intentionally undecided; integrations must implement the contracts in the API.

## Local development

Requirements: Docker, Node.js 24, npm, and `uv`.

```sh
npm install
npx supabase start
cp .env.example .env
docker compose up --build
```

Copy the local URL, publishable key, service-role key, and database connection
reported by `npx supabase status` into `.env`. Set
`REPOSITORY_BACKEND=postgres` to exercise the real tenant, storage, job, and
review flow; the default in-memory repository is only a deterministic UI/test
fixture. If port 3000 is already used, set `WEB_PORT` to another local port
before starting Compose.

Run all repository checks with:

```sh
npm run check
npm run e2e
npx supabase test db
```

The PostgreSQL browser flow additionally verifies real local Supabase Auth,
PostgreSQL persistence, the database worker, and private tenant APIs. Load the
local values reported by Supabase into the matching environment variables, then
run `npm run e2e:postgres`. CI runs this flow automatically inside its isolated
local Supabase stack.

The local Supabase stack includes Auth, PostgreSQL, private Storage, and Mailpit.
Its Studio is available at `http://127.0.0.1:54323`. The browser build reads
only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`NEXT_PUBLIC_API_URL`; service, database, and AI credentials remain API-only.

## Deployment

The Cloudflare Pages workflow is deliberately gated by the repository variable
`CLOUDFLARE_DEPLOY_ENABLED=true`. It also needs the Pages project name, account
ID, API token, Supabase public URL, and publishable key configured in GitHub.
Until those values exist, pushes run CI but do not deploy.

The production API template is in `deploy/compose.production.yaml` and binds
FastAPI only to `127.0.0.1:8010`; the matching host Nginx template is under
`deploy/nginx`. Before enabling it on the 8G VPS, add Swap, confirm at least 2GB
free memory, create `api.study.hypnochunk.com`, and issue its certificate.

The repository is deployable but no production deployment is performed by
default. Hosted Supabase migrations, SMTP, Google/LINE provider settings,
Cloudflare Pages credentials, and the API DNS/certificate must be configured
before enabling a family pilot. The real AI provider, generated listening
audio, whole-page paper extraction, and public-library publication remain
feature-gated until their evaluation thresholds are approved.

## Data and privacy

This is a public repository. Never commit learner identities, answers, photos,
raw source material, database exports, API keys, or private credentials.
Runtime data belongs in Supabase private services. Only publishable browser
configuration may be exposed to the frontend.

## License

Released under the [MIT License](LICENSE).
