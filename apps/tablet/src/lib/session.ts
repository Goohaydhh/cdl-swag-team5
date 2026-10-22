import { createSwagClient, SwagApiError } from '@swag/client';
import { API_URL } from './config';
import { load, save } from './storage';

/** What a paired tablet keeps: its id and its long-lived (rotating) credential. */
export interface DeviceSession {
  deviceId: string;
  credential: string;
  familyName: string;
}

const KEY = 'swag.device';

export const loadSession = () => load<DeviceSession | null>(KEY, null);
export const saveSession = (s: DeviceSession | null) => save(KEY, s);

/** Fired when the parent revoked this tablet: the app goes back to pairing. */
export class DeviceRevokedError extends Error {}

let accessToken: string | null = null;
let accessExpiresAt = 0;
let inflight: Promise<string> | null = null;

/**
 * Exchanges the credential for a 15-minute access token. The server rotates the credential on
 * every exchange, so the new one is saved before the token is used. Single-flight.
 */
export function getAccessToken(force = false): Promise<string> {
  if (!force && accessToken && Date.now() < accessExpiresAt - 30_000) return Promise.resolve(accessToken);
  inflight ??= (async () => {
    const session = loadSession();
    if (!session) throw new DeviceRevokedError('not paired');
    try {
      const res = await anonymous.deviceToken(session.deviceId, session.credential);
      saveSession({ ...session, credential: res.credential });
      accessToken = res.access_token;
      accessExpiresAt = Date.now() + res.expires_in * 1000;
      return res.access_token;
    } catch (err) {
      if (err instanceof SwagApiError && err.status === 401) {
        forgetDevice();
        throw new DeviceRevokedError('revoked');
      }
      throw err;
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function forgetDevice() {
  saveSession(null);
  accessToken = null;
  accessExpiresAt = 0;
}

/** Calls that need no token (pairing). */
export const anonymous = createSwagClient({ baseUrl: API_URL, getToken: () => null });

/** Calls made as the tablet (device token). */
export const api = createSwagClient({
  baseUrl: API_URL,
  getToken: () => getAccessToken().catch(() => null),
  onUnauthorized: async () => {
    try {
      await getAccessToken(true);
      return true;
    } catch {
      return false;
    }
  },
});
