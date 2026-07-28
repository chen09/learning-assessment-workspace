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

`npm run e2e:hosted` is a guarded, manual production smoke test. It requires the
ignored hosted Supabase environment values and an explicit
`HOSTED_E2E_CONFIRM=study.hypnochunk.com`; it creates a temporary verified
parent, family, child, assignment, attempt, and grading job, then removes the
temporary family and Auth user in a `finally` cleanup.

The local Supabase stack includes Auth, PostgreSQL, private Storage, and Mailpit.
Its Studio is available at `http://127.0.0.1:54323`. The browser build reads
only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`NEXT_PUBLIC_API_URL`; service, database, and AI credentials remain API-only.

## Deployment

The production web app is connected directly to the GitHub `main` branch through
Cloudflare Pages. Successful main-branch builds publish to
`study.hypnochunk.com`; the Pages project keeps the Supabase browser settings and
`NEXT_PUBLIC_API_URL=https://api.study.hypnochunk.com` as build variables. The
gated `deploy-web.yml` workflow remains disabled as a manual fallback, so it
does not duplicate the native Pages deployment.

The production API template is in `deploy/compose.production.yaml` and binds
FastAPI only to `127.0.0.1:8010`; the matching host Nginx template is under
`deploy/nginx`. The API and single-concurrency fixture worker run in Docker on
the shared 8G VPS, behind the HTTPS-only `api.study.hypnochunk.com` virtual host.
The host has persistent Swap and container memory limits. Hosted Supabase owns
Auth, PostgreSQL, and private Storage; all nine repository migrations are
applied.

This deployment is still a controlled pilot. Google/LINE provider setup, a real
AI provider, generated listening audio, whole-page paper extraction, and
public-library publication remain feature-gated until their integration or
evaluation thresholds are approved.

## Data and privacy

This is a public repository. Never commit learner identities, answers, photos,
raw source material, database exports, API keys, or private credentials.
Runtime data belongs in Supabase private services. Only publishable browser
configuration may be exposed to the frontend.

## License

Released under the [MIT License](LICENSE).
