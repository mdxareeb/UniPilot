# Presenton — the Presentation generator service (Task 31.x)

UniPilot's `presentation` tool is backed by [Presenton](https://presenton.ai), an
open-source (Apache-2.0) AI presentation generator with its own HTTP API. The
integration is **service-over-HTTP, never vendored**: Presenton's checkout lives
beside the repo at `../presenton-main` for local development only and is
git-ignored (root `.gitignore`), so none of its source, runtime state or
provider keys can ever reach UniPilot's GitHub repo. UniPilot talks to it with
three server-only environment variables and a handful of REST endpoints
documented below.

Attribution: Presenton is Apache-2.0 licensed. Its `LICENSE` and `NOTICE` files
stay intact in the upstream checkout and nothing in this repo copies,
redistributes or modifies its code.

---

## 1. Environment variables (UniPilot side — server-only, never `NEXT_PUBLIC_*`)

| Variable | Purpose |
| --- | --- |
| `PRESENTON_URL` | Base URL of the self-hosted Presenton service (e.g. `http://localhost:5001`). Unset is the honest default: the tool reports it is not connected, enqueues nothing, and never fakes a deck. |
| `PRESENTON_API_KEY` | Optional `sk-presenton-…` API key. Sent as `Authorization: Bearer …` on every UniPilot → Presenton request. Required whenever the Presenton instance has authentication enabled (the default for the web deployment). |
| `PRESENTON_PUBLIC_URL` | Browser-reachable Presenton origin, used only by the Phase-2 editor wrapper (the iframe needs a URL the *browser* can resolve). Defaults to `PRESENTON_URL` when unset. |
| `PRESENTON_POLL_INTERVAL_MS` | Worker-only knob: how often the async task is polled (default 5000 ms, minimum 500 ms). |
| `PRESENTON_POLL_TIMEOUT_MS` | Worker-only knob: how long one generation attempt may poll before the 29.1 runner retries it (default 600000 ms = 10 minutes, minimum 10 s). |

Locally these live in `frontend/.env.development.local` (git-ignored): the Next
server reads it for the tool page/actions and the Node worker inherits it via
`--env-file` (backend `package.json`). Never logged, never sent to the browser.

## 2. Running Presenton locally (separate service)

Docker, from the upstream checkout (web UI on **port 5001**):

```bash
cd ../presenton-main
# one-time .env next to the compose file — NEVER committed (root .gitignore
# ignores presenton-main/ entirely)
cat > .env <<'EOF'
# Text LLM provider (see §4 for every option)
LLM=google
GOOGLE_API_KEY=<your-key>
# Slide images: either an image provider + key, or none for text-only decks
DISABLE_IMAGE_GENERATION=true
# Fixed deployment: keys hidden and unmodifiable in the web UI
CAN_CHANGE_KEYS=false
# First-boot administrator (multi-user auth; required to mint an API key)
AUTH_USERNAME=admin
AUTH_PASSWORD=<change-this-password>
EOF

docker run -it --name presenton \
  -p 5001:80 \
  --env-file .env \
  -v "./app_data:/app_data" \
  ghcr.io/presenton/presenton:latest
```

Open `http://localhost:5001`, sign in with `AUTH_USERNAME`/`AUTH_PASSWORD`, then
mint the UniPilot key under **Admin → API keys** (`POST
/api/v1/admin/api-keys` from an admin session; label it "UniPilot"). Put the
`sk-presenton-…` value into `frontend/.env.development.local` as
`PRESENTON_API_KEY` and set `PRESENTON_URL=http://localhost:5001`.

**Local single-user alternative (used for the 2026-09-14 verification).** The
self-hosted image also honours Presenton's own single-user runtime: start it
with `-e DISABLE_AUTH=true` and no API key is needed — the API answers
unauthenticated as the internal `electron` admin, and the embedded editor
loads without a separate sign-in. Data/volume stay identical; re-create the
container without the flag (with `AUTH_USERNAME`/`AUTH_PASSWORD` for first
boot) to return to key-based auth. Note `docker restart` re-uses the
container's captured env — env changes need `docker rm` + `docker run`.

**The web UI's provider gate wants the model in the settings store.** Env vars
alone satisfy the API, but the Next UI validates the admin provider settings
(it requires the provider, the key **and the model** — e.g. `GOOGLE_MODEL` —
via `hasValidLLMConfig`) and redirects every app route to its setup wizard
when anything is missing. If the wizard is not completed in the browser, PUT
the missing fields once, e.g.
`PUT /api/v1/admin/provider-settings {"GOOGLE_MODEL":"<model>"}` (admin auth;
in single-user mode no credentials are needed). Same applies before using the
§3.6 editor: without a valid settings row, `/presentation?id=…` redirects to
the wizard instead of the deck.

