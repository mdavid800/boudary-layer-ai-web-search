# Test Coverage Plan

This plan turns the remaining test gaps in the web-search repo into concrete `node --test` files and cases.

## Current Baseline

The repo currently has one broad suite:

- `test/workflow.test.js`

That file already covers a useful amount of pure logic across:

- prompt building
- argument parsing
- database config helpers
- OpenRouter report-quality helpers
- report structure and evidence shaping
- operational-refresh merge behavior
- some publish and research runner behavior

The biggest gaps now are:

- top-level workflow branching in `src/research-from-database.js`
- publish and blocked-row-repair behavior in `src/publish-reports.js`
- fetch-level OpenRouter request and retry behavior in `src/lib/openrouter.js`
- query-wrapper behavior in `src/lib/windfarm-database.js`
- black-box CLI and maintenance-script coverage

## Test Strategy

Keep using the built-in `node --test` runner.

Split the current monolithic `test/workflow.test.js` into smaller, file-aligned suites over time. The priority is not just more assertions, but clearer ownership of failures when a workflow branch regresses.

Prefer dependency-injected tests where the production code already supports it:

- `runDatabaseResearch()` already accepts injected collaborators
- `publishDraftReports()` already accepts injected collaborators
- OpenRouter calls can be covered with `fetchImpl` stubs
- database query wrappers can be covered with fake `client.query()` implementations

## Priority 1: Database Research Runner

### Proposed file: `test/research-from-database.test.js`

Source file under test:

- `src/research-from-database.js`

Cases for `parseResearchDatabaseArgs()`:

- Parses comma-separated `--ids` into integers.
- Trims `--country` values.
- Sets `publish`, `forceRefresh`, and `operationalRefresh` flags independently.
- Throws when one of the `--ids` values is not numeric.

Cases for `shouldSkipPublishedOperationalReport()`:

- Returns `true` when a published Operational report exists and `forceRefresh` is false.
- Returns `false` when `forceRefresh` is true.
- Returns `false` when there is no published Operational report state.

Cases for `runDatabaseResearch()`:

- Throws when `--operational-refresh` and `--publish` are used together.
- Throws when `--operational-refresh` and `--force-refresh` are used together.
- Skips wind farms with published Operational reports in default mode.
- Does not skip them when `--force-refresh` is enabled.
- In operational-refresh mode, skips rows without a published Operational report.
- In operational-refresh mode, throws if the published report markdown cannot be loaded.
- Saves a prompt trace when prompt tracing is enabled.
- Uses the `-operational-refresh` prompt-trace suffix in operational-refresh mode.
- Writes the final markdown report to the expected reports directory.
- Stores reports with `reviewStatus = 'published'` when `--publish` is used.
- Stores reports with `reviewStatus = 'draft'` otherwise.
- Merges refresh output into the published markdown only in operational-refresh mode.
- Calls `client.end()` in the `finally` block when any downstream dependency throws.

Notes:

- The implementation already supports collaborator injection, so these should be direct unit tests rather than process-level CLI tests.
- Assert call arguments, skipped counts, and stored payload details, not just that the function completes.

## Priority 2: Draft Publish Workflow

### Proposed file: `test/publish-reports.test.js`

Source file under test:

- `src/publish-reports.js`

Cases:

- Returns early with `draftCount: 0` when no draft reports exist.
- Publishes a report immediately when `verifyReportEvidence()` passes on the first attempt.
- Attempts blocked-row repair when verification fails, blocked rows exist, and `apiKey` is available.
- Does not attempt blocked-row repair when `apiKey` is blank.
- Re-runs verification after a successful repair.
- Continues publishing when saving the repaired markdown to disk fails and only logs a warning.
- Leaves a report unpublished when repair throws.
- Leaves a report unpublished when the post-repair verification still fails.
- Activates draft research facts only for the published report IDs.
- Calls `pruneObsoleteDraftReports()` once per unique published wind farm ID.
- Returns the final `publishedReportIds` and original `draftCount`.

Notes:

- Use a fake client that records SQL calls and parameters in order.
- Include at least one mixed batch where one draft passes and one stays blocked.

## Priority 3: OpenRouter Request and Quality Gate

### Proposed file: `test/openrouter.test.js`

Source file under test:

- `src/lib/openrouter.js`

