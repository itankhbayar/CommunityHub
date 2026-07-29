# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

**CommunityHub** — a lifestyle community platform: users join interest-based communities, post updates, and organize meetups with RSVP.

Prefer small + correct + well-explained over large + half-broken.

## Required Stack (non-negotiable)

- **Backend:** NestJS (TypeScript)
- **Database:** PostgreSQL + Prisma (or TypeORM/Drizzle/Kysely)
- **Frontend:** Next.js App Router, React, TypeScript
- **Styling:** Tailwind CSS
- **Auth:** JWT with access + refresh tokens, implemented by hand. **Never** suggest Auth0, Clerk, or Supabase Auth.
- **Run:** `docker compose up` must work on a clean machine.

## Repository Layout

```
/backend      NestJS API
/frontend     Next.js app
docker-compose.yml
.env.example  (every required variable listed; NO real secrets committed)
```

## Commands

```bash
docker compose up                  # full stack (db + api + web)
docker compose exec api npm run seed  # seed demo data (idempotent)
cd backend && npm run start:dev    # API dev server (host)
cd backend && npm run test         # unit tests (permission matrix)
cd backend && npm run test:e2e     # 128 e2e tests vs real Postgres (db must be up)
cd backend && npx prisma migrate dev
cd backend && npm run seed         # seed from the host
cd backend && npm run lint
cd frontend && npm run dev         # frontend dev server (host)
cd frontend && npm run build       # production build / type check
cd frontend && npm run lint
```

(Adjust here as scripts are added — keep this section accurate.)

## Domain Model

Six entities: `User`, `Community`, `Membership`, `Post`, `Event`, `EventRsvp`.

Critical constraints:
- `Membership`: UNIQUE(userId, communityId)
- `EventRsvp`: UNIQUE(eventId, userId)
- **Roles are scoped per community**, not global. Same user can be OWNER in one community and MEMBER in another. `PLATFORM_ADMIN` is the only global role (seeded manually).
- Deleting a community must cascade cleanly — no orphaned posts, events, or memberships.

## Authorization — the most critical part of this codebase

- Roles: `PLATFORM_ADMIN` (global) > `OWNER` > `MODERATOR` > `MEMBER` > non-member.
- Implement the **exact permission matrix** defined below. Do not improvise permissions.
- Centralize authorization in **guards + decorators** (e.g. `@RequirePermission('post:delete:any')`). Guard resolves community context → loads caller's membership → evaluates permission.
- **NEVER scatter `if (user.role === 'OWNER')` checks in controllers/services.**

### Permission matrix

| Action | Platform Admin | Owner | Moderator | Member | Non-member |
|---|---|---|---|---|---|
| View public community and content | ✅ | ✅ | ✅ | ✅ | ✅ |
| View private community content | ✅ | ✅ | ✅ | ✅ | ❌ |
| Create post | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit own post | ✅ | ✅ | ✅ | ✅ | ❌ |
| Edit any post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete own post | ✅ | ✅ | ✅ | ✅ | ❌ |
| Delete any post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Create/edit/delete event | ✅ | ✅ | ✅ | ❌ | ❌ |
| RSVP to event | ✅ | ✅ | ✅ | ✅ | ❌ |
| Invite or remove member | ✅ | ✅ | ✅ | ❌ | ❌ |
| Change a member's role | ✅ | ✅ | ❌ | ❌ | ❌ |
| Update community settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete community | ✅ | ✅ | ❌ | ❌ | ❌ |

("Own" = the acting user is the author of the item.)
- Every resource query must be **scoped by community** — no cross-community data leakage.
- 403 vs 404: return **404** when a user requests a resource inside a private community they cannot see (don't leak existence). 403 only when the resource is visibly theirs to know about but the action is forbidden.

### Business rules that must always hold
1. A community always keeps ≥1 OWNER — the last Owner cannot leave or be demoted.
2. A MODERATOR cannot remove or demote an OWNER.
3. Nobody can change their own role.
4. Role downgrades apply **immediately**, not on token expiry → authorization must check the **database membership** on each guarded request, not the role claim inside the JWT.
5. Community deletion cascades (posts, events, memberships, rsvps).

## Auth Implementation

- Endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` (user + memberships).
- Access token ~15 min; refresh token invalidated on logout (store/rotate server-side).
- Passwords hashed with **argon2** (preferred) or bcrypt.
- Token storage: **httpOnly cookies** — document the reasoning (XSS protection, CSRF tradeoff) in README.

## API Rules

- REST, consistent error envelope, meaningful status codes.
- Validate ALL input (class-validator or zod). **Reject unknown fields** (`whitelist: true, forbidNonWhitelisted: true` in Nest's ValidationPipe).
- All list endpoints return pagination metadata.
- Posts feed: **cursor-based** pagination, newest first, author included — **no N+1** (use `include`/join, never per-row queries).
- **RSVP capacity must be race-safe under concurrency.** Use a transaction with `SELECT ... FOR UPDATE` on the event row (or a DB-level check) before counting confirmed `GOING` RSVPs. Explain mechanism in README.

## Frontend Requirements

Pages: login/register, community list, community detail (feed + events tabs), event detail.

Interactive components (own logic required, primitives from a library are fine):
1. **Optimistic** like + RSVP buttons with visible rollback on server rejection.
2. Infinite-scroll feed: cursor pagination, skeleton loaders, clear end-of-list state.
3. Accessible create/edit modal: focus trap, Escape closes, focus returns on close, inline validation, disabled submit while pending, double-submit protection.
4. Debounced search/filter bar **synced to URL** (shareable, survives refresh).
5. Role-aware UI: management controls only for permitted users — but server still enforces independently.
6. Toasts for success AND failure.
7. Member management table: inline role dropdown + confirmation for destructive actions.

UX rules:
- Every async surface handles all four states: loading / empty / error / success. No blank screens, no infinite spinners.
- Fully responsive; mobile genuinely usable.
- Keyboard navigable: sensible tab order, visible focus rings, predictable Enter/Escape.
- Destructive actions require confirmation.
- Human-readable errors only — never raw stack traces or `[object Object]`.

## Testing

Quality over quantity. Prioritize:
1. Authorization rules (permission matrix, last-owner rule, self-role-change block, moderator-vs-owner).
2. RSVP capacity race logic.

## Seed Script

Must create: 1 platform admin, 3 users, 2 communities (1 private), mixed roles, ~30 posts, 3 events with varied capacities.

## Git Discipline

- **Meaningful, incremental commits.** Avoid one giant catch-all commit.
- Commit after each coherent unit of work (schema → auth → guards → each resource → each frontend feature).
- Never commit secrets; keep `.env.example` in sync with actual env usage.

## README

Must contain: clean-machine setup steps, 2–3 paragraph architecture overview, how/where access control is enforced, token storage decision + reasoning, RSVP race mechanism, what was deliberately skipped and why, known bugs/rough edges. Document tradeoffs honestly.

## Scope Discipline

- Skip entirely: email delivery, payments, OAuth providers, deployment, pixel-perfect design, exhaustive tests.
- Stretch goals (waitlist promotion, rate limiting, real-time feed, audit log): at most 1–2, only after the core is solid.
- Ambiguous requirement → decide, note it in README, move on. Don't block.

## Build Order / Priorities

1. Authorization correctness — never compromise on this.
2. Schema + API correctness + race-safe RSVP.
3. Interactive components + async states.
4. Stretch goals — only after everything above is solid; first thing to drop.
