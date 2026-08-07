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
