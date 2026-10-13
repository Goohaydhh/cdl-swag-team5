import { requireOptionalNativeModule } from 'expo';

interface StatusWidgetNative {
  setChildren(json: string | null): void;
}

// Only built into Android dev/release builds: null in Expo Go, on iOS and on web.
const native = requireOptionalNativeModule<StatusWidgetNative>('StatusWidget');

export interface WidgetChild {
  name: string;
  label: string;
  /** Hex colour of the status, e.g. "#0B8F55". */
  color: string;
  /** Epoch ms of the status, 0 when none yet. */
  at: number;
}

/** Pushes the children's statuses to the Android home-screen widget. No-op elsewhere. */
export function updateStatusWidget(children: WidgetChild[] | null) {
  try {
    native?.setChildren(children ? JSON.stringify(children) : null);
  } catch {
    // The widget is a convenience: never break the app for it.
  }
}
