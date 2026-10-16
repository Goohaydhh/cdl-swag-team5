import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SERVER_KEY = 'swag.server';

/** Address built into the app (.env), used when nothing is saved on the phone. */
export const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3100' : 'http://localhost:3100');

/** Address typed in the "Serveur" panel and saved on the phone (null if none). */
export function savedServer(): string | null {
  try {
    return SecureStore.getItem(SERVER_KEY);
  } catch {
    return null;
  }
}

/** Saves the address (or clears it with null). The app must be restarted to use it. */
export function saveServer(url: string | null) {
  try {
    if (url) SecureStore.setItem(SERVER_KEY, url);
    else void SecureStore.deleteItemAsync(SERVER_KEY);
  } catch {
    // Secure storage unavailable (web): keep the built-in address.
  }
}

/** "10.0.0.5:5173" -> "http://10.0.0.5:5173"; returns null if it is not a valid address. */
export function normalizeServer(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `http://${raw}`).origin;
  } catch {
    return null;
  }
}

/** Calls /v1/health (6 s max). */
export async function testServer(url: string): Promise<'ok' | 'degraded' | 'down'> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${url}/v1/health`, { signal: ctrl.signal });
    const body = (await res.json()) as { status?: string };
    return body.status === 'ok' ? 'ok' : 'degraded';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Base URL of the SWAG API: the address saved in the "Serveur" panel, else the built-in one.
 * The Android emulator reaches the PC's localhost at 10.0.2.2; a real phone needs the PC's LAN IP.
 */
export const API_URL = savedServer() || DEFAULT_API_URL;

export const DEVICE_NAME = Platform.OS === 'ios' ? 'iPhone' : 'Téléphone Android';
