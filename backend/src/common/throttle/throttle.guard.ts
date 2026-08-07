import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { THROTTLE_KEY, ThrottlePolicy } from './throttle.decorator';

/** How often expired windows are swept out of the map. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Above this many tracked clients an insert forces an early sweep. The map is
 * keyed by caller-influenced data, so without a ceiling a distributed flood
 * turns the limiter itself into the memory-exhaustion vector it exists to stop.
 */
const SWEEP_THRESHOLD = 10_000;

interface Window {
  count: number;
  /** epoch ms at which this window resets */
  expiresAt: number;
}

/**
 * Fixed-window request limiter.
 *
 * **Per process, in memory.** Counts reset on restart and are not shared
 * between instances, so N replicas allow N times the configured limit. That is
 * a deliberate tradeoff: the alternative is a Redis dependency, and this API
 * runs as a single instance. Anything relying on a hard global cap needs a
 * shared store instead — see the README.
 *
 * Fixed rather than sliding windows means up to 2x the limit can land across a
 * boundary. For the endpoints this protects — which exist to slow down abuse,
 * not to meter a paid quota — that is fine and the bookkeeping is far cheaper.
 */
@Injectable()
export class ThrottleGuard implements CanActivate, OnModuleDestroy {
  private readonly windows = new Map<string, Window>();
  private readonly sweeper: NodeJS.Timeout;

  constructor(private readonly reflector: Reflector) {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    // never hold the event loop open on account of the limiter
    this.sweeper.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
  }

  canActivate(context: ExecutionContext): boolean {
    const policy = this.reflector.getAllAndOverride<ThrottlePolicy | undefined>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    // Keyed by handler + client only — deliberately not by anything in the
    // body. Folding the submitted email in would make the 429 depend on which
    // address was asked for, handing back the enumeration oracle that
    // AuthService.requestPasswordReset works to close.
    const key = `${context.getClass().name}.${context.getHandler().name}|${clientOf(request)}`;

    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.expiresAt <= now) {
      if (this.windows.size >= SWEEP_THRESHOLD) this.sweep();
      this.windows.set(key, { count: 1, expiresAt: now + policy.windowMs });
      return true;
    }

    existing.count += 1;
    if (existing.count > policy.limit) {
      const retryAfter = Math.ceil((existing.expiresAt - now) / 1000);
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'RATE_LIMITED',
          message: `Too many attempts. Try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, window] of this.windows) {
      if (window.expiresAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Express resolves `req.ip` from X-Forwarded-For only when `trust proxy` is
 * set, which main.ts gates behind TRUST_PROXY. Getting that setting wrong in
 * either direction breaks this guard — see the note there — so fall back to the
 * socket address rather than to a shared constant.
 */
function clientOf(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}
