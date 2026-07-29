import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Shared by main.ts and the e2e suite so tests exercise the same pipeline that
 * runs in production — a validation rule that only exists in main.ts is a rule
 * the tests silently never check.
 */
export function configureApp(app: INestApplication): INestApplication {
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
