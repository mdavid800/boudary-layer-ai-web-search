# Boundary Layer AI Web Search

This repository gives you a CLI workflow for researching offshore wind farms with web-backed models, storing the results as draft reports, auto-verifying source-of-record evidence, and handing those drafts off to the moderation workflow before publish.

It also includes a database linkage workflow for mapping turbine rows in `turbine_database` to eligible boundaries in `windfarm_database`.

## What it does

When you provide a wind farm name, the single-report CLI:

1. Loads `prompt.md`
2. Replaces `{WIND_FARM_NAME}` with the name you pass in
3. Calls OpenRouter web search through the `openrouter:web_search` server tool
4. Passes search engine `auto` by default
5. Prints the markdown report to stdout and can also save it to a file

When you run the database-backed workflow, the repository now also:

1. Stores reports as `draft` records by default
2. Auto-runs source-of-record evidence verification immediately after each draft is stored
3. Classifies each draft into a moderation queue state:
	- `ready_to_publish`
	- `blocked`
	- `needs_review`
4. Hands those drafts off to the moderator workflow in the web app

## Prerequisites

1. Node.js 20+
2. An OpenRouter API key for the OpenRouter provider path
3. One Codex auth path for the Codex provider path:
   - `OPENAI_API_KEY`, or
   - `CODEX_API_KEY`, or
   - Hermes OAuth via `hermes login --provider openai-codex`, or
   - Codex CLI OAuth via `codex login`
4. OpenRouter server tools enabled for your account when you use the OpenRouter provider

For OpenRouter web search server tools, use the official setup described here:

- <https://openrouter.ai/docs/guides/features/server-tools/web-search>

The CLI always uses the `openrouter:web_search` server tool.

## Setup

```powershell
npm install
Copy-Item .env.example .env
```

Then edit `.env` and set at least:

```dotenv
OPENROUTER_API_KEY=your_openrouter_key
```

For Codex / OpenAI research runs, pick one auth path:

```dotenv
# Option 1: regular OpenAI API key
OPENAI_API_KEY=your_open_ai_key

# Option 2: dedicated Codex key if you use one
CODEX_API_KEY=your_codex_key
```

If you want Codex via OAuth instead of an API key, leave both values blank and log in once on this machine:

```bash
hermes login --provider openai-codex
# or
codex login
```

The default runtime now uses:

```dotenv
OPENROUTER_SEARCH_ENGINE=auto
```

## Usage

Run the research workflow with a wind farm name:

```powershell
npm run research -- "Hornsea 3"
```

Save the generated markdown to a file as well:

```powershell
npm run research -- "Dogger Bank A" --output reports\dogger-bank-a.md
```

Use a different model for a single run:

```powershell
npm run research -- "East Anglia Three" --model openai/gpt-5.4-mini
```

Use Codex as the research provider for a single run:

```powershell
npm run research -- "East Anglia Three" --provider codex
```

That codex path now defaults to `gpt-5.5`. Override it with `--model` or `CODEX_MODEL` if you want a different OpenAI model. Authentication precedence for `--provider codex` is:

1. `CODEX_API_KEY`
2. `OPENAI_API_KEY`
3. Hermes OAuth token from `~/.hermes/auth.json`
4. Codex CLI OAuth token from `~/.codex/auth.json`

Show CLI help:

```powershell
npm run research -- --help
```

Run research sequentially for every row in the configured wind farm source table:

```powershell
npm run research-db
```

Publish directly from `research-db` instead of creating drafts:

```powershell
npm run research-db -- --publish
```

That direct `--publish` path is still available, but the recommended workflow is now to let `research-db` create drafts, review them in the moderation UI, and publish from there.

Verify draft reports without publishing them:

```powershell
npm run verify-reports -- --ids 208,209,210
```

Print the blocker summary as JSON for scripting or review:

```powershell
npm run verify-reports -- --ids 208,209,210 --json
```

Attempt automatic repair of blocked rows, keep the reports as drafts, and then re-verify them:

```powershell
npm run verify-reports -- --ids 208,209,210 --repair
```

Publish only the currently passing draft reports from the CLI:

```powershell
npm run publish-reports
```

Publish only specific draft report ids from the CLI:

```powershell
npm run publish-reports -- --ids 218,219
```

