import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TokenService } from './token.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_ACCESS_SECRET;
        if (!secret) {
          // fail at boot rather than signing tokens with `undefined`
          throw new Error('JWT_ACCESS_SECRET is not set');
        }
        // jsonwebtoken types expiresIn as a template-literal union, which a
        // plain env string cannot satisfy without a cast
        const expiresIn = (process.env.JWT_ACCESS_TTL ??
          '15m') as JwtSignOptions['expiresIn'];

        return { secret, signOptions: { expiresIn } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    // Authentication is global and opt-out (@Public), so a new controller is
    // protected by default instead of by remembering to add a guard.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService],
})
export class AuthModule {}
