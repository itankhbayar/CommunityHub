import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';
import { RecordingMailer } from './utils/mail';

const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'a-different-horse-entirely';

/**
 * Every request carries an X-Forwarded-For so the rate limiter sees a distinct
 * client per test. Without it all of supertest arrives from 127.0.0.1, and the
 * first test to spend a limit would fail every test after it. setup-env.ts sets
 * TRUST_PROXY=1 to make Express honour the header.
 */
let clientCounter = 0;
function freshClient(): string {
  clientCounter += 1;
  const n = clientCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

describe('Account recovery (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let mail: RecordingMailer;

  /** A signed-in user, plus the raw values the tests need to re-authenticate. */
  async function registerUser(email: string) {
    const client = freshClient();
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/auth/register')
      .set('X-Forwarded-For', client)
      .send({ email, password: PASSWORD, displayName: 'Test User' })
      .expect(201);

    return { agent, email, client };
  }

  function post(path: string, client: string) {
    return request(app.getHttpServer())
      .post(path)
      .set('X-Forwarded-For', client);
  }

  function login(email: string, password: string, client: string) {
    return post('/auth/login', client).send({ email, password });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    mail = ctx.mail;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    mail.clear();
  });

  // ---------------------------------------------------------------------------

  describe('POST /auth/password — change while signed in', () => {
    it('rejects an anonymous caller (401)', async () => {
      await post('/auth/password', freshClient())
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('rejects the wrong current password and leaves the old one working', async () => {
      const { agent, email, client } = await registerUser('a@example.com');

      await agent
        .post('/auth/password')
        .set('X-Forwarded-For', client)
        .send({ currentPassword: 'not-it', newPassword: NEW_PASSWORD })
        .expect(401);

      await login(email, PASSWORD, freshClient()).expect(200);
      await login(email, NEW_PASSWORD, freshClient()).expect(401);
    });

    it('refuses a new password identical to the current one (400)', async () => {
      const { agent, client } = await registerUser('b@example.com');

      await agent
        .post('/auth/password')
        .set('X-Forwarded-For', client)
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
        .expect(400);
    });

    it('applies the change and swaps which password works', async () => {
      const { agent, email, client } = await registerUser('c@example.com');

      await agent
        .post('/auth/password')
        .set('X-Forwarded-For', client)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      await login(email, NEW_PASSWORD, freshClient()).expect(200);
      await login(email, PASSWORD, freshClient()).expect(401);
    });

    it('signs out every other device but keeps the caller signed in', async () => {
      const { agent, email, client } = await registerUser('d@example.com');

      // a second device for the same account
      const other = request.agent(app.getHttpServer());
      const otherClient = freshClient();
      await other
        .post('/auth/login')
        .set('X-Forwarded-For', otherClient)
        .send({ email, password: PASSWORD })
        .expect(200);
      await other
        .post('/auth/refresh')
        .set('X-Forwarded-For', otherClient)
        .expect(200);

      await agent
        .post('/auth/password')
        .set('X-Forwarded-For', client)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // the other device's refresh token is dead...
      await other
        .post('/auth/refresh')
        .set('X-Forwarded-For', otherClient)
        .expect(401);

      // ...while the caller was handed a fresh pair in the same response
      await agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', client)
        .expect(200);
    });

    it('kills a reset link that was already in flight', async () => {
      const { agent, email, client } = await registerUser('e@example.com');

      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);
      const token = mail.tokenFrom('reset-password');

      await agent
        .post('/auth/password')
        .set('X-Forwarded-For', client)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(200);

      // the mailed link would otherwise undo the change the owner just made
      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: 'yet-another-password' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------------------

  describe('POST /auth/forgot-password — requesting a link', () => {
    it('answers identically for a known and an unknown address', async () => {
      await registerUser('known@example.com');
      mail.clear();

      const hit = await post('/auth/forgot-password', freshClient())
        .send({ email: 'known@example.com' })
        .expect(202);

      const miss = await post('/auth/forgot-password', freshClient())
        .send({ email: 'nobody@example.com' })
        .expect(202);

      // Same status, same (empty) body. The timing side of this guarantee is
      // measured rather than asserted here — see the README; a wall-clock
      // assertion in CI would be flaky and would prove less.
      expect(miss.body).toEqual(hit.body);
      expect(miss.text).toEqual(hit.text);
    });

    it('mails a link to a real address and nothing to an unknown one', async () => {
      await registerUser('real@example.com');
      mail.clear();

      await post('/auth/forgot-password', freshClient())
        .send({ email: 'real@example.com' })
        .expect(202);
      await post('/auth/forgot-password', freshClient())
        .send({ email: 'ghost@example.com' })
        .expect(202);

      expect(mail.to('real@example.com')).toHaveLength(1);
      expect(mail.to('ghost@example.com')).toHaveLength(0);
      expect(mail.last?.text).toMatch(/reset-password\?token=/);
    });

    it('stores only a hash, never the token itself', async () => {
      await registerUser('hash@example.com');
      mail.clear();

      await post('/auth/forgot-password', freshClient())
        .send({ email: 'hash@example.com' })
        .expect(202);

      const token = mail.tokenFrom('reset-password');
      // scoped by purpose: registration already left an EMAIL_VERIFICATION row,
      // and the two coexist rather than displacing each other
      const rows = await prisma.verificationToken.findMany({
        where: { purpose: 'PASSWORD_RESET' },
      });

      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(token);
      expect(rows[0].tokenHash).toHaveLength(64); // sha256 hex

      // nothing anywhere in the table equals the plaintext that was mailed
      const all = await prisma.verificationToken.findMany();
      expect(all.map((row) => row.tokenHash)).not.toContain(token);
    });

    it('sends one mail, not three, when asked repeatedly', async () => {
      await registerUser('flood@example.com');
      mail.clear();

      for (let i = 0; i < 3; i++) {
        await post('/auth/forgot-password', freshClient())
          .send({ email: 'flood@example.com' })
          .expect(202);
      }

      // different clients each time, so this is the per-account cooldown doing
      // the work rather than the per-IP limiter
      expect(mail.to('flood@example.com')).toHaveLength(1);
    });

    it('sends again once the cooldown has passed', async () => {
      await registerUser('later@example.com');
      mail.clear();

      await post('/auth/forgot-password', freshClient())
        .send({ email: 'later@example.com' })
        .expect(202);

      // rather than sleeping 60s, age the token the cooldown looks at
      await prisma.verificationToken.updateMany({
        data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
      });

      await post('/auth/forgot-password', freshClient())
        .send({ email: 'later@example.com' })
        .expect(202);

      expect(mail.to('later@example.com')).toHaveLength(2);
    });

    it('invalidates the previous link when a new one is issued', async () => {
      const { email } = await registerUser('replace@example.com');
      mail.clear();

      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);
      const first = mail.tokenFrom('reset-password');

      await prisma.verificationToken.updateMany({
        data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
      });
      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);
      const second = mail.tokenFrom('reset-password');

      expect(second).not.toBe(first);
      // a widening set of live credentials in an inbox is the thing to avoid
      await post('/auth/reset-password', freshClient())
        .send({ token: first, newPassword: NEW_PASSWORD })
        .expect(400);
      await post('/auth/reset-password', freshClient())
        .send({ token: second, newPassword: NEW_PASSWORD })
        .expect(204);
    });
  });

  // ---------------------------------------------------------------------------

  describe('POST /auth/reset-password — spending the link', () => {
    /** Registers, requests a reset, and hands back the emailed token. */
    async function requestReset(email: string) {
      await registerUser(email);
      mail.clear();
      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);
      return mail.tokenFrom('reset-password');
    }

    it('sets the new password and retires the old one', async () => {
      const token = await requestReset('r1@example.com');

      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      await login('r1@example.com', NEW_PASSWORD, freshClient()).expect(200);
      await login('r1@example.com', PASSWORD, freshClient()).expect(401);
    });

    it('issues no session — an inbox is not a sign-in', async () => {
      const token = await requestReset('r2@example.com');

      const res = await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('works exactly once', async () => {
      const token = await requestReset('r3@example.com');

      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);
      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: 'third-password-here' })
        .expect(400);

      // the second attempt must not have taken effect
      await login('r3@example.com', NEW_PASSWORD, freshClient()).expect(200);
    });

    it('rejects a token that was never issued', async () => {
      await post('/auth/reset-password', freshClient())
        .send({ token: 'not-a-real-token', newPassword: NEW_PASSWORD })
        .expect(400);
    });

    it('does not spend the token when the new password fails validation', async () => {
      const token = await requestReset('r4@example.com');

      // a typo in the password field must not cost the user their link
      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: 'short' })
        .expect(400);

      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);
    });

    it('revokes every session opened under the old password', async () => {
      const { agent, email, client } = await registerUser('r5@example.com');
      await agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', client)
        .expect(200);
      mail.clear();

      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);
      await post('/auth/reset-password', freshClient())
        .send({
          token: mail.tokenFrom('reset-password'),
          newPassword: NEW_PASSWORD,
        })
        .expect(204);

      await agent
        .post('/auth/refresh')
        .set('X-Forwarded-For', client)
        .expect(401);
    });

    it('counts as confirming the address', async () => {
      const token = await requestReset('r6@example.com');

      await post('/auth/reset-password', freshClient())
        .send({ token, newPassword: NEW_PASSWORD })
        .expect(204);

      // clicking a link we mailed is exactly the proof verification asks for
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: 'r6@example.com' },
      });
      expect(user.emailVerifiedAt).not.toBeNull();
    });

    it('refuses a verification token — purposes are not interchangeable', async () => {
      await registerUser('r7@example.com');
      const verificationToken = mail.tokenFrom('verify-email');

      await post('/auth/reset-password', freshClient())
        .send({ token: verificationToken, newPassword: NEW_PASSWORD })
        .expect(400);

      // and the password really is untouched
      await login('r7@example.com', PASSWORD, freshClient()).expect(200);
    });
  });

  // ---------------------------------------------------------------------------

  describe('email verification', () => {
    it('mails a confirmation link on registration', async () => {
      await registerUser('v1@example.com');

      expect(mail.to('v1@example.com')).toHaveLength(1);
      expect(mail.last?.text).toMatch(/verify-email\?token=/);
    });

    it('starts unverified and flips once the link is used', async () => {
      const { agent, client } = await registerUser('v2@example.com');
      const token = mail.tokenFrom('verify-email');

      const before = await agent.get('/auth/me').set('X-Forwarded-For', client);
      expect(
        (before.body as { emailVerifiedAt: string | null }).emailVerifiedAt,
      ).toBeNull();

      await post('/auth/verify-email', freshClient())
        .send({ token })
        .expect(204);

      const after = await agent.get('/auth/me').set('X-Forwarded-For', client);
      expect(
        (after.body as { emailVerifiedAt: string | null }).emailVerifiedAt,
      ).not.toBeNull();
    });

    it('is public — the link is clicked from a mail client, not a session', async () => {
      await registerUser('v3@example.com');
      const token = mail.tokenFrom('verify-email');

      // no cookies on this request at all
      await post('/auth/verify-email', freshClient())
        .send({ token })
        .expect(204);
    });

    it('works exactly once', async () => {
      await registerUser('v4@example.com');
      const token = mail.tokenFrom('verify-email');

      await post('/auth/verify-email', freshClient())
        .send({ token })
        .expect(204);
      await post('/auth/verify-email', freshClient())
        .send({ token })
        .expect(400);
    });

    it('refuses a reset token — purposes are not interchangeable', async () => {
      const { email } = await registerUser('v5@example.com');
      mail.clear();
      await post('/auth/forgot-password', freshClient())
        .send({ email })
        .expect(202);

      await post('/auth/verify-email', freshClient())
        .send({ token: mail.tokenFrom('reset-password') })
        .expect(400);

      const user = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user.emailVerifiedAt).toBeNull();
    });

    describe('resend', () => {
      it('requires a session — it has no address parameter to abuse', async () => {
        await post('/auth/verify-email/resend', freshClient()).expect(401);
      });

      it('sends nothing while the cooldown from registration is live', async () => {
        const { agent, client } = await registerUser('v6@example.com');
        expect(mail.to('v6@example.com')).toHaveLength(1);

        await agent
          .post('/auth/verify-email/resend')
          .set('X-Forwarded-For', client)
          .expect(202);

        expect(mail.to('v6@example.com')).toHaveLength(1);
      });

      it('sends again once the cooldown has passed', async () => {
        const { agent, client } = await registerUser('v7@example.com');
        await prisma.verificationToken.updateMany({
          data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
        });

        await agent
          .post('/auth/verify-email/resend')
          .set('X-Forwarded-For', client)
          .expect(202);

        expect(mail.to('v7@example.com')).toHaveLength(2);
      });

      it('sends nothing to an already-confirmed address', async () => {
        const { agent, client } = await registerUser('v8@example.com');
        await post('/auth/verify-email', freshClient())
          .send({ token: mail.tokenFrom('verify-email') })
          .expect(204);
        mail.clear();

        // aged, so only the already-verified check can be what stops this
        await prisma.verificationToken.updateMany({
          data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
        });
        await agent
          .post('/auth/verify-email/resend')
          .set('X-Forwarded-For', client)
          .expect(202);

        expect(mail.sent).toHaveLength(0);
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('rate limiting', () => {
    const LIMIT = 5; // matches @Throttle on /auth/forgot-password

    it('allows the limit, then answers 429 with a Retry-After', async () => {
      const client = freshClient();

      for (let i = 0; i < LIMIT; i++) {
        await post('/auth/forgot-password', client)
          .send({ email: 'nobody@example.com' })
          .expect(202);
      }

      const blocked = await post('/auth/forgot-password', client)
        .send({ email: 'nobody@example.com' })
        .expect(429);

      expect(blocked.headers['retry-after']).toMatch(/^\d+$/);
      expect((blocked.body as { code: string }).code).toBe('RATE_LIMITED');
      expect((blocked.body as { message: string }).message).toMatch(
        /too many/i,
      );
    });

    it('counts each client separately', async () => {
      const noisy = freshClient();
      for (let i = 0; i <= LIMIT; i++) {
        await post('/auth/forgot-password', noisy).send({
          email: 'nobody@example.com',
        });
      }
      await post('/auth/forgot-password', noisy)
        .send({ email: 'nobody@example.com' })
        .expect(429);

      // an unrelated visitor must not inherit someone else's exhausted bucket
      await post('/auth/forgot-password', freshClient())
        .send({ email: 'nobody@example.com' })
        .expect(202);
    });

    it('buckets on the caller, never on the address being asked about', async () => {
      await registerUser('known@example.com');
      const client = freshClient();

      // Mixed known and unknown addresses. If the bucket key included the
      // email, these would land in different buckets and the pattern of 429s
      // would reveal which addresses exist — the enumeration oracle again.
      const addresses = [
        'known@example.com',
        'ghost1@example.com',
        'known@example.com',
        'ghost2@example.com',
        'known@example.com',
      ];
      for (const email of addresses) {
        await post('/auth/forgot-password', client).send({ email }).expect(202);
      }

      await post('/auth/forgot-password', client)
        .send({ email: 'ghost3@example.com' })
        .expect(429);
      await post('/auth/forgot-password', client)
        .send({ email: 'known@example.com' })
        .expect(429);
    });

    it('leaves unthrottled routes alone', async () => {
      const client = freshClient();

      // login has no @Throttle; 10 attempts must not start failing
      for (let i = 0; i < 10; i++) {
        await login('nobody@example.com', 'wrong', client).expect(401);
      }
    });
  });
});
