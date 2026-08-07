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

**Email lands at http://localhost:8025.** Compose bundles
[Mailpit](https://github.com/axllent/mailpit), an SMTP server that accepts
everything and delivers nothing, so confirmation and password-reset links are
readable in a web inbox without an account, an API key, or any risk of mailing
a real stranger. `docker compose up` still needs zero credentials.

> **Port conflicts:** if you already run Postgres on 5432, set
> `POSTGRES_PORT` in `.env` to a free port. Containers are unaffected;
> only the host-side mapping changes. Same for `MAILPIT_UI_PORT` on 8025.

### Tests

```bash
cd backend
npm ci
npm test          # 85 unit: the permission matrix cell by cell, plus the rate limiter
npm run test:e2e  # 161 tests against real Postgres (docker db must be up)
```

Two things about the account-recovery specs are worth knowing before you read
them. `MailerService` is swapped for a recorder, and the tests pull tokens out
of the **message body** rather than out of the service that minted them —
only a hash is stored, so the plaintext exists nowhere else, and reading it
back from the mail means a broken link format fails the test instead of
passing it. And every request carries an `X-Forwarded-For`, giving each test
its own client identity so one test spending a rate limit cannot fail the
next; `setup-env.ts` sets `TRUST_PROXY=1` to make Express honour it.

The e2e suite creates and migrates its own `communityhub_test` database, so
it never touches seeded demo data.

## Architecture overview

The backend is a NestJS API in `/backend` with Prisma 7 over PostgreSQL.
Nine models: the six domain entities (User, Community, Membership, Post,
Event, EventRsvp) plus three pieces of infrastructure — `PostLike` (the
optimistic like button needs something to persist), `RefreshToken` (logout
must be able to revoke a session server-side, and only a stored token can be
revoked), and `VerificationToken` (single-use hashed links for password reset
and email confirmation, deliberately shaped like `RefreshToken`). Everything
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

Three global guards run in registration order: `ThrottleGuard` (cheapest, and
it must not sit behind the work a flood is trying to provoke), then
`JwtAuthGuard` (identity), then `PermissionGuard`. Authentication is opt-out
via `@Public()` so a new controller is protected by default; rate limiting is
opt-in via `@Throttle` so only endpoints that cost something declare a cap.

`PermissionGuard` decides in a fixed order:

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

Changing a password (`POST /auth/password`) revokes **every** refresh token
for that user, across all families and devices — whoever knew the old
password must not keep a live session merely because they refreshed
recently. The caller is handed a fresh cookie pair in the same response, so
the effect is "signed out everywhere except here" rather than an immediate
logout of the person doing the change. A reset via emailed link revokes the
same set but issues nothing back — see
[Account recovery](#account-recovery-emailed-tokens).

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

## Account recovery: emailed tokens

Password reset and email confirmation are the same primitive with different
TTLs. A `VerificationToken` row holds a **sha256 hash** of 32 random bytes —
never the token itself, so a database leak yields nothing usable — plus a
purpose, an expiry, and a `consumedAt`. Reset links last 1 hour because they
are a live credential for the account; confirmation links last 24 hours
because confirming an address is not urgent and people read mail late.

Single use is enforced in the write, not the read: `consume()` re-checks
`consumedAt: null` inside the `UPDATE`'s WHERE clause within one transaction,
so two simultaneous submissions of the same link cannot both win — the loser
updates zero rows and is rejected. Issuing a new token consumes any
outstanding one of the same purpose, so a widening set of valid links never
accumulates in an inbox. Changing a password by any route consumes
outstanding reset tokens too, since a link mailed beforehand could otherwise
undo the change.

Resetting a password revokes every refresh token for the user: the old
credential is no longer trusted and a session minted under it must not
outlive it. Unlike a signed-in password change, reset issues **no** session in
exchange — proving control of an inbox is not reason enough to sign a browser
in — so the UI lands on the login form.

### Not leaking which addresses have accounts

`POST /auth/forgot-password` answers `202` for every address. A `404` on
unknown addresses would be an enumeration oracle, and so would a materially
faster reply.

**The obvious defense was not enough, and only measuring caught it.** The
first implementation did a dummy argon2 hash on the miss path, mirroring what
login does. Measured, the two paths were still trivially distinguishable:

| | median | range |
|---|---|---|
| Known address | 55 ms | 53–62 ms |
| Unknown address | 20 ms | 18–34 ms |

Non-overlapping — a *single* request revealed whether an address was
registered. The hash was never the dominant cost; writing two rows and
awaiting an SMTP round-trip was. The fix moves the send off the awaited path
and pads every response to a 250 ms floor, comfortably above the slowest real
path. Re-measured across all three branches — real send, suppressed by
cooldown, and unknown address — everything now lands at 253–265 ms with fully
overlapping ranges.

Registration is the deliberate exception: it must tell you an address is
taken, because you need to know. Login stays vague to compensate.

### Rate limiting

`/auth/forgot-password` is public and mails an **attacker-chosen** address.
Unthrottled it is an email-bombing service, so two independent limits apply,
because either alone is insufficient:

- **Per client IP** (`ThrottleGuard`, opt-in via `@Throttle`): a fixed window
  in memory. Stops one sender; a botnet evades it.
- **Per account** (`VerificationTokenService.issue`): no second mail for the
  same person and purpose within 60 seconds. Keyed on the *recipient* rather
  than the sender, so it holds no matter how many IPs are involved. The
  response is 202 either way, and the previous link is still valid, so a real
  user waiting out the cooldown loses nothing.

The IP buckets are keyed on handler and client only — **never on the request
body**. Folding the submitted email in would make the 429 depend on which
address was asked about and hand back the enumeration oracle above. A unit
test guards that specifically.

Login and register are not throttled yet. That is brute-force protection
rather than mail abuse, and the e2e suite authenticates often enough that it
needs its own handling first; the mechanism is in place, only the decorator is
missing.

> **`TRUST_PROXY` matters more than it looks.** Express derives `req.ip` from
> `X-Forwarded-For` only when `trust proxy` is set, and the limiter keys on
> that value, so both mistakes are silent. Unset behind a proxy, every request
> looks like it came from the proxy: one bucket shared by the internet, and
> the limiter locks everyone out at once. Set without a proxy in front,
> `X-Forwarded-For` is caller-controlled: a fresh header per request is a
> fresh bucket per request, and the limiter does nothing. Default `0` is right
> for compose; hosted deployments behind one TLS hop set `1`. The value is
> logged at boot next to the CORS allowlist, because neither is visible from
> outside.

The store is per-process and in memory. Counts reset on restart and are not
shared between instances, so N replicas allow N times the limit. That is a
deliberate tradeoff against a Redis dependency for an API that runs as a
single instance; a hard global cap needs a shared store.

### Email verification is advisory

An unconfirmed address gets a dismissible banner and a status badge on the
account page, and nothing else. **No feature is gated on it.** Confirming an
address buys exactly one thing — a working password reset — and locking
someone out of the product to protect them from a future lockout is
backwards. Resetting a password also marks the address confirmed, since
clicking a link we mailed is precisely the proof verification asks for.

`/auth/verify-email` is public: the link is clicked from a mail client, often
on a device that was never signed in, so the token is the whole
authorisation. That is proportionate given how little it grants.
`/auth/verify-email/resend` takes no address and always mails the caller's
own, which is what keeps it from being a second open relay.

Seeded demo accounts are backfilled as verified — nobody can open mail at
`@communityhub.local`, so they would otherwise carry a banner none of them
could ever dismiss.

### Running without SMTP

Leaving `SMTP_HOST` blank **disables** email: `MailerService` writes each
message to the API log, link included, and sends nothing. That is the mode the
e2e suite and a host-side `npm run start:dev` want, because compose's
`mailpit` hostname resolves only inside the compose network.

There is no safe default here, and picking one caused a real bug. Defaulting
the host to `mailpit` meant every send from outside compose was a multi-second
DNS timeout ending in a logged failure. With the e2e suite registering five
users per file, that was slow enough to starve the Postgres connection pool
and fail tests in unrelated suites — the symptom was `Connection terminated
unexpectedly` in the *events* and *members* specs, nowhere near the mail code.
The suite now forces `SMTP_HOST=''` alongside the cookie flags it already
pins, for the same reason: a real value in `.env` must not silently win and
break the run.

The same investigation turned up a second bug worth naming. Registration
originally fired the whole verification routine — token write included — as a
detached promise. Detaching a database write lets it outlive the request and,
in tests, the application: the query then lands on a closed connection. Only
the SMTP call is detached now, and it touches no database. If you add
background work here, await everything that speaks to Postgres.

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

Four variables the blueprint declares but cannot fill in, all of which fail
**silently** if skipped:

| Variable | Skipped, you get |
|---|---|
| `TRUST_PROXY` | Blueprint sets `1`. If it ever reverts to unset, every request looks like it came from Render's proxy — one shared rate-limit bucket, so five forgot-password requests from any one visitor lock the endpoint for everybody. |
| `APP_URL` | Defaults to `http://localhost:3000`, so every emailed reset and confirmation link points at the recipient's own machine. |
| `SMTP_*` | Email disabled. Messages go to the service log rather than an inbox, and password reset is unusable. The boot log says so loudly. |
| `MAIL_FROM` | Mail from an unverified sender domain is dropped or spam-filed regardless of correct SMTP settings. |

> Render re-applies blueprint-declared variables on every sync and silently
> overrides dashboard edits — `sync: false` is honoured on first creation but
> not reliably when updating an existing blueprint. If a value you set in the
> dashboard reverts, delete the variable and re-add it rather than editing it
> in place.

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

- **OAuth, payments** — out of scope per spec. "Invite" is a direct add of an
  existing account by email.
- **A production mail provider** — email delivery *was* originally skipped,
  and is now in scope: a locked-out account had no recovery path at all,
  which was the wrong thing to leave broken. What is skipped is the hosted
  side. `MailerService` is plain SMTP via nodemailer, pointed at Mailpit
  locally; a real deployment sets `SMTP_*` at Resend, Postmark, or SES. No
  bounce handling, no delivery tracking, no templating engine — the two
  messages are hand-written text with a minimal HTML twin.
- **A managed deploy pipeline** — `render.yaml` provisions the API and its
  database, but there is no CI, no staging environment, and no automated
  migration gate; `docker compose up` remains the supported path.
- **Waitlist auto-promotion, realtime, audit log** (stretch goals) — not
  attempted; the core was prioritized. `WAITLIST` already exists in the RSVP
  enum so promotion needs no future migration. Rate limiting was on this list
  and came off it: once an endpoint mails an attacker-chosen address, a cap
  stops being a nice-to-have. See
  [Rate limiting](#rate-limiting) for what is and is not covered.
- **Exhaustive test coverage** — tests concentrate where the spec says
  correctness matters most: the authorization matrix (every cell, twice), RSVP
  concurrency, and account recovery (single-use tokens, purpose separation,
  session revocation, both rate limits). Frontend testing is manual.

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
  (set in compose) because inotify doesn't cross bind mounts. Turbopack does
  not honor the equivalent for the web container, so **hot reload is not
  reliable at all** — not just for new route directories. An edit to an
  existing file can be visible inside the container (`docker compose exec web
  cat …` shows it) while the browser keeps serving the previous build and the
  web logs show no recompile. `docker compose restart web` alone does not fix
  either case: Turbopack's cache in `.next` survives the restart. Clear it
  too:

  ```bash
  docker compose stop web && rm -rf frontend/.next && docker compose start web
  ```

  If a change you are sure you made is not showing up, this is why — check
  the web logs for a recompile line before assuming the change is wrong.
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
