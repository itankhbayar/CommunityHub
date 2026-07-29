import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';

export interface ErrorEnvelope {
  statusCode: number;
  /** stable, machine-readable; clients branch on this, never on the message */
  code: string;
  /** safe to render directly in the UI */
  message: string;
  /** field-level validation problems, when there are any */
  details?: string[];
  path: string;
  timestamp: string;
}

/**
 * Single exit point for every error the API produces, so clients only ever see
 * one shape and never a stack trace. Unrecognised failures are logged in full
 * server-side and reported to the caller as a generic 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, code, message, details } = this.translate(exception);

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorEnvelope = {
      statusCode,
      code,
      message,
      ...(details?.length ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private translate(exception: unknown): {
    statusCode: number;
    code: string;
    message: string;
    details?: string[];
  } {
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our end. Please try again.',
    };
  }

  private fromHttpException(exception: HttpException): {
    statusCode: number;
    code: string;
    message: string;
    details?: string[];
  } {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    // ValidationPipe throws a BadRequest whose `message` is a string[]
    if (typeof payload === 'object' && payload !== null) {
      const shaped = payload as {
        message?: string | string[];
        code?: string;
        error?: string;
      };

      if (Array.isArray(shaped.message)) {
        return {
          statusCode,
          code: shaped.code ?? 'VALIDATION_FAILED',
          message: 'Some fields need attention.',
          details: shaped.message,
        };
      }

      return {
        statusCode,
        code: shaped.code ?? defaultCodeFor(statusCode),
        message: shaped.message ?? exception.message,
      };
    }

    return {
      statusCode,
      code: defaultCodeFor(statusCode),
      message: typeof payload === 'string' ? payload : exception.message,
    };
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    code: string;
    message: string;
  } {
    switch (exception.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          code: 'ALREADY_EXISTS',
          message: 'That already exists.',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Not found.',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          code: 'INVALID_REFERENCE',
          message: 'That refers to something which no longer exists.',
        };
      default:
        this.logger.error(`Unhandled Prisma error ${exception.code}`);
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong on our end. Please try again.',
        };
    }
  }
}

function defaultCodeFor(statusCode: HttpStatus): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    default:
      return 'ERROR';
  }
}
