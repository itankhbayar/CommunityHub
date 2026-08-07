import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, trustProxyHops } from './app-setup';

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

/**
 * Compiles one allowlist entry into a matcher. An entry containing `*` becomes
 * a pattern; anything else stays an exact string comparison.
 *
 * This exists for Vercel, which serves the same app from three hostname shapes:
 * a stable production alias, a per-branch alias, and a per-deployment URL whose
 * hash changes on every push. The third cannot be enumerated ahead of time, so
 * without patterns every preview deploy is a CORS failure.
 *
 * `*` deliberately matches within a single label only (no dots). A pattern like
 * `https://*.vercel.app` must not be satisfiable by `https://evil.attacker.com`
 * — and, just as importantly, scoping the wildcard to the account-specific
 * suffix keeps it from matching *anyone else's* vercel.app deployment, since
 * that domain is open to the public.
 */
function originMatcher(entry: string): (origin: string) => boolean {
  if (!entry.includes('*')) return (origin) => origin === entry;

  const pattern = new RegExp(
    `^${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^./]*')}$`,
  );
  return (origin) => pattern.test(origin);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // sets the ValidationPipe, cookie parsing, the error filter, and trust proxy
  configureApp(app);

  const matchers = corsOrigins().map(originMatcher);

  app.enableCors({
    // Callback rather than a string list, so entries can be patterns. Requests
    // with no Origin (curl, server-to-server, same-origin navigations) are
    // allowed through; CORS only governs browser cross-origin calls, and
    // rejecting them here would break health probes for no security gain.
    // annotated explicitly: the `origin` option is a union, so it gives the
    // callback form no contextual typing
    origin: (
      requestOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) =>
      callback(
        null,
        !requestOrigin || matchers.some((matches) => matches(requestOrigin)),
      ),
    credentials: true, // required for the browser to send auth cookies
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  // The allowlist is invisible from outside — a rejected origin just omits a
  // response header — so state it at boot. Diagnosing a CORS failure against a
  // healthy-looking API is otherwise pure guesswork.
  console.log(`[cors] allowed origins: ${corsOrigins().join(', ')}`);
  // equally invisible from outside, and equally miserable to debug wrong
  const hops = trustProxyHops();
  console.log(
    hops > 0
      ? `[proxy] trusting ${hops} proxy hop(s) for client IPs`
      : '[proxy] not behind a proxy — client IPs read from the socket',
  );
}

void bootstrap();
