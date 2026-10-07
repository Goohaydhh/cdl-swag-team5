import { type AuthResult, createSwagClient, type ParentTokens, type UserDto } from '@swag/client';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './config';

/** The parent's session, kept in the phone's secure storage (Keystore). */
export interface ParentSession {
  user: UserDto;
  tokens: ParentTokens;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

const KEY = 'swag.session';
let current: ParentSession | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<(s: ParentSession | null) => void>();

export async function restoreSession(): Promise<ParentSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    current = raw ? (JSON.parse(raw) as ParentSession) : null;
  } catch {
    current = null;
  }
  return current;
}

export function onSessionChange(l: (s: ParentSession | null) => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

async function setSession(next: ParentSession | null) {
  current = next;
  try {
    if (next) await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Secure storage unavailable: the session lasts until the app closes.
  }
  listeners.forEach((l) => l(next));
}

export const signedIn = (r: AuthResult) =>
  setSession({ user: r.user, tokens: r.tokens, expiresAt: Date.now() + r.tokens.expires_in * 1000 });

export async function signOut() {
  const refresh = current?.tokens.refresh_token;
  if (refresh) await api.logout(refresh).catch(() => undefined);
  await setSession(null);
}

export const getSession = () => current;

/** Rotates the refresh token (single-flight). A reused or expired one signs the parent out. */
function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const session = current;
    if (!session) return false;
    try {
      const tokens = await anonymous.refresh(session.tokens.refresh_token);
      await setSession({ ...session, tokens, expiresAt: Date.now() + tokens.expires_in * 1000 });
      return true;
    } catch (err) {
      if ((err as { status?: number }).status === 401) await setSession(null);
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function accessToken(): Promise<string | null> {
  if (!current) return null;
  if (Date.now() > current.expiresAt - 30_000) await refresh();
  return current?.tokens.access_token ?? null;
}

const anonymous = createSwagClient({ baseUrl: API_URL, getToken: () => null });

export const api = createSwagClient({ baseUrl: API_URL, getToken: accessToken, onUnauthorized: refresh });
