import type { RingerMode } from '@swag/protocol';
import { type NativeModule, requireOptionalNativeModule } from 'expo';

type Events = { onChange(e: { mode: RingerMode }): void };
declare class RingerModeNative extends NativeModule<Events> {
  getMode(): RingerMode;
}

// Only built into Android dev/release builds: null in Expo Go, on iOS (no public API) and on web.
const native = requireOptionalNativeModule<RingerModeNative>('RingerMode');

/** Whether this build can read the phone's ringer mode. */
export const ringerSupported = native !== null;

export function getRingerMode(): RingerMode {
  return native?.getMode() ?? 'unknown';
}

export function addRingerListener(cb: (mode: RingerMode) => void): { remove(): void } | null {
  return native?.addListener('onChange', ({ mode }) => cb(mode)) ?? null;
}
