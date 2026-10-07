import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@swag/protocol';

/** Every REST error leaves the API as `{ error: { code, message } }`. */
export class ApiError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    readonly detail: string,
  ) {
    super({ error: { code, message: detail } }, status);
  }

  static notFound(what = 'Resource') {
    return new ApiError(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found`);
  }

  static unauthenticated(message = 'Authentication required') {
    return new ApiError(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message);
  }

  static forbidden(message = 'Not allowed for this token') {
    return new ApiError(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN_SCOPE, message);
  }

  static conflict(message: string) {
    return new ApiError(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
  }

  static validation(message: string) {
    return new ApiError(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION, message);
  }

  static rateLimited() {
    return new ApiError(
      HttpStatus.TOO_MANY_REQUESTS,
      ErrorCode.RATE_LIMITED,
      'Too many attempts, try again later',
    );
  }
}
