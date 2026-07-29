import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

const DEFAULT_ORIGIN = 'http://localhost:3000';

/**
 * Parses CORS_ORIGIN into an allowlist.
 *
 * Deliberately not `process.env.CORS_ORIGIN ?? DEFAULT`: hosting platforms
 * materialize a declared-but-unfilled variable as an empty string, which `??`
 * happily passes through — `''.split(',')` is `['']`, an allowlist matching no
 * origin at all. The API then looks perfectly healthy while every browser
 * request fails, which is a miserable thing to debug. Blank means unset here.
 *
 * Entries are trimmed and stripped of trailing slashes because
 * `https://app.vercel.app/` pasted from a browser bar must not silently fail
 * to match the `https://app.vercel.app` origin a browser actually sends.
 */
function corsOrigins(): string[] {
  const parsed = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return parsed.length > 0 ? parsed : [DEFAULT_ORIGIN];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  app.enableCors({
    origin: corsOrigins(),
    credentials: true, // required for the browser to send auth cookies
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  // The allowlist is invisible from outside — a rejected origin just omits a
  // response header — so state it at boot. Diagnosing a CORS failure against a
  // healthy-looking API is otherwise pure guesswork.
  console.log(`[cors] allowed origins: ${corsOrigins().join(', ')}`);
}

void bootstrap();