Operational note: `openai/gpt-5.4` can take materially longer than `openai/gpt-5.4-mini` before any visible payload arrives. In local investigation against the production Beatrice prompt, OpenRouter returned `200` quickly but streamed whitespace keepalive chunks for about 59 seconds before the first real GPT-5.4 payload, versus about 23 seconds for GPT-5.4-mini.

That workflow reads directly from the processing-owned core tables:

1. `public.core_wind_farms`
2. `public.core_turbines`
3. `public.core_wind_farm_turbine_links`

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` | - | Required API key for OpenRouter |
| `OPENROUTER_MODEL` | `openai/gpt-5.4` | Model used to synthesize the report |
| `OPENAI_API_KEY` | - | Optional first-party OpenAI API key for `--provider codex` |
| `CODEX_API_KEY` | - | Optional dedicated Codex API key for `--provider codex`; checked before `OPENAI_API_KEY` |
| `CODEX_MODEL` | `gpt-5.5` | Default OpenAI model used when `RESEARCH_PROVIDER=codex` or `--provider codex` |
| `OPENROUTER_SEARCH_ENGINE` | `auto` | Web search engine passed to `openrouter:web_search` |
| `OPENROUTER_MAX_RESULTS` | `8` | Maximum results per search call |
| `OPENROUTER_MAX_TOTAL_RESULTS` | `24` | Maximum total results across the full request |
| `RESEARCH_PROVIDER` | `openrouter` | Research provider switch: `openrouter` or `codex` |
| `OPENROUTER_SITE_URL` | empty | Optional `HTTP-Referer` header for OpenRouter |
| `OPENROUTER_SITE_NAME` | `boundary-layer-ai-web-search` | Optional `X-Title` header for OpenRouter |
| `HTTP_PROXY` / `HTTPS_PROXY` | empty | Optional outbound proxy URLs used by Node `fetch` requests to OpenRouter, OpenAI, and evidence sources. Lowercase variants are also supported through Undici. |
| `NO_PROXY` | empty | Optional comma- or space-separated hostnames that should bypass the proxy for Node `fetch` requests. Lowercase variant is also supported through Undici. |
| `DATABASE_URL` | - | Required for `npm run research-db`; Supabase Postgres connection string |
| `WIND_FARM_SOURCE_TABLE` | `core_wind_farms` | Source table for `npm run research-db` |
| `WIND_FARM_REPORTS_DIR` | `reports` | Base output directory for per-row reports generated by `npm run research-db` |
| `PROMPT_TRACE_ENABLED` | `false` | Optional debugging flag; when `true`, saves each fully rendered database-backed prompt to disk before the search runs |
| `PROMPT_TRACE_DIR` | `prompt-traces` | Base output directory for optional debugging prompt traces |
| `HOST` | `0.0.0.0` | Bind address for the HTTP moderation service |
| `PORT` | `3001` | Listening port for the HTTP moderation service |
| `WEB_SEARCH_SERVICE_TOKEN` | empty | Shared bearer token used to protect the deployed moderation endpoint |

## HTTP moderation service

This repository can now run as a small internal HTTP service for the moderation actions used by `boundary-layer-app`.

Start it locally or in Railway with:

```powershell
npm start
```

Available endpoints:

1. `GET /healthz`
2. `POST /internal/report-moderation`

The moderation endpoint accepts JSON with:

```json
{
	"action": "save",
	"reportId": 218,
	"payload": {
		"reportMarkdown": "...",
		"modelUsed": "openai/gpt-5.4-mini",
		"autoVerify": true,
		"autoRepair": false
	},
	"repair": false
}
```

If `WEB_SEARCH_SERVICE_TOKEN` is set, send it as `Authorization: Bearer <token>`.

## Railway deployment

For Railway, deploy this repo as its own service.

Set these environment variables on the Railway service:

1. `DATABASE_URL`
2. `OPENROUTER_API_KEY`
3. `OPENAI_API_KEY` if you use the Codex provider
4. `WEB_SEARCH_SERVICE_TOKEN`
5. Any optional OpenRouter tuning vars you already use

Use the default start command from `package.json`, which now runs the HTTP server. Railway will inject `PORT` automatically.

## Database-backed research workflow

`npm run research-db` reads each row from the configured `WIND_FARM_SOURCE_TABLE` in sequence and injects only compact validation metadata into the prompt:

Common filtered runs:

```powershell
# Research all farms in a country
npm run research-db -- --country "United Kingdom"

