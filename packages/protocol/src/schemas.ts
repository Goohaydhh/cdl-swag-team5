import { z } from 'zod';
import { Availability, ChildStatus, MemberType, MessageKind, RingerMode } from './enums';

const id = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

export const MemberRef = z.object({ type: MemberType, id });
export type MemberRef = z.infer<typeof MemberRef>;

export const Message = z.object({
  id,
  conversation_id: id,
  sender: MemberRef,
  kind: MessageKind,
  body: z.string().max(2000).optional(),
  media_id: id.optional(),
  sticker_code: z.string().max(64).optional(),
  gif_ref: z.string().max(128).optional(),
  /**
   * Children who wrote the message together on the tablet ("who is speaking" chips).
   * Empty for parents; one id for a single child; several for a shared message.
   */
  speaker_ids: z.array(id),
  /** The sender's own id for this message, so its app can match the optimistic copy. */
  client_msg_id: id.optional(),
  created_at: timestamp,
});
export type Message = z.infer<typeof Message>;

// Client -> server payloads

export const StatusUpdateInput = z.object({
  client_event_id: id,
  child_id: id,
  status: ChildStatus,
  note: z.string().max(80).optional(),
  occurred_at: timestamp,
});
export type StatusUpdateInput = z.infer<typeof StatusUpdateInput>;

export const ParentAvailabilityInput = z.object({
  status: Availability,
  eta_minutes: z.int().min(0).max(600).optional(),
});
export type ParentAvailabilityInput = z.infer<typeof ParentAvailabilityInput>;

export const RingerStatusInput = z.object({
  mode: RingerMode,
  changed_at: timestamp,
});
export type RingerStatusInput = z.infer<typeof RingerStatusInput>;

export const ChatMessageInput = z
  .object({
    client_msg_id: id,
    conversation_id: id,
    kind: MessageKind,
    body: z.string().min(1).max(2000).optional(),
    media_id: id.optional(),
    sticker_code: z.string().max(64).optional(),
    gif_ref: z.string().max(128).optional(),
    /**
     * Tablet (device token) only: the children checked in the "who is speaking" chips.
     * Several ids = a shared message. Ignored for parents and child tokens.
     */
    speaker_ids: z.array(id).min(1).max(20).optional(),
  })
  .refine(
    (m) =>
      (m.kind === 'text' && !!m.body) ||
      (m.kind === 'drawing' && !!m.media_id) ||
      (m.kind === 'sticker' && !!m.sticker_code) ||
      (m.kind === 'gif' && !!m.gif_ref),
    { message: 'payload field missing for message kind' },
  );
export type ChatMessageInput = z.infer<typeof ChatMessageInput>;

export const ChatTypingInput = z.object({
  conversation_id: id,
  typing: z.boolean(),
  /** Tablet only, same meaning as in `ChatMessageInput`. */
  speaker_ids: z.array(id).min(1).max(20).optional(),
});
export type ChatTypingInput = z.infer<typeof ChatTypingInput>;

export const ChatReadInput = z.object({ conversation_id: id, up_to_message_id: id });
export type ChatReadInput = z.infer<typeof ChatReadInput>;

export const UrlAccessRequestInput = z.object({ url: z.url({ protocol: /^https$/ }) });
export type UrlAccessRequestInput = z.infer<typeof UrlAccessRequestInput>;

export const SyncRequestInput = z.object({ since_seq: z.int().min(0) });
export type SyncRequestInput = z.infer<typeof SyncRequestInput>;

export const ReauthInput = z.object({ token: z.string().min(1) });
export type ReauthInput = z.infer<typeof ReauthInput>;
