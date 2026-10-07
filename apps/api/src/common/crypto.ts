import { hash, verify } from '@node-rs/argon2';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { v7 } from 'uuid';

/** Time-ordered UUIDv7, used for every primary key. */
export const newId = (): string => v7();

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (key: string, value: string): string =>
  createHmac('sha256', key).update(value).digest('hex');

/** URL-safe random secret. 32 bytes = 256 bits. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// --- Passwords and PINs (Argon2id)

const PASSWORD_OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 1 }; // m=64 MB, t=3
const PIN_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 }; // PINs rely on rate limits

export const hashPassword = (password: string) => hash(password, PASSWORD_OPTIONS);
export const hashPin = (pin: string) => hash(pin, PIN_OPTIONS);
export const verifySecret = (hashed: string, plain: string) => verify(hashed, plain);

/** Same cost as a real check, so unknown emails take as long as wrong passwords. */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<false> {
  dummyHash ??= hashPassword(randomToken(16));
  await verify(await dummyHash, plain);
  return false;
}

// --- Pairing and invite codes (section 5.2): 8 characters of Crockford Base32 = 40 bits

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generatePairingCode(): string {
  // 256 is a multiple of 32, so `byte & 31` is uniform.
  return Array.from(randomBytes(8), (b) => CROCKFORD[b & 31]).join('');
}

/** Accepts `k7qf-9m2d`, `K7QF 9M2D`, and the Crockford look-alikes O→0, I/L→1. */
export function normalizePairingCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(code) ? code : null;
}

export const formatPairingCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;