Presenton's `app_data/` volume (its SQLite DB and provider settings), its
`.env` and its runtime state are the separate service's own — never
referenced, committed or served by UniPilot. Its git-ignored `userConfig.json`
holds the configuration the web UI writes (including its own credential
hashes); UniPilot never reads it directly.

## 3. The endpoints UniPilot calls (exact shapes)

All routes are under `PRESENTON_URL`; `path`-style responses are appended to it.

### 3.1 Start generation — `POST /api/v1/ppt/presentation/generate/async`

Request body (`GeneratePresentationRequest`):

```json
{
  "content": "Introduction to Machine Learning",
  "n_slides": 5,
  "language": "English",
  "template": "general",
  "export_as": "pptx"
}
```

- `content` (string, required) — the prompt/topic. Empty string when
  `slides_markdown` carries every slide.
- `slides_markdown` (string[] | null) — one Markdown string per slide instead
  of AI outline generation (≤ 50 items; each ≤ `MAX_OUTLINE_WORDS` words).
- `instructions`, `tone` (`default|casual|professional|funny|educational|sales_pitch`),
  `verbosity` (`concise|standard|text-heavy`), `web_search` (bool),
  `n_slides` (int), `language`, `template` (default `"general"`),
  `include_table_of_contents` (bool), `include_title_slide` (bool),
  `files` (string[] — paths from §3.4), `export_as` (`pptx|pdf`).

Response (`AsyncTaskModel`):

```json
{
  "id": "task-<64 hex>",
  "type": "presentation.generate",
  "status": "pending",
  "message": "Queued for generation",
  "data": {
    "created_slides": 0,
    "remaining_slides": 5,
    "presentation_id": "d3000f96-096c-4768-b67b-e99aed029b57"
  },
  "created_at": "2026-09-14T07:00:00Z",
  "updated_at": "2026-09-14T07:00:00Z"
}
```

The same type powers the synchronous `POST /api/v1/ppt/presentation/generate`
(returns `{presentation_id, path, edit_path}` directly); UniPilot's worker uses
the async form so generation survives the request.

### 3.2 Poll — `GET /api/v1/ppt/presentation/status/{taskId}`

Same `AsyncTaskModel`. `status` moves `pending → processing → completed | error`.
While generating, `data` carries `created_slides` / `remaining_slides` /
`presentation_id`. On **completed** it also carries the result fields:

```json
{
  "status": "completed",
  "data": {
    "created_slides": 5,
    "remaining_slides": 0,
    "presentation_id": "d3000f96-…",
    "path": "/app_data/d3000f96-…/Introduction_to_Machine_Learning.pptx",
    "edit_path": "/presentation?id=d3000f96-…"
  }
}
```

On **error**, `message` says so and `error` carries a structured copy
(`{"status_code": 500, "detail": "…"}`).

> **Upstream workaround in force (2026-09-14).** On the current
> `ghcr.io/presenton/presenton:latest` (upstream image built 2026-09-08, verified
> still current by `docker pull`), **both** `GET /presentation/status/{id}` and
> `GET /async-tasks/status/{id}` answer `500 Internal Server Error` for every
> task whose `data` is set: the handler assigns
> `response.data = absolute_mcp_result_links(request, response.data)` onto a
> `model_copy` whose SQLAlchemy state was garbage-collected
> (`sqlalchemy.orm.exc.ObjectDereferencedError: … parent object … has been
> garbage collected`, `presentation.py:3212` / `async_tasks/router.py:83`).
> UniPilot's worker and adapter therefore resolve a task from
> `GET /api/v1/async-tasks?type=presentation.generate&limit=200&order=desc`
> (and filter by task id), which returns the identical `AsyncTaskModel` fields
> without the mutation. The response shapes below are unchanged; revert both
> call sites to the status route once upstream fixes it. Generation itself is
> unaffected — tasks complete and export normally; only the two status reads
> are broken.

### 3.3 Download the export — `GET {path}`

`path` is served by Presenton's static mount (`/app_data/...` → the exported
PPTX/PDF bytes). Send the same `Authorization` header; the worker then uploads
the bytes to UniPilot's private `documents` bucket as a `documents` row with
`source = 'presentation'` so it appears in `/documents` with the existing
preview/download.

### 3.4 Upload a source document — `POST /api/v1/ppt/files/upload`

