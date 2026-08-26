# API Contracts

Contracts between the **college LMS backend** (NestJS + Prisma) and the services it calls — starting with the **AI service** that powers the AI-assisted course builder.

**OpenAPI 3.1 is the source of truth.** One spec per domain — currently **course-outline** and
**content-generation**, both backing the AI service. A domain that grows into something with its
own team, backend or release cycle becomes a new spec the same way; a domain does not need to be a
whole separate provider to earn its own root document.

```
course-outline/
  openapi.yaml               ← the root document: info, servers, tags, $ref index
  paths/<slug>.yaml          ← one file per endpoint
  components/
    parameters/<Name>.yaml   ← domain-owned; most parameters live in shared/ instead
    headers/<Name>.yaml
    responses/<Name>.yaml
    securitySchemes/<Name>.yaml
    schemas/<Name>.yaml      ← one domain per spec now, so no common/outline/content split here

content-generation/          ← same shape as course-outline/
  openapi.yaml
  paths/<slug>.yaml
  components/...

shared/
  components/
    schemas/<Name>.yaml      ← reachable from more than one spec (envelopes, error shapes, ids, ...)
    responses/<Name>.yaml    ← standard 4xx/5xx shapes reused by every spec
    parameters/<Name>.yaml   ← x-tenant-id, x-request-id, Idempotency-Key, jobId
    headers/<Name>.yaml
    securitySchemes/<Name>.yaml   ← ApiKeyAuth

redocly.yaml                       ← lint rules + doc theme, one `apis:` entry per spec
build/shared-components.json       ← which component names live in shared/, not a spec's own dir
build/split-spec.mjs                ← explodes one spec's bundle back into its layout above
build/inline-docs.mjs               ← makes the built HTML self-contained
build/pull-spec.mjs                  ← pulls edits made in the hosted app back into the repo, per spec
build/write-docs-index.mjs           ← writes docs/index.html linking every spec's HTML doc
docs/index.html                      ← generated, links to each spec's HTML doc
docs/course-outline.html             ← generated, committed, openable offline
docs/content-generation.html         ← generated, committed, openable offline
dist/<slug>.openapi.{json,yaml}      ← generated bundle per spec; the hosted app's seed
web/                                  ← the hosted, commentable reference (Vercel)
```

### Why it is split, and where the single file still exists

One file per endpoint and per schema means a change to one operation is a diff in one
file — reviewable, and it does not collide with an unrelated edit somewhere else in the
document.

Two consumers still need each spec as **one** document: browsers cannot follow a
`$ref` into another file, and codegen tools generally will not either. So `npm run bundle`
resolves every `$ref` back into `dist/<slug>.openapi.{json,yaml}` per spec, and the hosted app
is seeded from those YAML bundles rather than from the split sources.

That means the split is invisible in the browser: each team still reads and edits one
document per spec. What changed is the **git** side — when an approved edit is pulled back,
`npm run pull` re-splits it, so the commit touches only the files that actually changed.
The split is idempotent, so re-running it never produces spurious churn.

Which components are shared is a small, hand-maintained manifest
(`build/shared-components.json`), not something recomputed on every split — see it once, when a
schema genuinely becomes (or stops being) cross-spec, rather than a fact `split-spec.mjs` has to
re-derive by comparing every spec's bundle on every run. `shared/` itself is written once and never
touched by `split-spec.mjs` afterwards, so splitting one spec right after another can never clobber
what the other just wrote there.

There are two ways to read a contract, and they are for different things.

| | For | Editable |
|---|---|---|
| `docs/<slug>.html` (start at `docs/index.html`) | Attaching to a ticket, reading on a plane. One file per spec, no network. | No |
| [`web/`](web/) on Vercel | Review. Comment on a specific response code, propose a change, approve one. | Yes — see below |

## Commands

```bash
npm install
```

```bash
npm run build
```

`build` = lint → bundle every spec → refresh the app's seed → HTML reference for every spec.
Individually:

| Script | Does |
|---|---|
| `npm run lint` | Validate every spec in `redocly.yaml`'s `apis:` map. Run before committing. |
| `npm run docs` | Build every spec's HTML doc plus `docs/index.html`, then inline Redoc so each works offline. |
| `npm run preview` | Live-reloading local preview of `course-outline` while editing the spec. |
| `npm run bundle` | Resolve every `$ref` into `dist/<slug>.openapi.{json,yaml}`, per spec. |
| `npm run split` | Re-explode each `dist/<slug>.openapi.yaml` over its split sources. |
| `npm run seed` | Bundle every spec, then refresh the hosted app's embedded copy of each contract. |
| `npm run web` | Bundle every spec, then run the hosted reference on <http://localhost:3000>. |
| `npm run pull` | Fetch every spec back from the deployment and re-split it, continuing past any one spec's failure. |

The HTML reference is committed, so anyone can open `docs/index.html` directly from a checkout with no build and no internet.

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

`web/` is a Next.js app that renders every spec with a comment pin on every addressable part of
it — the overview, each tag, each operation, each parameter, each response, each schema property —
and an editor with a live preview. The landing page lists the specs it hosts; each one gets its own
reference, editor, edit-request queue and version history at `/<slug>`.