Cases for report-shape helpers:

- `isCompletedResearchReport()` returns `true` only when both required markdown tables are present.
- `getResearchReportQualityIssues()` flags missing required tables.
- `getResearchReportQualityIssues()` flags invalid provenance appendix mismatches.
- `getResearchReportQualityIssues()` flags missing source-of-record rows.
- `getResearchReportQualityIssues()` flags invalid source links.
- `getResearchReportQualityIssues()` flags blocked-source-domain rows.
- `getResearchReportQualityIssues()` flags risky source-of-record rows.
- `getResearchReportQualityIssues()` flags stale ownership evidence.
- `hasFreshOwnershipEvidence()` accepts recent dated ownership summaries.
- `hasFreshOwnershipEvidence()` also accepts ownership-related recent developments as fallback freshness evidence.
- `hasFreshOwnershipEvidence()` rejects access-date wording as freshness evidence.

Cases for request behavior:

- `requestResearchReport()` returns the first response when the quality gate passes immediately.
- `requestResearchReport()` performs exactly one retry when the first response fails quality checks.
- The retry request appends corrective notes for freshness, risky-source, blocked-domain, and verifier-friendly evidence issues.
- `requestResearchReport()` throws an incomplete-report error when the retry still fails quality checks.
- `requestBlockedRowRepair()` follows the same one-retry quality-gate behavior.
- The server-tool request payload includes `excluded_domains` for non-Firecrawl engines.
- The server-tool request payload omits `excluded_domains` for `firecrawl`.
- Non-2xx responses are surfaced through `buildOpenRouterError()`.
- Empty assistant content throws `OpenRouter returned no assistant content.`

Cases for payload parsing helpers:

- `extractTextContent()` handles string content.
- `extractTextContent()` handles content arrays with `text` and `output_text` parts.
- `extractTextContent()` handles `output_text` payloads.
- `extractTextContent()` handles `output[].content[]` payloads.
- `buildOpenRouterError()` prefers parsed error messages over raw body fallbacks.

Notes:

- This is the highest-risk pure-logic module because it controls retry behavior, blocked domains, and the silent slow-response path documented in the repo.

## Priority 4: Database Query Wrappers and Runtime Config

### Proposed file: `test/windfarm-database.test.js`

Source file under test:

- `src/lib/windfarm-database.js`

Cases:

- `getWindFarmSourceTableName()` defaults to `core_wind_farms`.
- `getWindFarmSourceTableName()` rejects unsupported table names.
- `getWindFarmReportsDirectory()` resolves the configured base path from `process.cwd()`.
- `listWindFarmRows()` applies the active-record and non-null-name filters.
- `listWindFarmRows()` adds the ID filter when `ids` are supplied.
- `listWindFarmRows()` adds the case-insensitive country filter when `country` is supplied.
- `getPublishedResearchRunState()` returns an empty `Map` without querying when the input list is empty.
- `getPublishedResearchRunState()` maps query rows into the expected boolean state shape.
- `getLinkedTurbineMetadata()` returns the first row when metadata exists.
- `getLinkedTurbineMetadata()` returns `null` when there is no linked turbine data.
- `getTurbineCountValidationContext()` prioritizes `community` over `eurowindwakes` over `emodnet` for the winning fact.
- `getTurbineCountValidationContext()` returns `communitySummary = null` when there are no approved notes.

### Proposed file: `test/database-and-runtime-config.test.js`

Source files under test:

- `src/lib/database.js`
- `src/lib/runtime-config.js`

Cases:

- `buildDatabaseConnectionString()` rejects missing `DATABASE_URL`.
- `buildDatabaseConnectionString()` appends `sslmode=no-verify`.
- `createDatabaseClient()` sets `rejectUnauthorized: false`.
- `requireValue()` trims and returns non-empty values.
- `requireValue()` throws on empty values.
- `getPositiveInteger()` returns the fallback when the env var is unset.
- `getPositiveInteger()` throws for zero, negatives, and non-numeric input.

## Priority 5: CLI and Maintenance Scripts

### Proposed file: `test/cli.test.js`

Source file under test:

- `src/cli.js`

Cases:

- `--help` prints usage text and exits without calling OpenRouter.
- A provided wind farm name bypasses the interactive prompt.
- An empty interactive answer fails with `A wind farm name is required.`
- `--output` saves the generated markdown file.
- `--model` and `--engine` override the default runtime config passed to `requestResearchReport()`.

