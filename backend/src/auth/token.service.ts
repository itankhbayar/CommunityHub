import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AccessTokenPayload } from './auth.types';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
  familyId: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  get accessTokenTtlMs(): number {
    return parseDuration(process.env.JWT_ACCESS_TTL ?? '15m');
  }

  private get refreshTtlDays(): number {
    return Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
  }

  signAccessToken(userId: string): string {
    const payload: AccessTokenPayload = { sub: userId };
    return this.jwt.sign(payload);
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      return this.jwt.verify<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Your session has expired.');
    }
  }

  /**
   * Refresh tokens are opaque random strings, not JWTs: they must be
   * revocable, and only a value stored server-side can be. We keep the sha256
   * of the token, so a database leak does not hand over usable sessions.
   */
  async issueRefreshToken(
    userId: string,
    familyId = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hash(token), familyId, expiresAt },
    });

    return { token, expiresAt, familyId };
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a fresh one
   * issued in the same family.
   *
   * Presenting an already-revoked token means either an attacker replaying a
   * stolen token or the legitimate client replaying an old one — indistinguishable
   * from here, so the whole family is revoked and everyone has to log in again.
   */
  async rotate(
    rawToken: string,
  ): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(rawToken) },
    });

    if (!existing) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    if (existing.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${existing.userId}; revoking family ${existing.familyId}`,
      );
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Your session has expired.');
    }

    // Revoke-then-issue in one transaction: a crash between the two would
    // otherwise leave the caller holding a token that no longer works.
    const refresh = await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });

      const token = randomBytes(48).toString('base64url');
      const expiresAt = new Date(
        Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
      );

      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          tokenHash: hash(token),
          familyId: existing.familyId,
          expiresAt,
        },
      });

      return { token, expiresAt, familyId: existing.familyId };
    });

    return { userId: existing.userId, refresh };
  }

  /** Logout revokes the entire family, not just the presented token. */
  async revokeFamilyByToken(rawToken: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash(rawToken) },
      select: { familyId: true },
    });

    if (existing) {
      await this.revokeFamily(existing.familyId);
    }
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Every session for one user, across all families and devices. Used when the
   * password changes: whoever knew the old one must not keep a live session
   * just because they refreshed recently.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Supports the `15m` / `2h` / `7d` / `30s` forms used in env config. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: "${value}"`);
  }

  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * multipliers[unit];
}
