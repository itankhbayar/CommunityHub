import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const body = res.body as { status: string };
    expect(body.status).toBe('ok');
  });

  it('reports the deployment settings that otherwise fail silently', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const { config } = res.body as {
      config: {
        mail: { configured: boolean; host: string | null };
        trustProxyHops: number;
        appUrl: string | null;
      };
    };

    // setup-env.ts forces SMTP_HOST='' for the suite, so this is the disabled
    // shape — which is exactly the one production must be able to reveal
    expect(config.mail).toEqual({ configured: false, host: null });
    expect(typeof config.trustProxyHops).toBe('number');
    expect(config).toHaveProperty('appUrl');
  });

  it('never exposes credentials', async () => {
    process.env.SMTP_PASSWORD = 'super-secret-smtp-key';
    process.env.SMTP_USER = 'secret-login@smtp.example.com';

    const res = await request(app.getHttpServer()).get('/health').expect(200);
    const serialized = JSON.stringify(res.body);

    // This endpoint is @Public and unauthenticated. Reporting a boolean and a
    // hostname is the point; leaking the key would be a far worse bug than the
    // silent misconfiguration this was added to diagnose.
    expect(serialized).not.toContain('super-secret-smtp-key');
    expect(serialized).not.toContain('secret-login@smtp.example.com');
    expect(serialized).not.toMatch(/password/i);
  });
});