Notes:

- Treat this as a black-box process test using `execFileSync` or `spawnSync`.
- Keep mocking and env setup narrow so failures still point to CLI wiring.

### Proposed file: `test/backfill-status-terminology.test.js`

Source file under test:

- `src/backfill-status-terminology.js`

Cases:

- Status aliases map to the expected canonical values.
- Markdown status rows are rewritten only when the source status is an alias.
- Already-canonical status rows are left unchanged.
- Non-status markdown tables are left unchanged.
- The updater issues replacement queries only for configured alias groups.

Notes:

- This file currently mixes CLI execution and helper logic. If direct unit coverage is awkward, extract the pure helpers into `src/lib/status-backfill.js` first and test that module directly.

## Optional Integration Layer

### Proposed file: `test/integration/database-workflow.test.js`

Purpose:

- Validate the database-backed research and publish workflow with a disposable Postgres database and no live OpenRouter dependency.

Cases:

- `runDatabaseResearch()` stores one draft report and related facts for a seeded wind farm.
- `publishDraftReports()` publishes only the reports whose evidence rows verify cleanly.
- Repair flow updates the stored markdown and re-verifies blocked rows before publish.

Prerequisites:

- Disposable Postgres database with the current research tables
- Small seeded fixtures only
- Stubbed OpenRouter fetch or injected fake report generator

## Recommended Execution Order

1. Add `test/research-from-database.test.js` first because it covers the main production runner and already supports collaborator injection.
2. Add `test/publish-reports.test.js` second because publish and repair behavior is high-risk and expensive to debug late.
3. Add `test/openrouter.test.js` third because retry behavior, blocked domains, and quality gating are core safety logic.
4. Add query-wrapper and runtime-config tests next to stabilize database and env assumptions.
5. Add black-box CLI and maintenance-script tests after the core pure-logic layer is split out.

## Exit Criteria

This plan is complete when the repo has:

- Direct coverage for the branching behavior in `research-from-database.js`
- Direct coverage for repair and publish behavior in `publish-reports.js`
- Explicit fetch-level coverage for the OpenRouter quality gate and retry path
- Query-wrapper coverage for `windfarm-database.js`
- At least one black-box CLI test and one maintenance-script test# Test Coverage Plan

This plan turns the current web-search-repo coverage gaps into concrete `node --test` files and cases.

## Current Baseline

The repo currently has one broad test file:

- `test/workflow.test.js`

That file already covers a useful amount of pure logic across prompt building, status normalization, report parsing, evidence helpers, and some workflow helpers.

The biggest remaining gaps are:

- executable workflow branches in `src/research-from-database.js`
- publish/repair behavior in `src/publish-reports.js`
- OpenRouter request, retry, and error parsing branches in `src/lib/openrouter.js`
- database query wrapper behavior in `src/lib/windfarm-database.js` and `src/lib/database.js`
- top-level maintenance scripts that still mutate data but have little or no direct coverage

## Test Strategy

Keep using the existing `node --test` runner and split the current monolithic `workflow.test.js` into focused files over time.

Use the dependency injection that already exists in `runDatabaseResearch()` and `publishDraftReports()` to avoid network and database dependencies in the default test suite.

Prefer three layers:

- pure unit tests for helpers and query builders
- orchestration tests with fake clients and fake fetch implementations
- optional database integration tests only if the repo later adds a disposable Postgres fixture

## Priority 1: Database Research Runner

### Proposed file: `test/research-from-database.test.js`

Primary source file under test:

- `src/research-from-database.js`

Cases for `parseResearchDatabaseArgs`:

- Parses comma-separated `--ids` into integers.
- Trims `--country` input.
- Sets `publish`, `forceRefresh`, and `operationalRefresh` flags correctly.
- Throws when `--ids` contains a non-numeric value.

Cases for `shouldSkipPublishedOperationalReport`:

- Returns `false` when `forceRefresh` is enabled.
- Returns `true` when a published Operational report already exists and force refresh is off.
- Returns `false` when no operational published report exists.

Cases for `runDatabaseResearch`:

