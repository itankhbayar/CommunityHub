import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Application } from 'express';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * How many reverse proxies sit in front of this process, which is how Express
 * decides what `req.ip` means. ThrottleGuard keys its buckets on that value, so
 * both mistakes are real and neither is visible at runtime:
 *
 * - Left at 0 behind a proxy, every request appears to come from the proxy.
 * All clients share one bucket and the limiter locks out the whole world at
 * once.
 * - Set above 0 with no proxy in front, X-Forwarded-For is attacker-controlled.
 * A fresh header per request means a fresh bucket per request, and the limiter
 * does nothing at all.
 *
 * Default 0 is correct for `docker compose up`, where the browser reaches the
 * API directly. Render terminates TLS at one proxy hop, so its env sets 1.
 */
export function trustProxyHops(): number {
  const parsed = Number(process.env.TRUST_PROXY ?? '');
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Shared by main.ts and the e2e suite so tests exercise the same pipeline that
 * runs in production — a validation rule that only exists in main.ts is a rule
 * the tests silently never check.
 */
export function configureApp(app: INestApplication): INestApplication {
  // Lives here rather than in main.ts precisely because of the note above: a
  // setting that decides what req.ip means is one the tests have to share, or
  // the rate limiter is exercised against a client identity that only the test
  // process ever sees.
  const hops = trustProxyHops();
  // cast rather than getInstance<Application>(): this Nest version types the
  // method with no parameter, so the generic form is a compile error
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  // `false` rather than `0`: Express treats the number 0 as "trust nothing"
  // too, but only the boolean turns the X-Forwarded-For machinery off outright.
  expressApp.set('trust proxy', hops > 0 ? hops : false);

  // auth tokens arrive as httpOnly cookies, so they must be parsed before guards run
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // reject unknown fields outright rather than silently dropping them —
      // a typo'd field name should fail loudly, not half-apply a request
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}
