import type { Availability, ChildStatus, RingerMode } from './enums';
import type {
  ChatMessageInput,
  ChatReadInput,
  ChatTypingInput,
  MemberRef,
  Message,
  ParentAvailabilityInput,
  ReauthInput,
  RingerStatusInput,
  StatusUpdateInput,
  SyncRequestInput,
  UrlAccessRequestInput,
} from './schemas';

/** Socket.IO namespace for all real-time traffic. */
export const RT_NAMESPACE = '/rt';

export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  NOT_IN_FAMILY: 'NOT_IN_FAMILY',
  VALIDATION: 'VALIDATION',
  RATE_LIMITED: 'RATE_LIMITED',
  DUPLICATE: 'DUPLICATE',
  PAIRING_EXPIRED: 'PAIRING_EXPIRED',
  PAIRING_LOCKED: 'PAIRING_LOCKED',
  PAIRING_NOT_FOUND: 'PAIRING_NOT_FOUND',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  PIN_INVALID: 'PIN_INVALID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type AckResult<T = object> =
  | ({ ok: true; server_ts: string } & T)
  | { ok: false; error: { code: ErrorCode; message: string; retryable: boolean } };
export type Ack<T = object> = (result: AckResult<T>) => void;

/** Every server-to-client event payload is wrapped in this envelope. */
export interface Envelope<T> {
  v: 1;
  /** Per-family sequence number, used for gap detection and `sync_request`. */
  seq: number;
  ts: string;
  data: T;
}

export interface ClientToServerEvents {
  /** A replay of an already-recorded event acks ok with the original event_id and duplicate: true. */
  status_update(d: StatusUpdateInput, ack: Ack<{ event_id: string; duplicate: boolean }>): void;
  parent_availability(d: ParentAvailabilityInput, ack: Ack): void;
  ringer_status(d: RingerStatusInput, ack: Ack): void;
  chat_message(d: ChatMessageInput, ack: Ack<{ message_id: string; duplicate: boolean }>): void;
  chat_typing(d: ChatTypingInput): void;
  chat_read(d: ChatReadInput, ack: Ack): void;
  url_access_request(d: UrlAccessRequestInput, ack: Ack): void;
  sync_request(d: SyncRequestInput, ack: Ack<{ replayed: number }>): void;
  reauth(d: ReauthInput, ack: Ack): void;
}

export interface ServerToClientEvents {
  status_updated(
    e: Envelope<{
      event_id: string;
      child_id: string;
      status: ChildStatus;
      note?: string;
      occurred_at: string;
      received_at: string;
    }>,
  ): void;
  availability_updated(
    e: Envelope<{ user_id: string; status: Availability; eta_minutes?: number; updated_at: string }>,
  ): void;
  ringer_updated(e: Envelope<{ user_id: string; mode: RingerMode; updated_at: string }>): void;
  chat_message_created(e: Envelope<{ message: Message }>): void;
  chat_typing(e: Envelope<{ conversation_id: string; member: MemberRef; typing: boolean }>): void;
  chat_read(
    e: Envelope<{ conversation_id: string; member: MemberRef; up_to_message_id: string }>,
  ): void;
  allowed_urls_changed(e: Envelope<{ version: number }>): void;
  profiles_changed(e: Envelope<{ version: number }>): void;
  presence(e: Envelope<{ member: MemberRef; online: boolean }>): void;
  device_revoked(e: Envelope<{ reason: 'parent_revoked' | 'family_erased' }>): void;
  auth_expiring(e: Envelope<{ expires_at: string }>): void;
  resync_required(e: Envelope<Record<string, never>>): void;
  /** A child tapped "Ask to open" on a blocked site (FR-9). Sent to parents only. */
  url_access_requested(e: Envelope<{ child_id: string; url: string; requested_at: string }>): void;
}

/** Room names used by the gateway. */
export const rooms = {
  family: (familyId: string) => `family:${familyId}`,
  device: (deviceId: string) => `device:${deviceId}`,
  user: (userId: string) => `user:${userId}`,
  child: (childId: string) => `child:${childId}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
};
