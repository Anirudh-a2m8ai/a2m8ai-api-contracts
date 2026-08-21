# API Contracts

Contracts between the **college LMS backend** (NestJS + Prisma) and the services it calls — starting with the **AI service** that powers the AI-assisted course builder.

**OpenAPI 3.1 is the source of truth.** One spec per provider service.

```
ai-service/openapi.yaml      ← the contract
redocly.yaml                 ← lint rules + doc theme
build/inline-docs.mjs        ← makes the built HTML self-contained
build/pull-spec.mjs          ← pulls edits made in the hosted app back into the repo
docs/ai-service.html         ← generated, committed, openable offline
dist/ai-service.openapi.json ← generated bundle for codegen/tooling
web/                         ← the hosted, commentable reference (Vercel)
```

There are two ways to read this contract, and they are for different things.

| | For | Editable |
|---|---|---|
| `docs/ai-service.html` | Attaching to a ticket, reading on a plane. One file, no network. | No |
| [`web/`](web/) on Vercel | Review. Comment on a specific response code, propose a change, approve one. | Yes — see below |

## Commands

```bash
npm install
```

```bash
npm run build
```

`build` = lint → HTML reference → bundled JSON. Individually:

| Script | Does |
|---|---|
| `npm run lint` | Validate against the rules in `redocly.yaml`. Run before committing. |
| `npm run docs` | Build `docs/ai-service.html`, then inline Redoc so it works offline. |
| `npm run preview` | Live-reloading local preview while editing the spec. |
| `npm run bundle` | Emit `dist/ai-service.openapi.json` — a single-file spec for codegen. |
| `npm run web` | Run the hosted reference locally on <http://localhost:3000>. |
| `npm run pull` | Fetch the contract back from the deployment into `ai-service/openapi.yaml`. |

The HTML reference is committed, so anyone can open `docs/ai-service.html` directly from a checkout with no build and no internet.

### Why the inline step

`redocly build-docs` produces HTML that loads Redoc from a CDN and fonts from Google. That doc only renders online — useless attached to a ticket or opened on a locked-down network. `build/inline-docs.mjs` inlines the Redoc bundle once, strips the font link, and **exits non-zero if any external reference survives**, so the build fails loudly rather than silently shipping a doc that needs the network.

It needs Redoc's bundle, which is not a declared dependency (it is only used to vendor one file):

```bash
npm install --no-save redoc@2.5.3
```

## Related repos

| Path | Role |
|---|---|
| `../college-lms-backend` | NestJS + Prisma. The consumer. Prisma models in `prisma/models/*.prisma`. |
| `../college-lms-frontend` | React client rendering the course builder screens. |
| `../design` | UI mockups. Screens referenced by design id (`1a`, `1b`, `1c`, …). |

Contracts are written **against the existing Prisma schema and DTOs**. Before adding an operation, read the relevant `prisma/models/*.prisma` and `src/api/<module>/dto/*` — where an endpoint already accepts a compatible shape, mirror its field names exactly so no translation layer is needed. Where the schema is missing something the design requires, record it under `x-dependencies` rather than inventing a field silently.

## The hosted reference

`web/` is a Next.js app that renders this contract with a comment pin on every addressable part of
it — the overview, each tag, each operation, each parameter, each response, each schema property —
and an editor with a live preview.

**Only one GitHub account can change the contract.** Set `OWNER_GITHUB_LOGIN` to that account and
it is the only one that sees Publish, or the Approve and Reject buttons on an edit request. That is
enforced in every write route, not by hiding controls.

Everyone else signs in with GitHub and gets two ways to ask for a change:

- **Comment on a specific part.** This is what the AI-service team uses day to day. The anchor
  lands in the URL, so `?anchor=op:post /api/v1/…#responses.422` can be pasted into chat and the
  recipient opens on that exact thread.
- **Open an edit request.** They edit the YAML in the same editor and submit. Nothing is published.
  The owner reviews a diff, and approving is what makes it the contract.

Every published state is kept. Approving inserts a version rather than overwriting one, so History
shows what changed, who approved it, and which edit request it came from — and any version can be
restored.

Setup, environment variables and the local dev loop are in [`web/README.md`](web/README.md).

### Keeping the repo authoritative

The deployment's database becomes the live copy the moment anyone edits in the browser. Pull it
back so this repo stays the source of truth for codegen and the offline HTML:

```bash
CONTRACTS_URL=https://<your-app>.vercel.app npm run pull && npm run build
```

Then commit `ai-service/openapi.yaml` and the regenerated `docs/`. Worth doing whenever an edit
request is approved.

## Conventions

### Versioning

