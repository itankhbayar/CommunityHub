import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { IssuedRefreshToken, TokenService } from './token.service';

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

export interface AuthSession {
  user: AuthenticatedUser;
  accessToken: string;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
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
