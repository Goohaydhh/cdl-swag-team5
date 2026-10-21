import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type LoginInput, type RegisterInput } from '@swag/protocol';
import { ApiError } from '../common/api-error';
import { AuditService } from '../common/audit.service';
import { burnPasswordCheck, hashPassword, newId, verifySecret } from '../common/crypto';
import { RateLimitService } from '../common/rate-limit.service';
import type { Prisma, User } from '../generated/prisma/client';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import type { Principal } from './principal';
import { type ParentTokens, TokensService } from './tokens.service';

type ParentDevice = RegisterInput['device'];

export interface AuthResult {
  user: ReturnType<typeof toUserDto>;
  tokens: ParentTokens;
}

export function toUserDto(user: User) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    family_id: user.familyId,
    is_owner: user.isOwner,
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput, ip: string): Promise<AuthResult> {
    await this.rateLimit.consume(`register-ip:${ip}`, 10, 3600);
    const passwordHash = await hashPassword(input.password);
    const familyId = newId();
    const userId = newId();

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        await tx.family.create({ data: { id: familyId, name: input.family_name } });
        return tx.user.create({
          data: {
            id: userId,
            familyId,
            email: input.email,
            passwordHash,
            displayName: input.display_name,
            isOwner: true,
            consentAt: new Date(),
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw ApiError.conflict('An account already uses this email');
      throw err;
    }

    await this.audit.log({ familyId, actorType: 'user', actorId: userId, action: 'auth.register' });
    return this.signIn(user, input.device);
  }

  async login(input: LoginInput, ip: string): Promise<AuthResult> {
    await this.rateLimit.consume(`login-ip:${ip}`, 50, 900);
    await this.rateLimit.consume(`login-email:${input.email}`, 10, 900);

    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const valid = user
      ? await verifySecret(user.passwordHash, input.password)
      : await burnPasswordCheck(input.password);
    if (!user || !valid) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.INVALID_CREDENTIALS,
        'Email or password is incorrect',
      );
    }

    await this.rateLimit.reset(`login-email:${input.email}`);
    await this.audit.log({
      familyId: user.familyId,
      actorType: 'user',
      actorId: user.id,
      action: 'auth.login',
    });
    return this.signIn(user, input.device);
  }

  /** Signs out: revokes the refresh-token chain and, for a phone session, the phone itself. */
  async logout(principal: Principal, refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeRefreshToken(refreshToken, principal.sub);
    if (principal.dev) {
      await this.prisma.device.updateMany({
        where: { id: principal.dev, familyId: principal.fam, kind: 'parent_phone' },
        data: { revokedAt: new Date(), pushToken: null },
      });
      await this.tokens.markDeviceRevoked(principal.dev);
    }
  }

  /** Records the parent's phone (for push) and issues tokens bound to it. */
  async signIn(user: User, device: ParentDevice, tx: Prisma.TransactionClient = this.prisma) {
    const deviceId = device ? await this.rememberPhone(user, device, tx) : undefined;
    return { user: toUserDto(user), tokens: await this.tokens.issueParentTokens(user, deviceId) };
  }

  /**
   * One row per physical phone, not one per sign-in. The phone sends a stable `install_id`,
   * so signing in again (after a lost connection, or after signing out) updates its existing
   * "Appareil" instead of adding another one to the family — the test on 21/10/2026 ended up
   * with eleven "Téléphone Android" in one family.
   *
   * A phone that sends no `install_id` keeps the old behaviour: a fresh row each time.
   */
  private async rememberPhone(
    user: User,
    device: NonNullable<ParentDevice>,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const platformInfo = (device.platform ?? {}) as Prisma.InputJsonObject;
    if (device.install_id) {
      const known = await tx.device.findFirst({
        where: {
          familyId: user.familyId,
          ownerUserId: user.id,
          kind: 'parent_phone',
          installId: device.install_id,
        },
        orderBy: { createdAt: 'desc' },
      });
      if (known) {
        // `revokedAt` is cleared because this row is this phone again: it was set when the
        // parent signed out, and the tokens issued below are bound to this same device id.
        await tx.device.update({
          where: { id: known.id },
          data: { name: device.name, platformInfo, lastSeenAt: new Date(), revokedAt: null },
        });
        await this.tokens.clearDeviceRevoked(known.id);
        return known.id;
      }
    }

    const deviceId = newId();
    await tx.device.create({
      data: {
        id: deviceId,
        familyId: user.familyId,
        kind: 'parent_phone',
        ownerUserId: user.id,
        name: device.name,
        platformInfo,
        installId: device.install_id ?? null,
        lastSeenAt: new Date(),
      },
    });
    return deviceId;
  }
}
