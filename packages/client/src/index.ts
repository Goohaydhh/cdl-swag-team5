import type {
  AcceptInviteInput,
  ApprovePairingInput,
  Availability,
  ChatMessageInput,
  ChildStatus,
  CreateChildInput,
  ErrorCode,
  LoginInput,
  Message,
  RegisterInput,
  UpdateChildInput,
  UpdateDeviceInput,
  UpdateMeInput,
} from '@swag/protocol';
import type {
  AuthResult,
  ChildDto,
  ConversationDto,
  DeviceDto,
  DeviceProfilesDto,
  DeviceTokenResult,
  FamilyDto,
  GifSearchResult,
  InviteDto,
  JoinPairingResult,
  MediaUpload,
  MessagesPage,
  OverviewDto,
  PairingPollResult,
  PairingSessionDto,
  PairingStateDto,
  ParentDto,
  ParentTokens,
  SignedMedia,
  StickerPack,
} from './types';

export * from './types';

/** Error answered by the API: `{ error: { code, message } }`, or a network failure (status 0). */
export class SwagApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
  ) {
    super(message);
    this.name = 'SwagApiError';
  }

  /** Worth retrying later (offline, server busy, rate limit). */
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export interface ClientOptions {
  /** API origin, e.g. `http://192.168.1.20:3100` (no `/v1`). */
  baseUrl: string;
  /** Current access token, or null when signed out. */
  getToken: () => string | null | Promise<string | null>;
  /**
   * Called once when a request gets 401: refresh the token and return true to retry,
   * or return false to give up (the app then goes back to login / pairing).
   */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

/** Typed client for every route the two apps use. */
export function createSwagClient(options: ClientOptions) {
  const doFetch = options.fetch ?? fetch.bind(globalThis);
  const base = options.baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: string,
    path: string,
    init: { body?: unknown; query?: Query; headers?: Record<string, string>; auth?: boolean; signal?: AbortSignal } = {},
    retried = false,
  ): Promise<T> {
    const qs = init.query
      ? '?' +
        Object.entries(init.query)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
          .join('&')
      : '';
    // ngrok's free plan shows a warning page to browsers; this header skips it (ignored elsewhere).
    const headers: Record<string, string> = { 'ngrok-skip-browser-warning': '1', ...init.headers };
    if (init.auth !== false) {
      const token = await options.getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    let body: BodyInit | undefined;
    if (typeof FormData !== 'undefined' && init.body instanceof FormData) {
      body = init.body;
    } else if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let res: Response;
    try {
      res = await doFetch(`${base}/v1${path}${qs}`, { method, headers, body, signal: init.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new SwagApiError(0, 'NETWORK', (err as Error).message || 'Network error');
    }
    if (res.status === 401 && init.auth !== false && !retried && options.onUnauthorized) {
      if (await options.onUnauthorized()) return request<T>(method, path, init, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const err = (json as { error?: { code?: ErrorCode; message?: string } } | undefined)?.error;
      throw new SwagApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? `HTTP ${res.status}`);
    }
    return json as T;
  }

  const get = <T>(path: string, query?: Query) => request<T>('GET', path, { query });
  const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} });

  return {
    /** Absolute URL for an API path such as a GIF `preview_path` (`/v1/...`). */
    absolute: (path: string) => `${base}${path}`,

    // ------------------------------------------------------------ parent: account
    register: (body: RegisterInput) => request<AuthResult>('POST', '/auth/register', { body, auth: false }),
    login: (body: LoginInput) => request<AuthResult>('POST', '/auth/login', { body, auth: false }),
    refresh: (refresh_token: string) =>
      request<ParentTokens>('POST', '/auth/refresh', { body: { refresh_token }, auth: false }),
    logout: (refresh_token?: string) => post<void>('/auth/logout', { refresh_token }),

    // ------------------------------------------------------------ parent: family
    family: () => get<FamilyDto>('/family'),
    overview: () => get<OverviewDto>('/family/overview'),
    createChild: (body: CreateChildInput) => post<ChildDto>('/children', body),
    updateChild: (id: string, body: UpdateChildInput) => request<ChildDto>('PATCH', `/children/${id}`, { body }),
    deleteChild: (id: string) => request<void>('DELETE', `/children/${id}`),
    devices: () => get<DeviceDto[]>('/devices'),
    updateDevice: (id: string, body: UpdateDeviceInput) => request<DeviceDto>('PATCH', `/devices/${id}`, { body }),
    revokeDevice: (id: string) => request<void>('DELETE', `/devices/${id}`),
    setAvailability: (status: Availability, eta_minutes?: number) =>
      request<{ status: Availability }>('PUT', '/me/availability', { body: { status, eta_minutes } }),
    setPushToken: (push_token: string | null) => request<void>('PUT', '/devices/me/push-token', { body: { push_token } }),

    // ------------------------------------------------------------ pairing (parent generates the code)
    createPairing: (child_ids?: string[]) => post<PairingSessionDto>('/pairing/sessions', child_ids ? { child_ids } : {}),
    /** Long-poll; pass a signal to stop it when the screen closes (it holds a connection open). */
    pairingState: (id: string, wait = 25, signal?: AbortSignal) =>
      request<PairingStateDto>('GET', `/pairing/sessions/${id}/state`, { query: { wait }, signal }),
    approvePairing: (id: string, body: ApprovePairingInput) => post<{ device_id: string }>(`/pairing/sessions/${id}/approve`, body),
    rejectPairing: (id: string) => post<void>(`/pairing/sessions/${id}/reject`),

    // ------------------------------------------------------------ inviting another parent (FR-3)
    /** "Inviter un autre parent": a code the other parent types when creating their account. */
    createInvite: () => post<InviteDto>('/family/invites'),
    /** Creates the second parent's account in the family that issued the code. */
    acceptInvite: (body: AcceptInviteInput) =>
      request<AuthResult>('POST', '/family/invites/accept', { body, auth: false }),

    // ------------------------------------------------------------ tablet
    joinPairing: (code: string, pairing_id?: string, device_info: Record<string, string> = {}) =>
      request<JoinPairingResult>('POST', '/pairing/join', { body: { code, pairing_id, device_info }, auth: false }),
    pollPairing: (id: string, pollSecret: string, wait = 25, signal?: AbortSignal) =>
      request<PairingPollResult>('GET', `/pairing/sessions/${id}`, {
        query: { wait },
        headers: { 'x-pairing-secret': pollSecret },
        auth: false,
        signal,
      }),
    deviceToken: (device_id: string, credential: string) =>
      request<DeviceTokenResult>('POST', '/device/token', { body: { device_id, credential }, auth: false }),
    deviceProfiles: () => get<DeviceProfilesDto>('/device/profiles'),
    setStatus: (childId: string, body: { client_event_id: string; status: ChildStatus; occurred_at: string; note?: string }) =>
      post<{ event_id: string; duplicate: boolean }>(`/children/${childId}/status`, body),

    // ------------------------------------------------------------ the family chat
    familyChat: () => get<ConversationDto>('/conversations/family'),
    messages: (conversationId: string, before?: string, limit = 50) =>
      get<MessagesPage>(`/conversations/${conversationId}/messages`, { before, limit }),
    sendMessage: (conversationId: string, body: Omit<ChatMessageInput, 'conversation_id'>) =>
      post<{ message: Message; duplicate: boolean }>(`/conversations/${conversationId}/messages`, body),
    /** The signed-in parent's own name and colour. */
    updateMe: (body: UpdateMeInput) => request<ParentDto>('PATCH', '/me', { body }),
    stickers: () => get<StickerPack[]>('/stickers/packs'),
    searchGifs: (q: string, offset = 0) => get<GifSearchResult>('/gifs/search', { q, offset }),
    /** `form` holds the PNG in a field named `file`. */
    uploadMedia: (form: FormData) => request<MediaUpload>('POST', '/media', { body: form }),
    media: (id: string) => get<SignedMedia>(`/media/${id}`),
  };
}

export type SwagClient = ReturnType<typeof createSwagClient>;

/** Display helpers shared by both apps. */
export function speakerLabel(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length >= 3) return 'Les enfants';
  return names.join(' et ');
}

/** 8 characters shown as `K7QF-9M2D`. */
export const formatCode = (raw: string) => {
  const c = raw.replace(/[^0-9a-z]/gi, '').toUpperCase();
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4, 8)}` : c;
};

/** Crockford base32 alphabet used by pairing codes (no I, L, O, U). */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
