import { TokenScope } from '@swag/protocol';
import { z } from 'zod';

/** Who is calling, as proven by the access token. Never taken from the request body. */
export const PrincipalClaims = z.object({
  sub: z.uuid(),
  fam: z.uuid(),
  scope: TokenScope,
  /** Device the token is bound to: the tablet for device/child scope, the phone for parents. */
  dev: z.uuid().optional(),
});
export type Principal = z.infer<typeof PrincipalClaims>;

export const ACCESS_TTL_SECONDS = { parent: 15 * 60, device: 15 * 60, child: 30 * 60 } as const;
export const REFRESH_TTL_DAYS = 60;