- Throws when `--operational-refresh` and `--publish` are combined.
- Throws when `--operational-refresh` and `--force-refresh` are combined.
- Loads the operational-refresh prompt template when `--operational-refresh` is set.
- Uses `draft` review status by default and `published` when `--publish` is passed.
- Skips rows with published Operational reports in default mode.
- Skips rows without published Operational reports in operational-refresh mode.
- Throws when operational refresh requires a published report but none can be loaded.
- Builds and saves prompt traces when `PROMPT_TRACE_ENABLED` is enabled.
- Saves the rendered markdown report to the expected per-wind-farm output path.
- Calls `storeResearchReport()` with the final merged report in operational-refresh mode.
- Always calls `client.end()` in the `finally` block.

Notes:

- Mock the OpenRouter request function, prompt loader, report store, and database helpers through the injected function parameters.
- Add one explicit assertion that the stored `reviewStatus` matches the mode under test.

## Priority 2: Draft Publish and Repair Workflow

### Proposed file: `test/publish-reports.test.js`

Primary source file under test:

- `src/publish-reports.js`

Cases:

- Returns early with zero counts when there are no draft reports.
- Publishes reports immediately when verification passes on the first attempt.
- Attempts blocked-row repair when verification fails and blocked rows exist and an API key is present.
- Re-runs verification after a successful repair.
- Leaves a report blocked when repair throws.
- Leaves a report blocked when repaired markdown still fails verification.
- Updates `research_wind_farm_reports` to `published` only for publishable draft ids.
- Activates research facts only for the published report ids.
- Calls `pruneObsoleteDraftReports()` once per unique published wind farm id.
- Saves repaired markdown to disk and tolerates `saveReport()` failures with a warning.
- Returns the final `publishedReportIds` and `draftCount` summary.

Notes:

- Use a fake client that returns queued query results for the draft lookup, publish update, fact activation, and summary query.
- Add one explicit test proving that repair is skipped when there is no OpenRouter API key.

## Priority 3: OpenRouter Request and Quality Gate Coverage

### Proposed file: `test/openrouter.request.test.js`

Primary source file under test:

- `src/lib/openrouter.js`

Cases for `requestResearchReport`:

- Returns the initial report when quality checks pass on the first response.
- Performs exactly one retry when the initial response fails quality checks.
- Throws the incomplete-report error when the retry still fails quality checks.
- Adds freshness/accessibility/domain retry notes according to the failing quality-issue set.

Cases for `requestBlockedRowRepair`:

- Builds the repair prompt from the blocked rows.
- Returns repaired markdown when the repaired report passes quality checks.
- Throws when the repaired report still fails quality checks.

Cases for request parsing and errors:

- Sends the `openrouter:web_search` tool payload with engine and result-limit parameters.
- Excludes blocked domains for non-Firecrawl engines.
- Omits `excluded_domains` for Firecrawl.
- Surfaces `OpenRouter request failed (<status>): ...` when the HTTP response is non-OK.
- Throws `OpenRouter returned no assistant content.` when the response body lacks usable content.

Notes:

- Use a fake `fetchImpl` and assert the serialized request body.
- Add one explicit test for array-form assistant content so `extractTextContent()` stays stable across payload shapes.

### Proposed file: `test/openrouter.quality.test.js`

Primary source file under test:

- `src/lib/openrouter.js`

Cases:

- `isCompletedResearchReport()` rejects non-strings and incomplete reports.
- `getResearchReportQualityIssues()` flags missing required tables.
- Flags invalid provenance appendix mismatches.
- Flags missing source-of-record rows.
- Flags invalid source links.
- Flags blocked source domains.
- Flags risky source-of-record domains.
- Flags missing recent developments.
- Flags stale ownership evidence when ownership rows lack recent dated support.
- `hasFreshOwnershipEvidence()` accepts either dated ownership summaries or a qualifying recent development row.
- Treats access-date phrasing like `as accessed 2026` as non-fresh evidence.

Notes:

- Keep the fixture markdown compact and deterministic.
- Reuse the freshness behavior already documented in repo memory and README.

## Priority 4: Database and Runtime Helper Coverage

### Proposed file: `test/windfarm-database.test.js`

Primary source file under test:

- `src/lib/windfarm-database.js`

Cases for `getWindFarmSourceTableName`:

- Returns `core_wind_farms` by default.
- Accepts `core_wind_farms` explicitly.
- Rejects unsupported source table names.

