import type { Availability, ChildStatus, Message, PairingState, RingerMode } from '@swag/protocol';

// Response shapes of the SWAG API (apps/api). Request bodies come from @swag/protocol.

export interface ParentTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
}

export interface UserDto {
  id: string;
  family_id: string;
  email: string;
  display_name: string;
  is_owner: boolean;
}

export interface AuthResult {
  user: UserDto;
  tokens: ParentTokens;
}

export interface ChildDto {
  id: string;
  display_name: string;
  avatar_key: string;
  color: string;
  has_pin: boolean;
  sort_order: number;
}

export interface ParentDto {
  id: string;
  display_name: string;
  avatar_key: string | null;
  is_owner?: boolean;
}

export interface FamilyDto {
  id: string;
  name: string;
  status_retention_days: number;
  message_retention_days: number;
  allowlist_version: number;
  parents: ParentDto[];
  children: ChildDto[];
}

export interface CurrentStatus {
  status: ChildStatus;
  event_id: string;
  occurred_at: string;
}

export interface OverviewDto {
  generated_at: string;
  children: { id: string; display_name: string; avatar_key: string; color: string; status: CurrentStatus | null }[];
  parents: {
    id: string;
    display_name: string;
    avatar_key: string | null;
    availability: Availability;
    eta_minutes: number | null;
    availability_at: string | null;
    ringer: RingerMode;
    ringer_at: string | null;
  }[];
}

export interface DeviceDto {
  id: string;
  kind: 'parent_phone' | 'child_tablet';
  name: string;
  platform_info: Record<string, unknown>;
  /** Parent phones: the parent this phone belongs to. Null for tablets. */
  owner_user_id: string | null;
  child_ids: string[];
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** A code another parent types in "Rejoindre ma famille" (valid 24 h, single use). */
export interface InviteDto {
  invite_id: string;
  code: string;
  qr_payload: string;
  expires_at: string;
}

export interface PairingSessionDto {
  pairing_id: string;
  code: string;
  qr_payload: string;
  expires_at: string;
}

export interface PairingStateDto {
  pairing_id: string;
  state: PairingState;
  device_info: Record<string, unknown>;
  expires_at: string;
}

export interface JoinPairingResult {
  pairing_id: string;
  poll_secret: string;
  family: { name: string };
  expires_at: string;
}

export type PairingPollResult =
  | { state: 'claimed' | 'rejected' | 'expired' | 'consumed' }
  | { state: 'approved'; device_id: string; credential: string; family: { id: string; name: string } };

export interface DeviceTokenResult {
  access_token: string;
  expires_in: number;
  /** The credential is rotated on every exchange: store the new one. */
  credential: string;
}

export interface DeviceProfilesDto {
  family: { id: string; name: string };
  device: { id: string; name: string };
  children: (ChildDto & { status: { status: ChildStatus; occurred_at: string } | null })[];
  parents: (ParentDto & { availability: Availability; eta_minutes: number | null; availability_at: string | null; ringer: RingerMode })[];
}

export interface ConversationDto {
  id: string;
  is_group: boolean;
  last_message: Message | null;
  unread_count: number;
  last_read_id: string | null;
}

export interface MessagesPage {
  items: Message[];
  next_before: string | null;
}

export interface StickerPack {
  id: string;
  title: string;
  stickers: { code: string }[];
}

export interface GifSearchResult {
  items: { gif_ref: string; title: string; width: number; height: number; preview_path: string }[];
  next_offset: number | null;
  attribution: string;
}

export interface MediaUpload {
  id: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface SignedMedia {
  id: string;
  mime: string;
  url: string;
  expires_in: number;
}
