# CommunityHub

A lifestyle community platform: users join interest-based communities, post
updates, and organize meetups with RSVP. NestJS + PostgreSQL/Prisma backend,
Next.js (App Router) frontend, hand-rolled JWT auth, per-community roles.

## Quick start (clean machine)

Requirements: Docker with Compose v2. Nothing else — Node is only needed for
running tests or dev servers outside the containers.

```bash
git clone <this repo> && cd CommunityHub
cp .env.example .env
docker compose up -d --build
# wait until http://localhost:4000/health answers, then seed demo data:
docker compose exec api npm run seed
```

Open http://localhost:3000 and sign in as any seeded user
(password for all: `password123!`):

| Login | Roles |
|---|---|
| `maya@communityhub.local` | OWNER of Trail Blazers, MEMBER of Book Nook (private) |
| `theo@communityhub.local` | MODERATOR of Trail Blazers, OWNER of Book Nook |
| `suki@communityhub.local` | MEMBER of Trail Blazers, MODERATOR of Book Nook |
| `admin@communityhub.local` | Platform admin — member of nothing, may do everything |

The "Sunrise Summit Hike" event is seeded already full (2/2) so the
optimistic-RSVP rollback is demoable immediately: RSVP to it, watch the
button flip, then snap back with "This event is full."

> **Port conflicts:** if you already run Postgres on 5432, set
> `POSTGRES_PORT` in `.env` to a free port. Containers are unaffected;
> only the host-side mapping changes.

### Tests

```bash
cd backend
npm ci
npm test          # unit: the permission matrix, cell by cell
npm run test:e2e  # 128 tests against real Postgres (docker db must be up)
```

The e2e suite creates and migrates its own `communityhub_test` database, so
it never touches seeded demo data.

## Architecture overview

The backend is a NestJS API in `/backend` with Prisma 7 over PostgreSQL.
Eight models: the six domain entities (User, Community, Membership, Post,
Event, EventRsvp) plus `PostLike` (the optimistic like button needs
something to persist) and `RefreshToken` (logout must be able to revoke a
session server-side, and only a stored token can be revoked). Everything
below a community cascades on delete at the database level, and the
constraints the spec names — one membership per (user, community), one RSVP
per (event, user) — are UNIQUE indexes, not application checks. The feed is
keyset-paginated over an index that matches its exact ORDER BY, with the
author joined in the same query; an e2e test subscribes to Prisma's query
events and fails if a 10-post page and a 30-post page ever cost a different
number of queries, so "no N+1" is a regression test rather than a claim.

The frontend is a Next.js App Router app in `/frontend` that treats the API
as its single source of truth: all data flows through TanStack Query on the
client (decision: optimistic mutations and cursor infinite-scroll are the
hard requirements here, and they are Query's core competency; slower first
paint is the accepted cost). Optimistic UI is implemented as
snapshot-patch-rollback against the query cache — likes and RSVPs flip
instantly, and a server refusal visibly restores the previous state with a
toast. Role-aware controls are hidden by the UI as UX (`lib/roles.ts`) but
never trusted as security; every hand-crafted request meets the same guard.

Both apps run under docker compose with bind-mounted source and in-container
dev servers; the api container generates the Prisma client and applies
committed migrations on start, so a fresh clone needs no manual migration
step.

## Where access control is enforced

One place. `backend/src/authz/permissions.ts` holds the permission matrix
as data — 13 spec actions plus one documented extension (`post:like`), each
mapping to the roles allowed. Controllers declare intent with
`@RequirePermission('event:manage')` or, for own-vs-any rows,
`@RequirePermission({ any, own, ownerField })`. No role branch exists in any
controller or service.

`PermissionGuard` (global, after `JwtAuthGuard`) decides in a fixed order:

1. Resolve the route's community from its params (`postId`/`eventId` imply
   the community; malformed UUIDs 404 like absent rows).
2. Load the caller's membership **from the database, on every request**.
   The JWT carries identity only — no role claim exists to go stale — so
   demotions apply on the next request, not at token expiry.
3. Visibility gate: a private community answers **404** to non-members
   before any permission logic runs, so a 403 can never leak existence.
4. Matrix check; denial inside a visible community is a plain 403.

Rules the matrix cannot express because they depend on the *target* — a
community keeps ≥1 owner, moderators cannot remove owners, nobody changes
their own role — live in `MembershipPolicyService` and run inside a
transaction that locks the community row first, so concurrent membership
mutations serialize and the owner count cannot be raced past. The unit
suite iterates all 70 matrix cells against a second, independent
transcription of the spec table; the e2e suite proves the wiring over HTTP,
including a mid-session demotion flipping 201→403 on the same cookie.

