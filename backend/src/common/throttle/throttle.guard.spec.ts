import 'reflect-metadata';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle } from './throttle.decorator';
import { ThrottleGuard } from './throttle.guard';

const WINDOW_MS = 15 * 60 * 1000;

class TestController {
  @Throttle({ limit: 3, windowMs: WINDOW_MS })
  limited() {}

  @Throttle({ limit: 3, windowMs: WINDOW_MS })
  alsoLimited() {}

  unlimited() {}
}

interface CallOptions {
  handler?: keyof TestController;
  ip?: string;
  body?: unknown;
}

function contextFor({
  handler = 'limited',
  ip = '198.51.100.7',
  body = {},
}: CallOptions = {}) {
  const setHeader = jest.fn();
  const context = {
    getClass: () => TestController,
    // Unbound on purpose — Nest's real getHandler() hands back the same
    // detached reference, and both it and the guard use it only as a key to
    // read metadata off. It is never called.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    getHandler: () => TestController.prototype[handler],
    switchToHttp: () => ({
      getRequest: () => ({ ip, body, socket: { remoteAddress: ip } }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;

  return { context, setHeader };
}

describe('ThrottleGuard', () => {
  let guard: ThrottleGuard;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    guard = new ThrottleGuard(new Reflector());
  });

  afterEach(() => {
    guard.onModuleDestroy();
    jest.useRealTimers();
  });

  /** Calls the guard n times, returning the outcome of the last call. */
  function call(options?: CallOptions) {
    const { context, setHeader } = contextFor(options);
    try {
      return { allowed: guard.canActivate(context), setHeader };
    } catch (error) {
      return { error: error as HttpException, setHeader };
    }
  }

  it('leaves undecorated handlers alone', () => {
    for (let i = 0; i < 50; i++) {
      expect(call({ handler: 'unlimited' }).allowed).toBe(true);
    }
  });

  it('allows exactly the configured limit, then rejects with 429', () => {
    expect(call().allowed).toBe(true);
    expect(call().allowed).toBe(true);
    expect(call().allowed).toBe(true);

    const fourth = call();
    expect(fourth.error).toBeInstanceOf(HttpException);
    expect(fourth.error?.getStatus()).toBe(429);
    expect(fourth.error?.getResponse()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('tells the caller when to come back, in the body and the header', () => {
    for (let i = 0; i < 3; i++) call();
    jest.advanceTimersByTime(60_000); // one minute into the window

    const blocked = call();
    // 15 minute window, one minute spent
    expect(blocked.setHeader).toHaveBeenCalledWith('Retry-After', '840');
    expect((blocked.error?.getResponse() as { message: string }).message).toBe(
      'Too many attempts. Try again in 840 seconds.',
    );
  });

  it('recovers once the window passes', () => {
    for (let i = 0; i < 3; i++) call();
    expect(call().error).toBeDefined();

    jest.advanceTimersByTime(WINDOW_MS + 1);
    expect(call().allowed).toBe(true);
  });

  it('counts each client separately', () => {
    for (let i = 0; i < 4; i++) call({ ip: '198.51.100.7' });
    expect(call({ ip: '198.51.100.7' }).error).toBeDefined();

    // a different caller is unaffected by the first one's exhaustion
    expect(call({ ip: '203.0.113.9' }).allowed).toBe(true);
  });

  it('counts each handler separately', () => {
    for (let i = 0; i < 4; i++) call({ handler: 'limited' });
    expect(call({ handler: 'limited' }).error).toBeDefined();

    expect(call({ handler: 'alsoLimited' }).allowed).toBe(true);
  });

  // Regression guard for the enumeration fix: if the bucket key ever folded in
  // the submitted email, a 429 would depend on which address was asked about
  // and forgot-password would leak account existence again.
  it('ignores the request body when bucketing', () => {
    for (let i = 0; i < 3; i++) call({ body: { email: 'real@example.com' } });

    const other = call({ body: { email: 'unknown@example.com' } });
    expect(other.error).toBeDefined();
  });
});