Path prefix: `/api/v1/...`. Breaking changes ship under a new `/api/v{n}/` prefix so two versions can run side by side during a migration. Additive, optional fields do not bump the version.

### Standard headers

| Header | Applies to | Purpose |
|---|---|---|
| `x-api-key` | all | Server-to-server secret. Held by the LMS backend, never exposed to the browser. Mirrors the existing `ApiKeyGuard` (`src/common/guards/api.guard.ts`). |
| `x-tenant-id` | all | Multi-tenant isolation and quota scoping. |
| `x-request-id` | all | Correlation id, echoed into provider logs and back on the response. |
| `Idempotency-Key` | job-creating POSTs | A repeat with the same key returns the existing job rather than starting a second, billable one. |

Resources belonging to another tenant resolve as **404, never 403** — otherwise ids can be probed.

### Response envelopes

Success:

```json
{ "status": "success", "statusCode": 200, "data": { }, "timestamp": "2026-08-18T10:30:00.000Z" }
```

Failure — mirrors `src/common/filters/global-exception.filter.ts`, with `errorCode` added so consumers branch on a stable code instead of matching message strings:

```json
{
  "status": "failed",
  "statusCode": 422,
  "error": "ApplicationError",
  "errorCode": "DOCUMENT_NOT_PROCESSED",
  "message": "Legacy-Notes.epub has not finished parsing.",
  "details": { },
  "timestamp": "2026-08-18T10:30:00.000Z"
}
```

`message` must always be safe to render directly in the UI.

Envelopes are modelled as `SuccessEnvelope` + `allOf`, so each operation only declares its own `data` shape.

### Long-running operations

Anything that can exceed ~10 s is a job, not a blocking request:

1. `POST .../generate` → `202` with `{ jobId, status: "QUEUED", estimatedSeconds, pollUrl, pollAfterMs, expiresAt }`
2. `GET .../jobs/{jobId}` → `200` with `{ status, progress, result, error }`
3. `POST .../jobs/{jobId}/cancel` → `200`

Rules:

- Job states are `QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED`.
- The poll endpoint returns **200 even for `FAILED`** — the transport succeeded, the job did not. The failure rides in `data.error` using the same `errorCode`/`message`/`details` shape, so consumers keep one error-handling path.
- Consumers honour the server's `pollAfterMs` rather than a hardcoded interval, so the provider can shed load without a client change.
- Terminal jobs are retained for 1 hour, then `404 JOB_NOT_FOUND`.

### Dates and ids

ISO-8601 with milliseconds in UTC (`2026-08-18T10:30:00.000Z`); ids are uuid v4.

## Custom extensions

Standard OpenAPI has no place for design traceability or "this needs a migration first", so those live in `x-` extensions. They survive linting, bundling and codegen untouched, and Redoc ignores them.

| Extension | Where | Holds |
|---|---|---|
| `x-design-refs` | operation | Which design screens the operation serves, and what each contributes. Written as `{screen, title, usedFor}`. |
| `x-dependencies` | root | Work the contract presumes but does not deliver — missing Prisma columns, DTO changes, contracts not yet designed. Each flagged `blocking: true/false`. |
| `x-consumer` | `info` | Which service calls this one. |
| `x-status` | `info` | `DRAFT` → `IMPLEMENTED` → `DEPRECATED`. |
| `x-timeout-ms` | operation | Client timeout the consumer should set. |
| `x-constraint` | schema | Rules JSON Schema can't express (e.g. `max >= min`). |

Schema descriptions should trace back to the design where they can — *"rendered as the grey subtitle on the TOPIC row in 1c"* is more useful to an implementer than *"the topic description"*.

## Adding a contract

Not the owner? Don't edit these files — open an edit request in the hosted app instead, or comment
on the part you need changed. The steps below are for whoever holds `OWNER_GITHUB_LOGIN`.

1. If it belongs to an existing provider, add paths and schemas to that provider's `openapi.yaml`. A new provider gets its own directory and spec, registered under `apis:` in `redocly.yaml`.
2. Give every operation an `operationId`, `summary`, `description`, `tags`, at least one 4xx, and `x-design-refs`. The lint rules enforce all of these.
3. Reuse `SuccessEnvelope`, `ErrorResponse`, `ErrorCode` and the shared `components/responses` rather than redefining error shapes.
4. Record anything the LMS side must change first under `x-dependencies`.
5. `npm run build`, then commit the regenerated `docs/`.

## History

The first contract was drafted in a bespoke JSON format at `ai-service/course-creation/generateOutline.json`. It has been fully migrated into `ai-service/openapi.yaml` — including its design refs, dependency notes and examples — and is retained only for reference. It is **not** maintained; edit the OpenAPI spec instead.