Cases for `getWindFarmReportsDirectory`:

- Resolves the configured path relative to `process.cwd()`.
- Falls back to `reports` when the env var is empty.

Cases for `listWindFarmRows`:

- Includes the active-record and non-null-name filters.
- Adds an `id = ANY($n)` condition when ids are provided.
- Adds a case-insensitive country filter when country is provided.
- Returns query rows unchanged.

Cases for `getPublishedResearchRunState`:

- Returns an empty map for an empty input array.
- Throws when `windFarmIds` is not an array.
- Maps query rows into `hasPublishedReport` and `hasOperationalPublishedReport` booleans.

Cases for `getLinkedTurbineMetadata`:

- Returns the first query row.
- Returns `null` when no rows are found.

Cases for `getTurbineCountValidationContext`:

- Prefers community over EuroWindWakes over EMODnet for the winning fact.
- Returns a populated community summary when approved notes exist.
- Returns `null` community summary when approved-note count is zero.

### Proposed file: `test/runtime-config-and-database.test.js`

Primary source files under test:

- `src/lib/runtime-config.js`
- `src/lib/database.js`

Cases:

- `requireValue()` trims and returns non-empty values.
- `requireValue()` throws the custom or default missing-value message.
- `getPositiveInteger()` returns the fallback for empty input.
- `getPositiveInteger()` accepts valid positive integers.
- `getPositiveInteger()` rejects zero, negatives, and non-integers.
- `buildDatabaseConnectionString()` injects `sslmode=no-verify`.
- `buildDatabaseConnectionString()` throws when `DATABASE_URL` is missing.
- `createDatabaseClient()` passes the normalized connection string and `rejectUnauthorized: false`.

## Priority 5: Maintenance Scripts and Storage Helpers

### Proposed file: `test/report-storage-and-output.test.js`

Primary source files under test:

- `src/lib/report-storage.js`
- `src/lib/report-output.js`

Cases:

- Output-path helpers slugify names consistently.
- Prompt trace directory logic respects `PROMPT_TRACE_ENABLED` and configured output dirs.
- Report save helpers create parent directories and persist content.
- Draft-pruning helpers delete only obsolete draft rows for the targeted wind farm.
- Latest-published-report lookup prefers the most recent published report.

### Proposed file: `test/backfill-status-terminology.test.js`

Primary source file under test:

- `src/backfill-status-terminology.js`

Cases:

- Builds the alias-to-canonical status map correctly.
- Replaces only the `| Status |` row in markdown tables.
- Leaves markdown unchanged when the status row is already canonical.
- Updates status columns across the configured table list using alias matches.
- Updates research fact status values only for active or draft research facts.
- Updates community note proposed values only for status notes.

Notes:

- This is lower priority than the research and publish workflows, but it is still a mutation-heavy script and should not remain effectively untested.

## Optional Integration Layer

### Proposed file: `test/integration/research-db.postgres.test.js`

Purpose:

- Add one disposable-Postgres integration test once the repo has a stable local fixture strategy.

Cases:

- `runDatabaseResearch()` reads from `core_wind_farms`, stores a draft report, and writes research facts.
- `publishDraftReports()` publishes only verified drafts and activates their facts.
- Operational refresh loads the latest published report and stores a merged draft.

Notes:

- Keep OpenRouter mocked even in integration tests; the goal is DB contract confidence, not network coverage.

## Recommended Execution Order

1. Add `test/research-from-database.test.js` first because `research-db` is the repo’s main production workflow.
2. Add `test/publish-reports.test.js` second because failed evidence repair and partial publish behavior are high-risk.
3. Split out OpenRouter request and quality tests next to pin retry behavior and payload handling.
4. Add database/runtime helper tests after the workflow surfaces are covered.
5. Add maintenance-script coverage after the main workflow is stable.

## Exit Criteria

This plan is complete when the repo has:

- direct coverage for `runDatabaseResearch()` mode selection, skip logic, prompt tracing, and report storage
- direct coverage for `publishDraftReports()` publish, repair, and block paths
- direct coverage for OpenRouter request construction, retry behavior, and quality-gate diagnostics
- direct coverage for `windfarm-database.js` query-wrapper behavior and `runtime-config.js` validation helpers
- at least one targeted test for the status-backfill maintenance script