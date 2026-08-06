import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { TokenPurpose } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

/** Long enough that guessing is hopeless; base64url so it survives a URL. */
const TOKEN_BYTES = 32;

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  // short: a reset link is a live credential for the account
  PASSWORD_RESET: 60 * 60 * 1000,
  // longer: confirming an address is not urgent and people read mail late
  EMAIL_VERIFICATION: 24 * 60 * 60 * 1000,
};

@Injectable()
export class VerificationTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Issues a token and returns the raw value — the only moment it exists in
   * plaintext. Any outstanding token of the same purpose is consumed first, so
   * requesting a new link silently kills the old one rather than leaving a
   * widening set of valid credentials in someone's inbox.
   */
  async issue(userId: string, purpose: TokenPurpose): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    await this.prisma.$transaction([
      this.prisma.verificationToken.updateMany({
        where: { userId, purpose, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hash(token),
          expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
        },
      }),
    ]);

    return token;
  }

  /**
   * Spends a token, returning the user it belonged to, or null for anything
   * wrong — unknown, already used, expired, or issued for the other purpose.
   * The caller cannot distinguish those cases, and should not: each one means
   * "this link does not work", and saying more helps only an attacker.
   *
   * The read and the write happen in one transaction with the consume
   * conditional on still being unconsumed, so two simultaneous submissions of
   * the same link cannot both succeed.
   */
  async consume(
    rawToken: string,
    purpose: TokenPurpose,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.verificationToken.findUnique({
        where: { tokenHash: hash(rawToken) },
      });

      if (
        !existing ||
        existing.purpose !== purpose ||
        existing.consumedAt !== null ||
        existing.expiresAt.getTime() <= Date.now()
      ) {
        return null;
      }

      const spent = await tx.verificationToken.updateMany({
        // consumedAt in the WHERE, not just the SET: the loser of a race
        // updates 0 rows and is rejected
        where: { id: existing.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      return spent.count === 1 ? existing.userId : null;
    });
  }

  /** Used when a password changes by any other route. */
  async consumeAllFor(userId: string, purpose: TokenPurpose): Promise<void> {
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