**Only one GitHub account can change any contract.** Set `OWNER_GITHUB_LOGIN` to that account and
it is the only one that sees Publish, or the Approve and Reject buttons on an edit request, across
every spec. That is enforced in every write route, not by hiding controls — one team, one owner,
multiple specs, not a multi-tenant system with separate owners per spec.

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

Then commit the changed spec directories, `shared/` if it moved, and the regenerated `docs/`. Worth
doing whenever an edit request is approved.

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
{
  "statusCode": 200,
  "code": "LMS200",
  "success": true,
  "message": "Operation completed successfully",
  "data": { },
  "meta": null,
  "error": null
}
```

Failure — mirrors `src/common/filters/global-exception.filter.ts`:

```json
{
  "statusCode": 422,
  "code": "LMS422",
  "success": false,
  "message": "The request is well-formed but the source material cannot be used.",
  "data": null,
  "meta": null,
  "error": {
    "name": "DOCUMENT_NOT_PROCESSED",
    "details": "Legacy-Notes.epub has not finished parsing."
  }
}
```

`code` is always `LMS` followed by `statusCode` (`LMS422` for every 422, regardless of which
`error.name` fired) — not an independent value. Branch on `error.name` (the old top-level
`errorCode`, relocated), not on `message` text: `message` is generic across every occurrence of a
given `error.name`, while `error.details` is specific to this one. `error.fieldErrors`
(`field`/`message` pairs) is present only for request-validation failures — e.g. `INVALID_REQUEST`
or `MISSING_REQUIRED_FIELD` — and absent otherwise, as above. `message` and
`error.details` are both always safe to render directly in the UI. `meta` is reserved (pagination,
warnings, ...) and always `null` today.

Envelopes are modelled as `SuccessEnvelope`/`ErrorResponse` + `allOf`, so each operation only
declares its own `data` shape; the nested `error` object (`ErrorDetail`) is shared by both a
transport-level failure and a terminal job's `data.error` — see "Long-running operations" below.

### Long-running operations

Anything that can exceed ~10 s is a job, not a blocking request:

1. `POST .../generate` → `202` with `{ jobId, status: "QUEUED", estimatedSeconds, pollUrl, pollAfterMs, expiresAt }`
2. `GET .../jobs/{jobId}` → `200` with `{ status, progress, result, error }`
3. `POST .../jobs/{jobId}/cancel` → `200`

Rules:

- Job states are `QUEUED | RUNNING | SUCCEEDED | FAILED | CANCELLED`.
- The poll endpoint returns **200 even for `FAILED`** — the transport succeeded, the job did not. The failure rides in `data.error` using the same `ErrorDetail` shape (`name`/`details`/`fieldErrors`) as a transport-level error's `error` object, so consumers keep one error-handling path.
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

### Cross-cutting / not yet owned

Work that doesn't belong to any current spec's `x-dependencies` — because it spans more than one, or
because it belongs to a domain that hasn't been designed yet — lives here instead of being silently
dropped or misfiled under a spec that doesn't actually own it:

- **Assignment generation** (screens 1m → 1j / 1i) is its own future contract, not part of
  `course-outline` or `content-generation`. The Assignment Prisma model currently requires
  `classRoomId`, `startDate` and `dueDate`, none of which exist at outline time.

## Adding a contract

Not the owner? Don't edit these files — open an edit request in the hosted app instead, or comment
on the part you need changed. The steps below are for whoever holds `OWNER_GITHUB_LOGIN`.

1. If it belongs to an existing spec, add a file under that spec's `paths/`, add any new schemas under `components/schemas/`, and register both in the root `openapi.yaml` `$ref` index. A genuinely new domain gets its own directory and root document, registered under `apis:` in `redocly.yaml` — same pattern as `course-outline/` and `content-generation/` today. Reuse `shared/` for anything more than one spec needs, adding its name to `build/shared-components.json`.
2. Give every operation an `operationId`, `summary`, `description`, `tags`, at least one 4xx, and `x-design-refs`. The lint rules enforce all of these.
3. Reuse `SuccessEnvelope`, `ErrorResponse`, `ErrorCode` and the shared `components/responses` rather than redefining error shapes.
4. Record anything the LMS side must change first under `x-dependencies`, or under "Cross-cutting / not yet owned" above if it doesn't belong to one spec.
5. `npm run build`, then commit the regenerated `docs/` and `web/src/generated/`.
6. Adding a whole new spec also means adding a row to `SPEC_REGISTRY` in `web/src/lib/specs-registry.ts`, so the hosted app knows to seed and serve it.

## History

The first contract was drafted in a bespoke JSON format. It was fully migrated into a single
combined `ai-service/openapi.yaml` — including its design refs, dependency notes and examples — and
the original file has since been removed. That combined document was later split by domain into
`course-outline/openapi.yaml` and `content-generation/openapi.yaml`, each independently versioned;
`ai-service/` no longer exists. Each spec's own root document (and its split sources, plus anything
in `shared/`) is the source of truth for that domain.
