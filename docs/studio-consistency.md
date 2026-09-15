# Studio consistency and workspace update

## Database migration

Run `pnpm --filter @picup/api db:deploy` before starting the updated API and worker.
Migration `202609090001_studio_consistency` adds hidden-history timestamps, parent job IDs,
and an append-only consumption ledger. It backfills retained jobs and paid recharge orders
without changing balances. Previously physically deleted records cannot be reconstructed.
Migration `202609090002_studio_library` adds account preferences and independent asset metadata.

History removal now hides the job. It does not cancel processing, release payment orders,
restore daily allowance, or delete media used by later edits. Media retention and permanent
erasure require a separate policy; this change does not introduce automatic garbage collection.

## Processing and billing

- Recharge settlement atomically claims pending orders before applying credits and recording a ledger entry.
- Reservation and refunds use serializable transactions with bounded conflict retries.
- Daily free allowance is read from the ledger, using UTC dates; existing automatic billing remains credits first.
- Worker recovery reconciles persisted queued jobs every 15 seconds and only expires overdue running leases.
- Redis uses atomic FIFO consumption and deduplicates ready entries, including on the older local Redis server.
- Running jobs renew their database and provider leases. Terminal writes are fenced by the database lease owner.
- Database-persisted queued jobs act as a durable outbox if Redis enqueue fails.
- A process crash after an upstream provider has accepted a request can still cause a repeated upstream call unless that provider supports idempotency. Database debit and terminal transitions remain protected.

## Workspace

The route renders the studio feature from `apps/web/src/components/studio`.
The main view now presents image jobs as chat turns with a bottom composer.
It restores the selected job's parent chain (up to 50 turns); this is version history,
not a provider-native text conversation or a separate conversation database entity.
New conversation clears the draft and references without deleting historical jobs.
Uploads use the detected JPEG/PNG/WebP content type even when the declared image MIME differs.
Canvas, history, account, payment, viewer, dialog and draft persistence have separate components.
The workspace uses `?job=...`, `?view=conversations`, `?view=history` (the asset library), and `?view=account`.
Drafts and pending single-payment submissions are scoped to the signed-in user in session storage.
Output reuse copies the selected result into a user-owned input asset on the server and records `parentJobId`.
Successful new jobs prepare their first output for the next edit when automatic continuation is enabled in account preferences.
The current implementation retains per-job history with parent-version navigation; conversation-wide
aggregation and bulk conversation deletion remain the optional second-stage data model in the redesign document.

## Verification

`pnpm typecheck` and `pnpm build` check application compilation.
`pnpm test` runs the unit checks; database and Redis suites require explicit test endpoints:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://postgres:picup-test-only@127.0.0.1:55439/picup_test'
$env:TEST_REDIS_URL = 'redis://127.0.0.1:6379'
pnpm test
```

Use a disposable migrated PostgreSQL database. Redis tests use a random namespace.
Browser checks run with `playwright-cli run-code --filename=scripts/studio-browser-check.js`
after opening a session on the local web server at port 4317. The script mocks API responses,
creates a deterministic bitmap fixture in the browser, and makes no live model or payment calls.
Screenshots are written to `output/playwright/`.
