# Learning Assessment Workspace

An open family learning MVP for interactive worksheets, handwritten or
photographed work, AI-assisted feedback, correction cycles, and spaced review.

## Product

Parents create or import a structured question set, review it, and assign it to
a child. Children answer with choices, text, on-screen handwriting, photos, or
printed paper. A provider-neutral background job can grade one locked answer
while the child continues, or grade the entire submission and return
per-question feedback for correction and later review.

The canonical MVP requirements are in [docs/mvp-spec.md](docs/mvp-spec.md).

## Architecture

- `apps/web`: Next.js static-export PWA deployed to Cloudflare Pages.
- `apps/api`: FastAPI application and PostgreSQL-backed background worker.
- `supabase`: PostgreSQL migrations, RLS policies, Auth, and private Storage.
- `compose.yaml`: local API, worker, and web containers.

Production delivery uses `study.hypnochunk.com` for the static frontend and
`api.study.hypnochunk.com` for the Docker API. CI uses the deterministic fixture
adapter. A controlled private worker may instead use the Codex CLI adapter to
grade an isolated, identity-free rendering of a handwriting response, create a
parent-review draft from private PNG/JPEG/PDF completed-paper pages, or extract
knowledge-point metadata from private textbook/reference pages. For source
materials, the database retains only extracted metadata and confidence, not the
model's section transcription; other AI providers still integrate through the
same typed API contracts.

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
parent, family, child, assignment, attempt, private response photo, and grading
job. It verifies that anonymous Storage access fails, then removes the exact
Storage object, temporary family, and Auth user in a `finally` cleanup.

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
`deploy/nginx`. The API and single-concurrency worker run in Docker on the
shared 8G VPS, behind the HTTPS-only `api.study.hypnochunk.com` virtual host.
The worker image includes the pinned Codex CLI, but the adapter is enabled only
after a private server-side device login, `AI_PROVIDER=codex_cli`, and an
explicit family UUID allowlist in `CODEX_FAMILY_IDS`. An empty allowlist sends no
learner response or source material to Codex. For an allowed family,
completed-paper PNG/JPEG scans or PDFs and optional private answer-key/reference
images may produce an AI draft only. A private textbook/reference import can
also yield only its extracted knowledge-point metadata; the section
transcription remains temporary and is not stored. Private PDFs are rendered
page-by-page in the worker's temporary directory (up to 100 pages) and are
never made public; the parent must still confirm every question and answer
region before an immutable attempt or grading job is created.
The host has persistent Swap and container memory limits. Field-limited browser
API errors are stored under `/opt/learning-assessment/logs` with bounded file
rotation; request bodies, credentials, PINs, and URL query strings are excluded.
Hosted Supabase owns Auth, PostgreSQL, and private Storage; all repository
migrations are applied before the matching API/Worker release.

This deployment is still a controlled pilot. Google/LINE provider setup, a real
provider for photo/essay grading, generated listening audio, whole-page paper
extraction, and public-library publication remain feature-gated until their
integration or evaluation thresholds are approved.

## Data and privacy

This is a public repository. Never commit learner identities, answers, photos,
raw source material, database exports, API keys, or private credentials.
Runtime data belongs in Supabase private services. Only publishable browser
configuration may be exposed to the frontend.

## License

Released under the [MIT License](LICENSE).
