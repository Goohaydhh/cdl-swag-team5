import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode } from '@swag/protocol';
import type { Response } from 'express';

const statusToCode: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN_SCOPE,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.VALIDATION,
  429: ErrorCode.RATE_LIMITED,
};

const isApiErrorBody = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  typeof (body as { error?: unknown }).error === 'object' &&
  (body as { error: unknown }).error !== null;

/** Normalises every HTTP error to `{ error: { code, message } }` and hides internals on 500s. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (isApiErrorBody(body)) {
        res.status(status).json(body);
        return;
      }
      const message =
        typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
      res.status(status).json({
        error: {
          code: statusToCode[status] ?? ErrorCode.INTERNAL,
          message: Array.isArray(message) ? message.join('; ') : String(message),
        },
      });
      return;
    }

    // Express body-parser errors (too large, malformed JSON) carry a safe 4xx status.
    const clientStatus = (exception as { status?: unknown; expose?: unknown }).status;
    if (typeof clientStatus === 'number' && clientStatus >= 400 && clientStatus < 500) {
      res.status(clientStatus).json({
        error: {
          code: statusToCode[clientStatus] ?? ErrorCode.VALIDATION,
          message: clientStatus === 413 ? 'Request body too large' : 'Malformed request body',
        },
      });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { code: ErrorCode.INTERNAL, message: 'Internal server error' } });
  }
}
