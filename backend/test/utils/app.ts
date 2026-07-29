import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app-setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestApp {
  // typed with App so supertest(app.getHttpServer()) stays type-safe
  app: INestApplication<App>;
  prisma: PrismaService;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    close: () => app.close(),
  };
}

/** Clears every table. User and Community are the roots; cascade does the rest. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.refreshToken.deleteMany();
  await prisma.community.deleteMany();
  await prisma.user.deleteMany();
}
