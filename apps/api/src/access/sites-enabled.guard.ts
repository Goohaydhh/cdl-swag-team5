import { CanActivate, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { ENV, type Env } from '../config/env';

/** The "Sites" feature is paused (product decision); FEATURE_SITES=true turns it back on. */
@Injectable()
export class SitesEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(): boolean {
    if (!this.env.FEATURE_SITES) throw ApiError.notFound('Route');
    return true;
  }
}