## Token storage: httpOnly cookies

Both tokens are httpOnly cookies and never appear in a response body, so
tokens are unreadable from JavaScript and XSS cannot exfiltrate a session.
The access token (15 min, identity-only JWT) is `SameSite=Lax` at `/`; the
refresh token is an opaque random value — stored server-side as a sha256
hash, rotated on every refresh, family-revoked on reuse or logout —
`SameSite=Strict` and scoped to `/auth` so it accompanies nothing else.

The CSRF tradeoff, honestly: cookies mean CSRF is a consideration.
We rely on `SameSite=Lax` (browsers withhold the cookie from cross-site
POST/PATCH/DELETE) plus a JSON-only API that rejects unknown fields — the
`<form>`-encoded bodies a cross-site form could send fail validation
outright. A double-submit CSRF token was considered and skipped as adding
moving parts without closing a real gap for this deployment shape; a
deployment on subdomains or with older-browser requirements should add one.

**That reasoning inverts on a split-host deploy.** With the web app on one
domain and the API on another, `SameSite` cannot stay Lax/Strict: a browser
drops a Lax cookie arriving from a cross-site response entirely, so login
returns 200 and the session never persists. Setting `COOKIE_SAMESITE=none`
(see [Deploying](#deploying-split-host-vercel--hosted-api)) is the only
option, and it genuinely forfeits the SameSite protection described above —
leaving the JSON-only/unknown-field-rejecting API as the sole remaining CSRF
barrier. That barrier is real but thinner than it was. **A split-host
production deployment should add a double-submit CSRF token**; this repo does
not, and that is the honest gap. Same-origin deploys keep the stronger
defaults untouched.

## RSVP capacity under concurrency

Counting GOING rows and then inserting cannot be fixed by locking the rows
you counted — the competing write is an *insert* of a row that did not
exist at count time. Instead, the RSVP transaction takes
`SELECT … FOR UPDATE` on the parent **event row**, making every RSVP writer
for that one event mutually exclusive across the whole
read-count-write sequence, while other events proceed untouched. Going→going
consumes nothing; going→not-going frees the seat under the same lock;
`capacity NULL` skips counting; `UNIQUE(eventId, userId)` remains the
backstop. Capacity edits are single UPDATEs that queue behind the row lock,
so lowering capacity cannot interleave with admissions (and never evicts
existing attendees).

Proof, not assertion: an e2e test fires 50 simultaneous RSVPs from 50 real
sessions at a capacity-5 event and asserts exactly 5×200, 45×409, and 5
GOING rows in the database; a second test hammers a capacity-3 event with
waves of concurrent flips and asserts the count never exceeds 3.

## Deploying: split host (Vercel + hosted API)

Vercel builds the Next.js app only. It does not run `docker-compose.yml`, so
the API and Postgres must be hosted separately — a frontend-only deploy has
no backend to authenticate against, and register/login fail because the
browser resolves `NEXT_PUBLIC_API_URL`'s default `http://localhost:4000`
against the *visitor's own machine*.

**1. Deploy the API.** `render.yaml` at the repo root declares it. In Render:
**New → Blueprint → select this repo**. It generates `JWT_ACCESS_SECRET` and
sets `COOKIE_SECURE`/`COOKIE_SAMESITE`. Migrations apply automatically at
boot via `docker-entrypoint.sh`. Nothing is Render-specific: Railway, Fly, or
any Docker host works with the same variables.

**1a. Provision Postgres separately** (Supabase here; Neon or Render's own
work too) and set `DATABASE_URL` on the API service. Three requirements,
each of which fails in its own confusing way:

- **Session pooler, port 5432** — not the direct connection, which is
  IPv6-only without Supabase's paid IPv4 add-on and simply won't route from
  most hosts.
- **Not transaction mode (6543)** — RSVP capacity safety depends on
  `SELECT … FOR UPDATE` row locks held across a transaction, and the app runs
  its own `pg` pool. Session mode preserves both; transaction mode adds
  connection-pinning and prepared-statement caveats to the most
  correctness-critical path in the codebase.
- **Append `?sslmode=verify-full&sslrootcert=./certs/supabase-ca.crt`** — some
  `sslmode` is mandatory, since Supabase refuses cleartext while
  `pg-connection-string` parses a *missing* `sslmode` as no TLS rather than
  defaulting it on. Bare `require` does not work either: `pg` 8.x aliases it
  to `verify-full`, and Supabase's pooler presents a chain signed by its own
  "Supabase Root 2021 CA", which Node does not ship — so it fails with
  `SELF_SIGNED_CERT_IN_CHAIN` unless that CA is supplied explicitly.

  `backend/certs/supabase-ca.crt` is that root, committed deliberately: a CA
  certificate is public, and pinning it is what makes the connection
  *authenticated* rather than merely encrypted. `no-verify` would also
  connect, but accepts any certificate and so gives no protection against an
  active machine-in-the-middle between the API and the database.

  The path is relative to the working directory, which is `backend/` on the
  host and `/app` in the container — the same location either way. A missing
  or wrong CA fails closed (the client throws at construction rather than
  quietly downgrading), which is the intended behavior.

**2. Set `CORS_ORIGIN` on the API** to the Vercel origin — scheme included,
no trailing slash, e.g. `https://your-app.vercel.app`. It is the one value
the blueprint leaves blank (`sync: false`). Comma-separate to allow preview
deploys. A mismatch here surfaces as a CORS error in the browser console
while the request itself succeeds server-side.

**3. Set `NEXT_PUBLIC_API_URL` on Vercel** to the API's public URL, e.g.
`https://communityhub-api.onrender.com`. This is inlined at **build time**,
so after adding it you must **redeploy** — setting the variable alone
changes nothing in an already-built bundle. This is the single most common
cause of the symptom above.

**4. Seed demo data** (optional) from the API host's shell:
`npm run seed` — idempotent, safe to re-run.

Verify with `curl https://<api-host>/health` → `{"status":"ok",…}`.

Two deployment-specific notes. Both cookies switch to `SameSite=None` via
`COOKIE_SAMESITE=none`, which is mandatory across domains and which costs
real CSRF protection — see [Token storage](#token-storage-httponly-cookies).
And Render's free tier idles the API after inactivity, so the first request
after a pause takes ~30s; the frontend shows loading states rather than
blank screens, but the wait is real.

## Deliberately skipped and why

- **Email delivery, OAuth, payments** — out of scope per spec. "Invite" is a
  direct add of an existing account by email.
- **A managed deploy pipeline** — `render.yaml` provisions the API and its
  database, but there is no CI, no staging environment, and no automated
  migration gate; `docker compose up` remains the supported path.
- **Waitlist auto-promotion, rate limiting, realtime, audit log** (stretch
  goals) — none attempted; the core was prioritized. `WAITLIST` already
  exists in the RSVP enum so promotion needs no future migration.
- **Exhaustive test coverage** — tests concentrate where the spec says
  correctness matters most: the authorization matrix (every cell, twice) and
  RSVP concurrency. Frontend testing is manual.

## Known rough edges

- An event's capacity cannot be changed back to "unlimited" once set (the
  PATCH DTO rejects `null`); pick a large number instead.
- The nav's session data has a 60s staleTime, so a role change made
  elsewhere may take up to a minute to reflect in *navigation chrome*. The
  server reads roles fresh per request, so actual permissions change
  immediately.
- Member and attendee lists render the first 100/50 without pager UI (the
  API paginates; the UI doesn't expose it).
- Windows/macOS docker dev: the api container needs `CHOKIDAR_USEPOLLING`
  (set in compose) because inotify doesn't cross bind mounts. Turbopack
  does not honor the equivalent for the web container — edits to existing
  files hot-reload fine, but a **brand-new route directory** is not picked
  up, and `docker compose restart web` alone does not fix it: Turbopack's
  cache in `.next` survives the restart and keeps serving 404 for the new
  route. Clear it too:

  ```bash
  docker compose stop web && rm -rf frontend/.next && docker compose start web
  ```
- Do not run `npm run build` on the host while the web container is up.
  `.next` is bind-mounted (the anonymous volume for it was dropped), so a
  host production build lands in the directory the in-container dev server
  uses, and Turbopack panics on every request — the browser then reloads
  forever against a page that can never compile. Same fix as above: stop
  web, delete `.next`, start web.
- After changing `package.json` dependencies, rebuild with
  `docker compose up -d --build --renew-anon-volumes api` (or `web`) — the
  anonymous `node_modules` volume otherwise survives the rebuild and
  shadows the new packages.
- Feed/like state is not synchronized across tabs or users in real time;
  it reconciles on refetch.
