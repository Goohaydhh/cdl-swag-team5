import { z } from 'zod';

// Request bodies for the REST API (section 6.1 of the architecture doc).
// The API validates with these schemas; the apps use them to build typed requests.

const id = z.uuid();
const email = z.email().max(254).transform((e) => e.toLowerCase());
const password = z.string().min(10).max(200);
const displayName = z.string().trim().min(1).max(40);
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const childPin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const DeviceInfo = z
  .object({
    model: z.string().max(80).optional(),
    os_version: z.string().max(40).optional(),
    app_version: z.string().max(40).optional(),
  })
  .strict();
export type DeviceInfo = z.infer<typeof DeviceInfo>;

// --- Auth

export const ParentDeviceInput = z.object({
  name: z.string().trim().min(1).max(60),
  platform: DeviceInfo.optional(),
  /**
   * Stable id kept by the installation (phone storage). Sent on every sign-in so the API
   * reuses this phone's "Appareil" instead of adding one to the family each time.
   * Optional: a phone built before this existed simply gets a new row, as it used to.
   */
  install_id: id.optional(),
});

export const RegisterInput = z.object({
  email,
  password,
  display_name: displayName,
  family_name: z.string().trim().min(1).max(60),
  consent: z.literal(true, { error: 'parental consent is required' }),
  device: ParentDeviceInput.optional(),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email,
  password: z.string().min(1).max(200),
  device: ParentDeviceInput.optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({ refresh_token: z.string().min(1).max(200) });
export type RefreshInput = z.infer<typeof RefreshInput>;

// --- Pairing (section 5.2)
//
// Product decision: the PARENT generates the QR code and the code (Famille > Associer une
// tablette); the TABLET scans the QR or types the code; the parent then validates the tablet.
//
//   parent  POST /pairing/sessions                 -> { pairing_id, code, qr_payload, expires_at }
//   tablet  POST /pairing/join  { code, pairing_id? } -> { pairing_id, poll_secret, family }
//   parent  GET  /pairing/sessions/:id/state?wait=25  (or the `pairing_updated` socket event)
//   parent  POST /pairing/sessions/:id/approve | /reject
//   tablet  GET  /pairing/sessions/:id?wait=25  + X-Pairing-Secret -> device credential (once)

/** Body of the parent's "Associer une tablette" call. Everything is optional. */
export const CreatePairingSessionInput = z
  .object({
    /** Pre-selects the children that will appear on the tablet (can be changed at approval). */
    child_ids: z.array(id).max(20).optional(),
  })
  .default({});
export type CreatePairingSessionInput = z.infer<typeof CreatePairingSessionInput>;

/** The tablet sends what it scanned (QR) or what the child/parent typed (code). */
export const JoinPairingInput = z.object({
  code: z.string().min(8).max(16),
  /** Present when the code came from the QR, enables per-session attempt counting. */
  pairing_id: id.optional(),
  device_info: DeviceInfo.default({}),
});
export type JoinPairingInput = z.infer<typeof JoinPairingInput>;

export const ApprovePairingInput = z.object({
  device_name: z.string().trim().min(1).max(60),
  /** Omit to show every child of the family on the tablet. */
  child_ids: z.array(id).min(1).max(20).optional(),
});
export type ApprovePairingInput = z.infer<typeof ApprovePairingInput>;

/** Parses `swag://pair?p=<pairing_id>&c=<code>` from the parent's QR code. */
export function parsePairingQr(payload: string): { pairing_id: string; code: string } | null {
  const match = /^swag:\/\/pair\?(.+)$/.exec(payload.trim());
  if (!match) return null;
  const params = new URLSearchParams(match[1]);
  const pairingId = params.get('p');
  const code = params.get('c');
  if (!pairingId || !code || !z.uuid().safeParse(pairingId).success) return null;
  return { pairing_id: pairingId, code };
}

export const AcceptInviteInput = z.object({
  code: z.string().min(8).max(16),
  email,
  password,
  display_name: displayName,
  consent: z.literal(true, { error: 'parental consent is required' }),
  device: ParentDeviceInput.optional(),
});
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

// --- Family, children, devices

export const UpdateFamilyInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    status_retention_days: z.int().min(1).max(365),
    message_retention_days: z.int().min(1).max(365),
  })
  .partial();
export type UpdateFamilyInput = z.infer<typeof UpdateFamilyInput>;

export const CreateChildInput = z.object({
  display_name: z.string().trim().min(1).max(30),
  avatar_key: z.string().min(1).max(64),
  color: hexColor,
  pin: childPin.optional(),
  sort_order: z.int().min(0).max(100).optional(),
});
export type CreateChildInput = z.infer<typeof CreateChildInput>;

export const UpdateChildInput = z
  .object({
    display_name: z.string().trim().min(1).max(30),
    avatar_key: z.string().min(1).max(64),
    color: hexColor,
    /** null removes the PIN. */
    pin: childPin.nullable(),
    sort_order: z.int().min(0).max(100),
  })
  .partial();
export type UpdateChildInput = z.infer<typeof UpdateChildInput>;

export const UpdateDeviceInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    child_ids: z.array(id).max(20),
  })
  .partial();
export type UpdateDeviceInput = z.infer<typeof UpdateDeviceInput>;

export const DeviceTokenInput = z.object({
  device_id: id,
  credential: z.string().min(1).max(200),
});
export type DeviceTokenInput = z.infer<typeof DeviceTokenInput>;

export const ChildSessionInput = z.object({
  child_id: id,
  pin: childPin.optional(),
});
export type ChildSessionInput = z.infer<typeof ChildSessionInput>;

// --- Chat (FR-10 to FR-12). Product decision: one conversation only, the family group chat.

export const MessagesQuery = z.object({
  before: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessagesQuery = z.infer<typeof MessagesQuery>;

// --- Allowed URLs (FR-9)

export const AddAllowedUrlInput = z.object({
  url: z.string().trim().min(3).max(2048),
  match: z.enum(['exact', 'domain', 'prefix']).default('domain'),
  title: z.string().trim().min(1).max(60).optional(),
  /** Omit for all children of the family. */
  child_id: id.optional(),
});
export type AddAllowedUrlInput = z.infer<typeof AddAllowedUrlInput>;

export const GifSearchQuery = z.object({
  q: z.string().trim().min(1).max(50),
  offset: z.coerce.number().int().min(0).max(500).default(0),
});
export type GifSearchQuery = z.infer<typeof GifSearchQuery>;
