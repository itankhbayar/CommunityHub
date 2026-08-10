import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app-setup';
import { MailerService } from '../../src/mail/mailer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RecordingMailer } from './mail';

export interface TestApp {
  // typed with App so supertest(app.getHttpServer()) stays type-safe
  app: INestApplication<App>;
  prisma: PrismaService;
  /** captures what would have been emailed; see RecordingMailer */
  mail: RecordingMailer;
  close: () => Promise<void>;
}

/**
 * The client identity requests are attributed to, for rate limiting.
 *
 * Every supertest request otherwise arrives from 127.0.0.1, so all of a spec
 * file's tests share one bucket and the first to spend a limit fails every
 * test after it. Specs call setTestClient() in beforeEach to get isolation
 * without having to decorate each individual request.
 */
let testClientIp: string | null = null;

let clientCounter = 0;

/** A client address nothing else in the run will use. */
export function freshTestClient(): string {
  clientCounter += 1;
  const n = clientCounter;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export function setTestClient(ip: string | null): void {
  testClientIp = ip;
}

export async function createTestApp(): Promise<TestApp> {
  const mail = new RecordingMailer();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    // Swapped rather than pointed at a stub SMTP server: the assertions here
    // are about which messages the app decides to send, not about SMTP.
    .overrideProvider(MailerService)
    .useValue(mail)
    .compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);

  // Registered after configureApp so it runs before any guard. Only fills the
  // header in when a request did not set one itself, so a spec that needs
  // several requests to share a client — the rate-limit tests — still can.
  // setup-env.ts sets TRUST_PROXY=1 for Express to honour it.
  app.use(
    (
      req: { headers: Record<string, unknown> },
      _res: unknown,
      next: () => void,
    ) => {
      if (testClientIp && !req.headers['x-forwarded-for']) {
        req.headers['x-forwarded-for'] = testClientIp;
      }
      next();
    },
  );

  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    mail,
    close: () => app.close(),
  };
}

/** Clears every table. User and Community are the roots; cascade does the rest. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.community.deleteMany();
  // takes VerificationToken with it, which cascades on userId
  await prisma.user.deleteMany();
}
