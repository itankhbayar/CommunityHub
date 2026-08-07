import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { TokenPurpose } from '../generated/prisma/enums';
import { passwordResetMail, verifyEmailMail } from '../mail/mail.templates';
import { MailerService } from '../mail/mailer.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './auth.types';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { IssuedRefreshToken, TokenService } from './token.service';
import {
  RESEND_COOLDOWN_MS,
  VerificationTokenService,
} from './verification-token.service';

/**
 * OWASP's argon2id baseline. Tuned down would be faster; these are the
 * published minimums and login is not a hot path.
 */
const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

/**
 * Every /auth/forgot-password response is padded to this, because the work
 * behind it is not constant: a hit writes two rows, a miss does one lookup.
 * Measured on this stack the natural times were ~55ms and ~20ms — ranges that
 * do not overlap, so a single request revealed whether an address existed.
 *
 * The floor has to sit above the slowest real path with headroom, or it leaks
 * again under load. 250ms is comfortably clear and still imperceptible for a
 * form the user only submits once.
 */
const ENUMERATION_FLOOR_MS = 250;

/** Sleeps until `startedAt + floor`, or returns immediately if already past. */
async function padTo(startedAt: number, floorMs: number): Promise<void> {
  const remaining = floorMs - (Date.now() - startedAt);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

export interface AuthSession {
  user: AuthenticatedUser;
  accessToken: string;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly verificationTokens: VerificationTokenService,
    private readonly mailer: MailerService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthSession> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    // Registration cannot avoid disclosing that an email is taken — the user
    // needs to know. Login stays deliberately vague instead.
    if (existing) {
      throw new ConflictException('That email is already registered.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        displayName: dto.displayName,
        passwordHash: await argon2.hash(dto.password, ARGON2_OPTIONS),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        globalRole: true,
      },
    });

    // Not awaited, and failures are swallowed after logging: the account
    // already exists, so turning an SMTP or database hiccup into a 500 would
    // tell the user registration failed when it did not. They land unverified,
    // see the banner, and can resend. MailerService already logs rather than
    // throwing; the catch covers issuing the token.
    void this.sendVerificationMail(user.id, user.email).catch((error) =>
      this.logger.error(
        `Could not send the verification email for ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      ),
    );

    return this.startSession(user);
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // Same message and roughly the same work for "no such user" and "wrong
    // password", so the response cannot be used to enumerate accounts.
    if (!user) {
      await argon2.hash(dto.password, ARGON2_OPTIONS);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    return this.startSession({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      globalRole: user.globalRole,
    });
  }

  async refresh(rawToken: string): Promise<AuthSession> {
    const { userId, refresh } = await this.tokens.rotate(rawToken);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, globalRole: true },
    });

    if (!user) {
      // account deleted while a refresh token was still live
      await this.tokens.revokeFamily(refresh.familyId);
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    return {
      user,
      accessToken: this.tokens.signAccessToken(user.id),
      refresh,
    };
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (rawToken) {
      await this.tokens.revokeFamilyByToken(rawToken);
    }
  }

  /**
   * Changing a password requires proving you know the current one, which is
   * what makes this safe without email: a stolen but unlocked session cannot
   * be used to lock the real owner out.
   *
   * Every existing refresh token for the user is revoked — including the
   * caller's own — and a fresh session is issued to whoever made this request.
   * The practical effect is "signed out everywhere except here".
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<AuthSession> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      throw new UnauthorizedException('Your current password is incorrect.');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'Your new password must be different from the current one.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(dto.newPassword, ARGON2_OPTIONS),
      },
    });

    await this.tokens.revokeAllForUser(userId);

    // a reset link mailed before this change would otherwise still work and
    // could undo it — the password moved, so anything that could set it is stale
    await this.verificationTokens.consumeAllFor(
      userId,
      TokenPurpose.PASSWORD_RESET,
    );

    return this.startSession({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      globalRole: user.globalRole,
    });
  }

  /**
   * Mails a reset link, and says nothing about whether the address exists.
   *
   * The controller returns 202 unconditionally. This is the counterpart to
   * login's deliberate vagueness: an endpoint that 404s on unknown addresses
   * is an account-enumeration oracle, and one that only *delays* on known ones
   * is a slower oracle. Every path therefore returns the same status after the
   * same padded duration — including the cooldown path below, which is faster
   * than a real send and would otherwise be the loudest signal of the three.
   */
  async requestPasswordReset(dto: ForgotPasswordDto): Promise<void> {
    const startedAt = Date.now();

    try {
      const user = await this.prisma.user.findUnique({
        where: { email: dto.email },
        select: { id: true, email: true },
      });

      if (!user) return;

      const token = await this.verificationTokens.issue(
        user.id,
        TokenPurpose.PASSWORD_RESET,
        RESEND_COOLDOWN_MS.PASSWORD_RESET,
      );

      // null means a link was mailed moments ago and is still live. Sending
      // another would only help someone bombing this inbox; the response stays
      // 202 either way, so a real user cannot tell and neither can an attacker.
      if (!token) return;

      // not awaited: SMTP latency is attacker-visible and varies with the
      // provider, so it must not be inside the timed window. MailerService
      // never rejects — it logs failures — so this cannot orphan a rejection.
      void this.mailer.send(passwordResetMail(user.email, token));
    } finally {
      await padTo(startedAt, ENUMERATION_FLOOR_MS);
    }
  }

  /**
   * Spends a reset token and sets the new password.
   *
   * Every refresh token for the user is revoked: the point of a reset is that
   * the old credential is no longer trusted, and a session minted under it
   * must not outlive it. No session is issued in exchange — whoever clicked
   * the link has proved control of the inbox, not that they are at a device
   * we should silently sign in, so they land on the login form.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const userId = await this.verificationTokens.consume(
      dto.token,
      TokenPurpose.PASSWORD_RESET,
    );

    if (!userId) {
      throw new BadRequestException(
        'This reset link is invalid or has expired. Request a new one.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await argon2.hash(dto.newPassword, ARGON2_OPTIONS),
        // clicking a link we mailed proves control of the address, which is
        // exactly what verification asks for — so it counts
        emailVerifiedAt: new Date(),
      },
    });

    await this.tokens.revokeAllForUser(userId);
  }

  /**
   * Spends a verification token and marks the address confirmed.
   *
   * Public, because the whole point is that it works from a mail client on a
   * device that was never signed in. The token is the entire authorisation —
   * which is safe here because confirming an address grants nothing beyond
   * eligibility for password reset.
   *
   * Deliberately idempotent-feeling but not idempotent: the token is single
   * use, so a second click on the same link reports failure. The account stays
   * verified, and the UI says so rather than implying something broke.
   */
  async verifyEmail(dto: VerifyEmailDto): Promise<void> {
    const userId = await this.verificationTokens.consume(
      dto.token,
      TokenPurpose.EMAIL_VERIFICATION,
    );

    if (!userId) {
      throw new BadRequestException(
        'This confirmation link is invalid or has expired. Request a new one from your account page.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  /**
   * Re-sends the confirmation mail to the caller's own address.
   *
   * Authenticated, so unlike forgot-password there is nothing to leak — the
   * caller already knows this account exists. It still goes through the same
   * per-account cooldown, because the thing being rationed is messages landing
   * in an inbox, and that is worth protecting from a stolen session too.
   */
  async resendVerification(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, emailVerifiedAt: true },
    });

    // already done — sending again would only be confusing
    if (!user || user.emailVerifiedAt) return;

    await this.sendVerificationMail(user.id, user.email);
  }

  /** Issues a confirmation token and mails it, unless one just went out. */
  private async sendVerificationMail(
    userId: string,
    email: string,
  ): Promise<void> {
    const token = await this.verificationTokens.issue(
      userId,
      TokenPurpose.EMAIL_VERIFICATION,
      RESEND_COOLDOWN_MS.EMAIL_VERIFICATION,
    );

    if (token) await this.mailer.send(verifyEmailMail(email, token));
  }

  /** `/auth/me` — identity plus the memberships the UI needs to render roles. */
  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        globalRole: true,
        createdAt: true,
        // drives the advisory banner; null means the address is unconfirmed
        emailVerifiedAt: true,
        memberships: {
          select: {
            role: true,
            joinedAt: true,
            community: {
              select: { id: true, slug: true, name: true, visibility: true },
            },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    return user;
  }

  private async startSession(user: AuthenticatedUser): Promise<AuthSession> {
    return {
      user,
      accessToken: this.tokens.signAccessToken(user.id),
      refresh: await this.tokens.issueRefreshToken(user.id),
    };
  }
}
