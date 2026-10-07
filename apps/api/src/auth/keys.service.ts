import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  type CryptoKey,
  calculateJwkThumbprint,
  exportJWK,
  exportPKCS8,
  generateKeyPair,
  importJWK,
  importPKCS8,
  type JWTHeaderParameters,
  jwtVerify,
  SignJWT,
} from 'jose';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { newId } from '../common/crypto';
import { ENV, type Env } from '../config/env';
import { type Principal, PrincipalClaims } from './principal';

const ALG = 'ES256';
const ISSUER = 'swag-api';
const AUDIENCE = 'swag';

interface LoadedKey {
  kid: string;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/**
 * Signs and verifies access tokens (ES256). The key's JWK thumbprint is the `kid`.
 * Rotation (every 90 days): move the current key to JWT_PREVIOUS_KEY_PATH, put a new one at
 * JWT_PRIVATE_KEY_PATH; old tokens keep verifying until they expire (15-30 min), then drop it.
 */
@Injectable()
export class KeysService implements OnModuleInit {
  private readonly logger = new Logger(KeysService.name);
  private current: LoadedKey;
  private readonly verifyKeys = new Map<string, CryptoKey>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  async onModuleInit() {
    const path = resolve(this.env.JWT_PRIVATE_KEY_PATH);
    if (!existsSync(path)) {
      if (this.env.NODE_ENV === 'production') throw new Error(`JWT signing key not found at ${path}`);
      const pair = await generateKeyPair(ALG, { extractable: true });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, await exportPKCS8(pair.privateKey), { mode: 0o600 });
      this.logger.warn(`Generated a development JWT key at ${path}`);
    }
    this.current = await loadKey(readFileSync(path, 'utf8'));
    this.verifyKeys.set(this.current.kid, this.current.publicKey);

    if (this.env.JWT_PREVIOUS_KEY_PATH) {
      const previous = await loadKey(readFileSync(resolve(this.env.JWT_PREVIOUS_KEY_PATH), 'utf8'));
      this.verifyKeys.set(previous.kid, previous.publicKey);
    }
  }

  sign(claims: Principal, ttlSeconds: number): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: ALG, kid: this.current.kid, typ: 'JWT' })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .setJti(newId())
      .sign(this.current.privateKey);
  }

  /** Returns the principal, or null for any invalid, expired, unknown-key or malformed token. */
  async verify(token: string): Promise<(Principal & { exp: number }) | null> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header: JWTHeaderParameters) => {
          const key = header.kid ? this.verifyKeys.get(header.kid) : undefined;
          if (!key) throw new Error('unknown kid');
          return key;
        },
        { issuer: ISSUER, audience: AUDIENCE, algorithms: [ALG] },
      );
      const claims = PrincipalClaims.safeParse(payload);
      if (!claims.success || typeof payload.exp !== 'number') return null;
      return { ...claims.data, exp: payload.exp };
    } catch {
      return null;
    }
  }
}

async function loadKey(pem: string): Promise<LoadedKey> {
  const privateKey = await importPKCS8(pem, ALG, { extractable: true });
  const { d: _private, ...publicJwk } = await exportJWK(privateKey);
  return {
    kid: await calculateJwkThumbprint(publicJwk),
    privateKey,
    publicKey: (await importJWK(publicJwk, ALG)) as CryptoKey,
  };
}
