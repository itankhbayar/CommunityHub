import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';

const REGISTRATION = {
  email: 'ada@example.com',
  password: 'correct-horse-battery',
  displayName: 'Ada',
};

/** Pulls a specific cookie's value out of a Set-Cookie header list. */
function cookieValue(
  setCookie: string[] | undefined,
  name: string,
): string | undefined {
  const header = (setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  if (!header) return undefined;
  const value = header.split(';')[0].slice(name.length + 1);
  return value.length > 0 ? value : undefined;
}

function setCookieHeader(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

describe('Auth (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  describe('registration and validation', () => {
    it('registers a user, sets httpOnly cookies, and never returns tokens in the body', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      const body = res.body as { user: { email: string; id: string } };
      expect(body.user.email).toBe(REGISTRATION.email);
      expect(JSON.stringify(body)).not.toMatch(/token/i);

      const cookies = setCookieHeader(res);
      const access = cookies.find((c) => c.startsWith('ch_access='));
      const refresh = cookies.find((c) => c.startsWith('ch_refresh='));

      expect(access).toMatch(/HttpOnly/i);
      expect(access).toMatch(/SameSite=Lax/i);
      expect(refresh).toMatch(/HttpOnly/i);
      expect(refresh).toMatch(/SameSite=Strict/i);
      // refresh token is only sent to the endpoints that mint or destroy sessions
      expect(refresh).toMatch(/Path=\/auth/i);
    });

    it('stores an argon2id hash rather than the password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: REGISTRATION.email },
      });

      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user.passwordHash).not.toContain(REGISTRATION.password);
    });

    it('rejects unknown fields instead of silently ignoring them', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...REGISTRATION, globalRole: 'PLATFORM_ADMIN' })
        .expect(400);

      const body = res.body as { code: string; details: string[] };
      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.details.join(' ')).toMatch(/globalRole/);

      // the privilege escalation attempt did not create anything
      expect(await prisma.user.count()).toBe(0);
    });

    it('rejects a duplicate email with 409', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(409);

      expect((res.body as { message: string }).message).toMatch(
        /already registered/i,
      );
    });

    it('normalizes email case so the same address cannot register twice', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...REGISTRATION, email: 'ADA@Example.COM ' })
        .expect(409);
    });

    it('returns readable validation messages, never a stack trace', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'nope', password: 'short', displayName: '' })
        .expect(400);

      const body = res.body as { message: string; details: string[] };
      expect(body.message).toBe('Some fields need attention.');
      expect(body.details).toEqual(
        expect.arrayContaining([
          'Enter a valid email address.',
          'Password must be at least 8 characters.',
        ]),
      );
      expect(JSON.stringify(body)).not.toMatch(/at .*\.ts:\d+/);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);
    });

    it('signs in with correct credentials', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: REGISTRATION.email, password: REGISTRATION.password })
        .expect(200);
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrongPassword = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: REGISTRATION.email, password: 'not-the-password' })
        .expect(401);

      const unknownUser = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'not-the-password' })
        .expect(401);

      // identical response, so login cannot be used to enumerate accounts
      expect((wrongPassword.body as { message: string }).message).toBe(
        (unknownUser.body as { message: string }).message,
      );
    });
  });

  describe('session lifecycle', () => {
    it('walks register -> me -> refresh -> me -> logout -> refresh fails', async () => {
      const agent = request.agent(app.getHttpServer());

      await agent.post('/auth/register').send(REGISTRATION).expect(201);

      const me = await agent.get('/auth/me').expect(200);
      expect((me.body as { email: string }).email).toBe(REGISTRATION.email);
      expect((me.body as { memberships: unknown[] }).memberships).toEqual([]);
      // the hash must never leave the server
      expect(JSON.stringify(me.body)).not.toMatch(/passwordHash/);

      await agent.post('/auth/refresh').expect(200);
      await agent.get('/auth/me').expect(200);

      await agent.post('/auth/logout').expect(204);
      await agent.post('/auth/refresh').expect(401);
    });

    it('requires authentication for /auth/me', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .expect(401);

      expect((res.body as { code: string }).code).toBe('UNAUTHENTICATED');
    });

    it('rotates the refresh token, invalidating the previous one', async () => {
      const first = await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      const originalRefresh = cookieValue(
        setCookieHeader(first),
        'ch_refresh',
      )!;

      const rotated = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `ch_refresh=${originalRefresh}`)
        .expect(200);

      const newRefresh = cookieValue(setCookieHeader(rotated), 'ch_refresh')!;
      expect(newRefresh).not.toBe(originalRefresh);

      // the new one works
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `ch_refresh=${newRefresh}`)
        .expect(200);
    });

    it('revokes the whole family when a used refresh token is replayed', async () => {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send(REGISTRATION)
        .expect(201);

      const stolen = cookieValue(setCookieHeader(registered), 'ch_refresh')!;

      // legitimate client rotates
      const rotated = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `ch_refresh=${stolen}`)
        .expect(200);

      const current = cookieValue(setCookieHeader(rotated), 'ch_refresh')!;

      // attacker replays the token they captured earlier
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `ch_refresh=${stolen}`)
        .expect(401);

      // ...which must also burn the legitimate client's current token
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `ch_refresh=${current}`)
        .expect(401);

      const live = await prisma.refreshToken.count({
        where: { revokedAt: null },
      });
      expect(live).toBe(0);
    });

    it('clears cookies and succeeds when logging out without a session', async () => {
      await request(app.getHttpServer()).post('/auth/logout').expect(204);
    });

    it('refuses a forged access token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', 'ch_access=not.a.real.token')
        .expect(401);
    });
  });
});
