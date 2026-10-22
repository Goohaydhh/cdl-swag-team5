import type { ChatMessageInput, ChildStatus } from '@swag/protocol';
import { SwagApiError } from '@swag/client';
import { api } from './session';
import { load, save } from './storage';

/**
 * Offline outbox: status taps and messages are kept here until the API confirms them, so a
 * tablet without Wi-Fi never loses what a child sent. Every item carries its own client id,
 * which the API uses for idempotency, so replaying is always safe.
 */
export type OutboxItem =
  | { kind: 'status'; childId: string; body: { client_event_id: string; status: ChildStatus; occurred_at: string } }
  | { kind: 'message'; conversationId: string; body: Omit<ChatMessageInput, 'conversation_id'> };

const KEY = 'swag.outbox';
let items: OutboxItem[] = load<OutboxItem[]>(KEY, []);
let flushing: Promise<void> | null = null;
const listeners = new Set<() => void>();

const persist = () => {
  save(KEY, items);
  listeners.forEach((l) => l());
};

export const pending = () => items;
export const onOutboxChange = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function enqueue(item: OutboxItem) {
  items = [...items, item];
  persist();
  return flush();
}

/** Sends everything in order; stops at the first network failure and tries again later. */
export function flush(): Promise<void> {
  flushing ??= (async () => {
    while (items.length) {
      const item = items[0]!;
      try {
        if (item.kind === 'status') await api.setStatus(item.childId, item.body);
        else await api.sendMessage(item.conversationId, item.body);
      } catch (err) {
        if (err instanceof SwagApiError && err.retryable) break; // offline: keep it
        // Refused for good (validation, child removed…): drop it so the queue keeps moving.
        console.warn('[outbox] dropped', item, err);
      }
      items = items.slice(1);
      persist();
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export const isPendingMessage = (clientMsgId: string) =>
  items.some((i) => i.kind === 'message' && i.body.client_msg_id === clientMsgId);
