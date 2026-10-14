import type { OverviewDto } from '@swag/client';
import { statusColor, statusLabel } from '@swag/design-tokens';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { updateStatusWidget, type WidgetChild } from '../../modules/status-widget';
import { api, getSession, restoreSession } from './session';

const TASK = 'swag-push';
const CHANNEL = 'family';

/** What the backend puts in a data-only push: IDs only, never names or text. */
type PushData = { type?: string; child_id?: string; conversation_id?: string; device_id?: string };

export function toWidgetChildren(o: OverviewDto): WidgetChild[] {
  return o.children.map((c) => ({
    name: c.display_name,
    label: c.status ? statusLabel[c.status.status] : 'Pas encore de statut',
    color: c.status ? statusColor[c.status.status] : '#6B6B80',
    at: c.status ? Date.parse(c.status.occurred_at) : 0,
  }));
}

// Runs headless when the app is killed or in the background: refresh the widget, then notify.
// Must be defined at module scope, before the app registers (see index.ts).
TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data }) => {
  const push = readPush(data);
  if (!push?.type) return;
  if (!getSession() && !(await restoreSession())) return; // signed out: stay silent
  const overview = await api.overview().catch(() => null);
  if (overview) updateStatusWidget(toWidgetChildren(overview));
  // In the foreground the socket already updated the screen: no banner needed.
  if (AppState.currentState === 'active') return;
  const content = describe(push, overview);
  if (!content) return;
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: content.id,
    content: { title: content.title, body: content.body },
    trigger: { channelId: CHANNEL },
  });
});

const ensureChannel = () =>
  Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Famille', importance: Notifications.AndroidImportance.HIGH });

function readPush(data: Notifications.NotificationTaskPayload | undefined): PushData | null {
  if (!data || !('data' in data) || !data.data) return null;
  const raw = data.data as Record<string, unknown>;
  if (typeof raw.dataString === 'string') {
    try {
      return JSON.parse(raw.dataString) as PushData;
    } catch {
      return null;
    }
  }
  return raw as PushData;
}

function describe(push: PushData, o: OverviewDto | null): { id: string; title: string; body: string } | null {
  const child = o?.children.find((c) => c.id === push.child_id);
  switch (push.type) {
    case 'status_updated':
      // One notification per child, replaced by the next status.
      return {
        id: `status-${push.child_id}`,
        title: child?.display_name ?? 'Nouveau statut',
        body: child?.status ? statusLabel[child.status.status] : 'Ouvre SWAG pour voir où en sont tes enfants.',
      };
    case 'chat_message':
      return { id: 'chat', title: 'Chat famille', body: 'Nouveau message' };
    case 'device_paired':
      return { id: `paired-${push.device_id}`, title: 'Tablette associée', body: 'Une tablette a rejoint la famille.' };
    case 'url_access_request':
      return { id: `site-${push.child_id}`, title: 'Demande de site', body: `${child?.display_name ?? 'Un enfant'} demande à ouvrir un site.` };
    default:
      return null;
  }
}

if (Platform.OS === 'android') void Notifications.registerTaskAsync(TASK).catch(() => undefined);

/**
 * Asks for permission and gives this phone's FCM token to the backend. Android builds only:
 * needs google-services.json at build time, otherwise it quietly does nothing.
 */
export async function registerPush(): Promise<{ remove(): void } | null> {
  if (Platform.OS !== 'android') return null;
  try {
    await ensureChannel();
    const { granted } = await Notifications.requestPermissionsAsync();
    if (!granted) return null;
    const token = await Notifications.getDevicePushTokenAsync();
    await api.setPushToken(String(token.data));
    return Notifications.addPushTokenListener((t) => void api.setPushToken(String(t.data)).catch(() => undefined));
  } catch (e) {
    console.warn('push registration failed', e);
    return null;
  }
}