Multipart form field `files` (one or more files) → response is a JSON array of
Presenton-side paths (`["<user-scoped path>", …]`) that pass unchanged into the
`files` field of §3.1. UniPilot's worker downloads the student's chosen
document from the `documents` bucket and re-uploads it here.

### 3.5 Templates — `GET /api/v1/ppt/template/all`

Query `default=true` (built-in templates), `page`, `page_size` (≤ 100) →

```json
{
  "items": [
    {
      "id": "general",
      "name": "General",
      "description": "…",
      "layout_count": 12,
      "thumbnail": "/static/…",
      "preview_url": "…",
      "is_default": true,
      "created_at": "…",
      "updated_at": "…"
    }
  ],
  "total": 6, "page": 1, "page_size": 100
}
```

The tool page's template picker lists these; `template` on §3.1 takes the `id`
(default `"general"`).

### 3.6 Editor (Task 31.x fork) — `GET {PRESENTON_UI_URL}/presentation?id={presentation_id}`

UniPilot's `/tools/presentation/[id]/edit` wrapper embeds the **forked,
UniPilot-themed Presenton UI** (`presenton-ui/`, git-ignored, its own repo —
see `docs/superpowers/specs/2026-09-15-presenton-fork-theme-design.md` and
`presenton-ui/DIVERGENCE.md`). The fork talks to the engine over its own
middleware proxy; the engine is unchanged.

`resolveEditorUrl()` (in the adapter) picks the URL with an honest fallback:
`PRESENTON_UI_URL` when set **and reachable** (a 1.5 s probe of its proxied
`/api/v1/auth/status`), otherwise the engine's own editor
(`PRESENTON_PUBLIC_URL ?? PRESENTON_URL`). Unset or down never yields a dead
link. `PRESENTON_UI_URL` is server-only, like the other Presenton variables.

## 4. Switching the LLM provider (config-only, never a UniPilot code change)

UniPilot is provider-agnostic: the adapter only calls Presenton over HTTP. The
provider is whichever Presenton was started with. Set in
`presenton-main/.env`, restart the container, done — no UniPilot change:

| Provider | Presenton env |
| --- | --- |
| Google Gemini | `LLM=google`, `GOOGLE_API_KEY=<key>`, `GOOGLE_MODEL=<model>` (the model field must also be present in the admin provider settings — see §2; `gemini-2.5-flash` is rejected by Google for new users, `gemini-3.x-flash` models are current; free-tier quotas are per-model and can rate-limit a multi-call deck — UniPilot's worker retries 429s with backoff) |
| OpenAI | `LLM=openai`, `OPENAI_API_KEY=<key>`, `OPENAI_MODEL=<model>` (default `gpt-4.1`; `IMAGE_PROVIDER=dall-e-3` optional) |
| Anthropic | `LLM=anthropic`, `ANTHROPIC_API_KEY=<key>`, `ANTHROPIC_MODEL=<model>` |
| OpenRouter | `LLM=openrouter`, `OPENROUTER_API_KEY=<key>`, `OPENROUTER_MODEL=<model>` |
| Ollama (local, keyless) | `LLM=ollama`, `OLLAMA_MODEL=llama3.2:3b` — either a host Ollama via `OLLAMA_URL=http://host.docker.internal:11434`, or `START_OLLAMA=true` so the container installs and serves Ollama itself. CPU generation is minutes per deck. |

Slide images additionally need an image provider (`IMAGE_PROVIDER=pexels`
+ `PEXELS_API_KEY`, `gemini_flash`, `dall-e-3`, …) or
`DISABLE_IMAGE_GENERATION=true` for text-only decks. Everything else
(`CAN_CHANGE_KEYS`, `PRESENTATION_GENERATION_MODE`, auth rotation) is
documented in Presenton's own README and never re-documented here.

## 5. UniPilot-side wiring (what reads/writes what)

```
Tool page  /tools/presentation        (server page → actions → presentational client)
      │  createPresentationAction     gate → validate → presentations row (status queued)
      │                               → enqueueJob("presentation.generate", {presentationId})
      ▼
public.presentations row            (request + status mirror + document link; owner-SELECT RLS)
      ▼
Node worker  presentation.generate   (backend/worker/presentationJobs.mjs)
      │  §3.4 upload source doc (optional) → §3.1 start → §3.2 poll (touch_job heartbeat)
      │  → §3.3 download export → quota check → documents row (source='presentation') + bucket object
      ▼
/documents                          (existing preview/download; registry stays `planned`
                                     until a configured environment produces a real deck)
```

Payloads carry ids only; Presenton keys never leave the server process; the
job reuses the 29.1 runner's retry/backoff/dead-letter policy.
