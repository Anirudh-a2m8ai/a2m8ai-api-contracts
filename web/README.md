# Hosted contract reference

The browsable, commentable version of `ai-service/openapi.yaml`, deployed to Vercel.

Read it without an account. Sign in with GitHub to comment on any part of it or to propose a
change. **Only the GitHub account named in `OWNER_GITHUB_LOGIN` can change the contract**, and that
is enforced on the server, not by hiding buttons.

## Who can do what

| | read | comment | propose an edit | change the contract |
|---|---|---|---|---|
| Not signed in | ✅ | — | — | — |
| Signed in with GitHub | ✅ | ✅ | ✅ | — |
| `OWNER_GITHUB_LOGIN` | ✅ | ✅ | ✅ | ✅ |

Every write re-checks the role server-side (`src/lib/auth.ts`). A signed-in contributor who
hand-crafts a `PUT /api/spec` gets a 403; the editor page is open to everyone on purpose, because a
diff is a far better bug report than a paragraph describing one.

## Deploying

The OAuth callback has to name the deployment's own domain, which you do not know until the first
deploy — so deploy first with no configuration, then fill it in. Nothing here is read at build time,
so that first deploy succeeds and simply shows the contract read-only.

1. Push this repo to GitHub.
2. In Vercel, **Add New → Project**, import the repo, and set **Root Directory** to `web`.
   Framework, build and install commands are all detected. Deploy.
3. Note the domain Vercel gives you, e.g. `https://api-contracts-xyz.vercel.app`.
4. Register a GitHub OAuth app at <https://github.com/settings/developers>:
   - Homepage URL — `https://<your-app>.vercel.app`
   - Authorization callback URL — `https://<your-app>.vercel.app/api/auth/callback`

   This must be a *separate* app from any you use locally: an OAuth app accepts exactly one
   callback URL.
5. **Storage → Create Database → Postgres**, attached to the project — or paste an existing Neon
   connection string as `DATABASE_URL`. Use a different database from the one you develop against,
   so local experiments cannot land in the published history.
6. Add the environment variables below, for Production, Preview and Development.
7. **Redeploy.** Environment variables are baked into a deployment; the existing one will not pick
   them up.

### Environment variables

| Variable | Value | Set by |
|---|---|---|
| `OWNER_GITHUB_LOGIN` | your GitHub username | you |
| `GITHUB_CLIENT_ID` | from the OAuth app | you |
| `GITHUB_CLIENT_SECRET` | from the OAuth app | you |
| `SESSION_SECRET` | a fresh 32-byte random hex string, **not** the local one | you |
| `APP_URL` | `https://<your-app>.vercel.app`, no trailing slash | you |
| `POSTGRES_URL` | connection string | Vercel Storage, automatically |
| `DATABASE_URL` | connection string | you, only if bringing your own Neon |

`POSTGRES_URL` and `DATABASE_URL` are interchangeable — set whichever your database gives you, not
both. Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`APP_URL` pins the OAuth `redirect_uri`. A GitHub OAuth app accepts exactly one callback URL and
every preview deployment gets its own hostname, so without it sign-in works on production and fails
on previews. With it, previews redirect back to production to complete sign-in.

### About the Root Directory setting

Vercel offers **"Include source files outside of the Root Directory in the Build Step"** alongside
the Root Directory. This project builds either way: `src/generated/seed-spec.ts` is committed, and
`scripts/embed-spec.mjs` falls back to it when `../ai-service/openapi.yaml` is not in the build.
Leaving the option on is still preferable — the seed is then regenerated from the contract on every
deploy rather than trusted from the commit.

Without a database the site still serves the committed contract, read-only, and says so. Without
OAuth credentials everything is readable but nobody can sign in. Neither case is a crash — a
half-configured deploy degrades to documentation.

`APP_URL` pins the OAuth `redirect_uri`. A GitHub OAuth app accepts exactly one callback URL, and
preview deployments each get their own hostname, so without it sign-in works on production and
fails on previews.

## Running it locally

### Read-only, no setup

Renders the real contract. Good for working on the renderer, the layout or the editor UI. Comments
and edit requests are visibly disabled, because there is nowhere to put them.

```bash
npm install
```

```bash
npm run dev
```

`.env.local` needs only two lines — `predev` regenerates the embedded contract on every start:

