import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TokenScope } from '@swag/protocol';
import { ApiError } from '../common/api-error';
import { type AuthedRequest, IS_PUBLIC, SCOPES } from './decorators';
import { KeysService } from './keys.service';
import { TokensService } from './tokens.service';

/** Global guard: every HTTP route needs a valid Bearer token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: KeysService,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true; // sockets authenticate in the gateway
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const principal = token ? await this.keys.verify(token) : null;
    if (!principal) throw ApiError.unauthenticated();
    if (await this.tokens.isRevoked(principal)) throw ApiError.unauthenticated('Device was signed out');

    const allowed = this.reflector.getAllAndOverride<TokenScope[]>(SCOPES, targets) ?? ['parent'];
    if (!allowed.includes(principal.scope)) throw ApiError.forbidden();

    req.principal = principal;
    return true;
  }
}
