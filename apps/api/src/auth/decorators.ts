import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { TokenScope } from '@swag/protocol';
import type { Request } from 'express';
import type { Principal } from './principal';

export const IS_PUBLIC = 'swag:isPublic';
export const SCOPES = 'swag:scopes';

/** No access token required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Token scopes allowed on a route. Routes without @Scopes accept parents only. */
export const Scopes = (...scopes: TokenScope[]) => SetMetadata(SCOPES, scopes);

export type AuthedRequest = Request & { principal: Principal };

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<AuthedRequest>().principal,
);

/** Client IP, honouring TRUST_PROXY_HOPS. */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest<Request>().ip ?? 'unknown',
);