```
OWNER_GITHUB_LOGIN=your-github-username
SESSION_SECRET=<any long random string>
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### The full flow

Commenting, edit requests and approvals all need a database, so add one. The driver speaks Neon's
HTTP protocol, which is what Vercel Postgres is — so use a free Neon database rather than a local
Postgres, and you are testing against the same thing production runs on. Create one at
<https://neon.tech>, then add its connection string to `.env.local`:

```
DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require
```

Restart. The schema creates itself and the committed contract is adopted as version 1.

### Signing in without registering an OAuth app

To exercise the roles you would otherwise need a GitHub OAuth app and two GitHub accounts. Instead:

```bash
node scripts/dev-session.mjs
```

That prints a `document.cookie = …` line — paste it into the browser console, reload, and you are
the owner. For the other side of the boundary, pass any other username:

```bash
node scripts/dev-session.mjs some-ai-dev
```

Now you are a contributor: the Publish button is gone, the editor offers **Open edit request**, and
Approve and Reject do not appear. Swap between the two cookies to play both halves of a review.

This is not a bypass in the server — the script signs a real cookie with `SESSION_SECRET` and the
server validates it exactly as it validates one issued by GitHub. Nothing in `src/` imports it and
it cannot run on Vercel.

If you would rather test the real sign-in, register a second OAuth app pointed at
`http://localhost:3000/api/auth/callback` and set `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.

### Worth walking through

1. As a contributor, open an operation and click the 💬 next to a response code. Leave a comment.
   The anchor lands in the URL — reload it and you come back to that thread with the operation
   already expanded.
2. Go to the editor, change something, and **Open edit request**.
3. Switch to the owner cookie. The edit request now shows Approve and Reject, and the Changes tab
   is a diff of exactly what would land.
4. Approve it. The reference updates, and History shows the new version linked to the request.
5. Restore the previous version from History — note that this *adds* a version rather than deleting
   one, so the revert is itself visible.

### Checking the boundary holds

With the server running:

```bash
npm run check
```

26 assertions over real HTTP. The one that matters is that a *genuinely signed, signed-in*
contributor still gets a 403 from `PUT /api/spec` — not merely that an anonymous stranger does.
It also covers forged and expired cookies, case-insensitive owner matching, and that
`?returnTo=https://evil.example` cannot turn sign-in into an open redirect.

Point it at a deployment to check the real thing, using the same `SESSION_SECRET`:

```bash
npm run check -- https://your-app.vercel.app
```

Non-destructive by default — safe to point at the real deployment. The owner check round-trips the
contract that is already published rather than sending a stub, so proving the owner gets through
cannot cost you a version.

Add `--write` to also exercise the writes (post a comment, open an edit request, then undo both):

```bash
npm run check -- --write
```

Worth rerunning after any change to `src/lib/auth.ts` or the API routes.

### Clearing test data

```bash
npm run reset -- --yes
```

Empties comments, edit requests and version history; the next request reseeds version 1 from
`ai-service/openapi.yaml`. It never touches that file. Without `--yes` it prints what it would
delete and stops.

## How it fits together

```
src/app/page.tsx          the reference — renders the contract, pins on every node
src/app/editor/page.tsx   Monaco + live preview; publishes, or proposes, by role
src/app/proposals/        edit requests: diff, discussion, approve or reject
src/app/history/          every published version, restorable

src/lib/auth.ts           the role boundary. Every mutating route calls into this.
src/lib/anchors.ts        how a comment addresses one part of the contract
src/lib/spec.ts           append-only version storage, and the self-seed
src/lib/store.ts          comments and proposals; mergeProposal is one CTE on purpose
src/lib/openapi.ts        validation and the parse the renderer works from

scripts/embed-spec.mjs      bundles ai-service/openapi.yaml as the seed and fallback
scripts/dev-session.mjs     mints a local session cookie (npm run session)
scripts/check-permissions.mjs  asserts the role boundary over HTTP (npm run check)
scripts/reset-db.mjs        clears test data back to a fresh seed (npm run reset)
db/schema.sql               readable copy of the schema in src/lib/db.ts
```

### Anchors

A comment points at a string like `op:post /api/v1/course-creation/outline/generate#responses.422`.
Readable on purpose — it appears in the URL as `?anchor=…`, so "this exact response code" can be
pasted into chat and the recipient lands on the open thread.

The label is snapshotted when the comment is written, so a note survives the operation it points at
being renamed or removed.

### Versions

`spec_versions` is append-only. Publishing, approving an edit request, and restoring an old version
all insert a row; nothing is ever overwritten. Approval is a single SQL statement (`mergeProposal`)
so a proposal cannot be published twice by two clicks racing each other.

## Syncing back to the repo

The repo stays the source of truth for codegen and the offline HTML. After changes land in the
browser, from the repo root:

```bash
CONTRACTS_URL=https://<your-app>.vercel.app npm run pull && npm run build
```

Then commit `ai-service/openapi.yaml` and `docs/`. `npm run pull` refuses to overwrite the contract
with anything that is not an OpenAPI document.