# Research only offshore wind farms in a country
npm run research-db -- --country "United Kingdom" --wind-farm-type "Offshore wind farm"

# Research only new UK offshore wind farms that do not already have a report
npm run research-db -- --country "United Kingdom" --wind-farm-type "Offshore wind farm" --skip-existing-reports
```

1. From `core_wind_farms`: `name`, `turbine_count`, `power_mw`, and `status`
2. From linked `core_turbines` rows, when available: `manufacturer`, `rated_power_mw`, `rotor_diameter_m`, `hub_height_m`, `turbine_type`, and `commissioning_date`

`research-db` already excludes rows where `record_status <> 'active'` and rows whose cleaned status is `Archive`, so `--country "United Kingdom" --wind-farm-type "Offshore wind farm"` targets the final offshore-only list from the processed core table. Add `--skip-existing-reports` when you want only wind farms that have not yet been researched at all.

The prompt still asks the model to validate everything with current web sources and supporting links. The database values are treated as moderately confident validation inputs, not final truth.

`npm run verify-reports` is the safe draft-report verification workflow. By default it only reports blockers. With `--repair`, it uses the same blocked-row repair path as publish, saves repaired markdown back into the draft report, and re-runs verification, but it still does not publish reports or activate facts.

## Recommended end-to-end workflow

The current recommended process is:

1. Run research into drafts from this repository.
2. Let the auto-verifier classify each draft as `ready_to_publish`, `blocked`, or `needs_review`.
3. Open the moderation dashboard in `boundary-layer-app` and review the draft report there.
4. If needed, edit the draft, re-run verification, or request a non-destructive AI repair suggestion.
5. Publish the approved draft from the moderation UI.

### 1. Generate draft research

Run a filtered draft batch:

```powershell
npm run research-db -- --country "Denmark" --wind-farm-type "Offshore wind farm" --skip-existing-reports
```

Run only specific wind farm ids:

```powershell
npm run research-db -- --ids 6431
```

Important behavior:

1. `research-db` creates `draft` reports by default.
2. Each draft is auto-verified immediately after storage.
3. New drafts should therefore reach moderation already marked as `ready_to_publish`, `blocked`, or `needs_review`.

If you are doing a refresh of an already published operational project, use:

```powershell
npm run research-db -- --ids 6431 --operational-refresh
```

That creates a fresh draft for review and does not support direct publish.

### 2. Review or repair drafts from the CLI if needed

Inspect specific draft ids:

```powershell
npm run verify-reports -- --ids 218 --json
```

Re-run verification without publishing:

```powershell
npm run verify-reports -- --ids 218
```

Try the CLI repair path and keep the report as a draft:

```powershell
npm run verify-reports -- --ids 218 --repair
```

The CLI repair path is still useful for operations and bulk cleanup, but the preferred moderator flow is now the web UI because it shows blocker detail and supports a reviewable AI suggestion before saving any changes.

### 3. Open the moderation dashboard in the app

From `boundary-layer-app`:

```powershell
cd ..\boundary-layer-app
npm install
npm run dev
```

If your signed-in user is not already a moderator:

```powershell
npm run grant-moderator -- --email you@example.com
```

Then sign in and open:

```text
/admin/moderation
```

Draft research reports should appear there after `research-db` finishes storing and auto-verifying them.

### 4. Moderate the draft report

On the draft review page in the app you can now:

1. inspect the draft map and structured report fields
2. see exactly which source-of-record rows are blocked and why
3. use `Save and verify` after manual edits so the draft and blocker state refresh together
4. use the same primary action as `Re-verify` when there are no unsaved changes
5. click `Suggest AI fix` to generate a non-destructive proposal
6. review the AI proposal and explicitly apply it
7. let the app auto-verify immediately after applying any AI proposal
8. use `Approve and publish` only when the draft is `ready_to_publish`; publish stays disabled while there are unsaved changes

The moderation workspace now also shows an explicit workflow-status summary so the next action is clearer: save changes, resolve blockers, or publish a clean draft.

The queue meanings are:

1. `ready_to_publish`: no blocked or pending source-of-record rows remain
2. `blocked`: one or more source-of-record rows failed verification
3. `needs_review`: no blockers are recorded, but source-of-record evidence is still missing or unverified

### 5. Publish the approved draft

Preferred path: publish from the moderation UI after the draft is clean.

Fallback operations path from this repository:

```powershell
npm run publish-reports -- --ids 218
```

`publish-reports` always re-runs verification before publish. If blockers remain and an API key is configured, it can still attempt blocked-row repair automatically. Only passing drafts are published and only their linked research facts are activated.

### When does a report appear on the moderation dashboard?

As soon as `research-db` stores the draft report and the immediate auto-verification step completes, the draft should be queryable by the moderation dashboard in `boundary-layer-app`.

In practice that means:

1. the research run finishes for that wind farm
2. the draft report and evidence rows are written
3. source-of-record verification runs immediately
4. the draft lands in the moderation queue with a real status instead of an ambiguous unverified state

### Request timing note

When `OPENROUTER_MODEL=openai/gpt-5.4`, some research runs can look hung even when they are still active. The current OpenRouter endpoint behavior observed in this repo is:

1. HTTP response headers can arrive quickly.
2. The response body may then emit only whitespace keepalive chunks for a long period before the first real JSON payload arrives.
3. The current code buffers the full body before logging anything useful, so the CLI and `research-db` runner stay silent during that period.
4. If the first completed report fails the quality checks, the workflow can issue one full retry request, which increases total runtime again.

Practical implication: do not assume a GPT-5.4 run is dead just because there is no progress output for the first minute. In the current implementation, silence does not distinguish a slow-but-active request from a truly stuck one.

For fields that can drift over time, especially owners, operator, ownership split, and status, the workflow should prioritise sources that show a visible published date or last-updated date. The important freshness signal is the source page's own date, not the date the search was run.

If an official project page is older or undated, use it as background only and confirm the current fact with a newer dated authoritative source such as a current owner portfolio page, investor reporting page, regulator page, or recent company announcement.

For the project `Status` field, the research output should use Boundary Layer's canonical vocabulary:

- `Operational`
- `Decommissioned`
- `Under Construction`
- `Consented`
- `FID Taken, Pre-Construction`
- `In Planning / Consent Application Submitted`
- `Lease Awarded, Pre-Planning`
- `Development Zone / lease area`
- `Concept`
- `Archive`

Use `Archive` when current evidence shows the record should not remain a live standalone project, for example cancelled projects, superseded legacy identities, or duplicates. The report should state the reason clearly in the research summary.

If you want to inspect the exact rendered prompt for debugging, set `PROMPT_TRACE_ENABLED=true`. Each run will save prompt traces under `prompt-traces\<source-table>\`.

Current limitation: the request path does not yet set an explicit OpenRouter timeout, and it waits for the full response body before surfacing progress. If GPT-5.4 remains on the default path, adding timeout and timing logs is the next hardening step.

## Official source hints

For wind farms where ownership changes regularly, search alone is not reliable enough. The repeatable pattern is to add a small official-source hint entry so the prompt is seeded with the current project/JV/operator source before the model begins web research.

The registry currently lives in `src/lib/official-source-hints.js`.

To add support for another wind farm:

1. Find the official project, JV, or operator page that shows the current ownership structure.
2. Add a new `normalizedProjectName` entry to `OFFICIAL_SOURCE_HINTS`.
3. Add one or more `sources` with:
	 - `url`: the official page to fetch
	 - `label`: short description for the prompt
	 - `anchorText`: a phrase near the relevant section when general snippet extraction is enough
	 - `ownershipPartners`: partner names and aliases when the page renders ownership cards or logos with nearby percentages
4. Re-run `npm test`.
5. Re-run `npm run research-db -- --ids <id>` for the affected wind farm.

Example pattern:

```js
{
	normalizedProjectName: 'examplewindfarm',
	sources: [
		{
			label: 'Official Example project ownership page',
			url: 'https://example.com/about',
			anchorText: 'joint venture partnership between',
			ownershipPartners: [
				{ name: 'Example Energy' },
				{ name: 'Partner B' },
				{ name: 'Partner C', aliases: ['Partner C Holdings'] },
			],
		},
	],
}
```

Use `ownershipPartners` when the official page contains partner cards or logos with nearby share percentages. Use `anchorText` when a plain text snippet is enough. If ownership is dynamic, prefer the official project/JV/operator page over individual investor pages.

## Prompt workflow

Your `prompt.md` file remains the source of truth for the research instructions. The CLI replaces `{PROJECT_CONTEXT}` (or the legacy `{WIND_FARM_NAME}` placeholder) before sending the request, so you can keep refining that prompt without changing code.
