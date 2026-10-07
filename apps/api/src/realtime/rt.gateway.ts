import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import {
  type AckResult,
  ChatMessageInput,
  ChatReadInput,
  ChatTypingInput,
  type ClientToServerEvents,
  ErrorCode,
  ParentAvailabilityInput,
  ReauthInput,
  RingerStatusInput,
  RT_NAMESPACE,
  rooms,
  type ServerToClientEvents,
  StatusUpdateInput,
  SyncRequestInput,
  TokenScope,
  UrlAccessRequestInput,
} from '@swag/protocol';
import type { Namespace, Socket } from 'socket.io';
import type { z } from 'zod';
import { AllowlistService } from '../access/allowlist.service';
import { KeysService } from '../auth/keys.service';
import type { Principal } from '../auth/principal';
import { TokensService } from '../auth/tokens.service';
import { ChatService } from '../chat/chat.service';
import { ApiError } from '../common/api-error';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../common/redis.service';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../status/presence.service';
import { StatusService } from '../status/status.service';
import { RealtimeService } from './realtime.service';

interface SocketState extends Principal {
  /** Access-token expiry (epoch seconds); dev tokens have none. */
  exp?: number;
}
type RtSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketState>;

/** Per-socket limits from section 6.3: [max events, window in seconds]. */
const LIMITS = {
  status_update: [10, 60],
  parent_availability: [20, 60],
  ringer_status: [30, 60],
  sync_request: [10, 60],
  chat_message: [30, 60],
  chat_typing: [2, 1],
  chat_read: [60, 60],
} as const satisfies Record<string, readonly [number, number]>;

const EXPIRY_WARNING_SECONDS = 60;
const PRESENCE_TTL_SECONDS = 24 * 60 * 60;

/** Socket.IO entry point (section 6.2). Identity comes only from the handshake token. */
// CORS and the message size cap are applied by RedisIoAdapter from the environment.
@WebSocketGateway({ namespace: RT_NAMESPACE })
export class RtGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RtGateway.name);
  private readonly expiryTimers = new Map<string, NodeJS.Timeout[]>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly keys: KeysService,
    private readonly tokens: TokensService,
    private readonly realtime: RealtimeService,
    private readonly rateLimit: RateLimitService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly status: StatusService,
    private readonly presence: PresenceService,
    private readonly chat: ChatService,
    private readonly allowlist: AllowlistService,
  ) {}

  afterInit(nsp: Namespace) {
    this.realtime.attach(nsp as never);
  }

  async handleConnection(socket: RtSocket) {
    const principal = await this.authenticate(socket.handshake.auth?.token);
    if (!principal) {
      socket.disconnect(true);
      return;
    }
    socket.data = principal;
    await socket.join(rooms.family(principal.fam));
    if (principal.dev) await socket.join(rooms.device(principal.dev));
    if (principal.scope === 'child') await socket.join(rooms.child(principal.sub));
    if (principal.scope === 'parent') await socket.join(rooms.user(principal.sub));
    await socket.join(await this.chat.socketRooms(principal));
    this.scheduleExpiry(socket);

    if (principal.dev) {
      await this.prisma.device
        .updateMany({ where: { id: principal.dev }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }
    await this.trackPresence(principal, +1);
  }

  async handleDisconnect(socket: RtSocket) {
    this.clearExpiry(socket.id);
    if (socket.data?.sub) await this.trackPresence(socket.data, -1);
  }

  // ---------------------------------------------------------------- client events

  @SubscribeMessage('status_update')
  statusUpdate(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'status_update', StatusUpdateInput, body, async (input) => {
      const { event, duplicate } = await this.status.record(socket.data, input);
      return { event_id: event.id, duplicate };
    });
  }

  @SubscribeMessage('parent_availability')
  parentAvailability(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'parent_availability', ParentAvailabilityInput, body, async (input) => {
      await this.presence.setAvailability(socket.data, input);
      return {};
    });
  }

  @SubscribeMessage('ringer_status')
  ringerStatus(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'ringer_status', RingerStatusInput, body, async (input) => {
      await this.presence.setRinger(socket.data, input);
      return {};
    });
  }

  @SubscribeMessage('sync_request')
  syncRequest(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'sync_request', SyncRequestInput, body, async (input) => {
      const events = await this.realtime.replay(socket.data.fam, input.since_seq, socket.rooms);
      if (events === 'resync') {
        const seq = await this.realtime.currentSeq(socket.data.fam);
        socket.emit('resync_required', { v: 1, seq, ts: new Date().toISOString(), data: {} });
        return { replayed: 0 };
      }
      for (const { event, envelope } of events) {
        (socket.emit as (ev: string, payload: unknown) => boolean)(event, envelope);
      }
      return { replayed: events.length };
    });
  }

  @SubscribeMessage('chat_message')
  chatMessage(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'chat_message', ChatMessageInput, body, async (input) => {
      const { message, duplicate } = await this.chat.send(socket.data, input);
      return { message_id: message.id, duplicate };
    });
  }

  /** Fire-and-forget: no ack, errors are dropped. */
  @SubscribeMessage('chat_typing')
  async chatTyping(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    await this.handle(socket, 'chat_typing', ChatTypingInput, body, async (input) => {
      await this.chat.typing(socket.data, input.conversation_id, input.typing);
      return {};
    });
  }

  @SubscribeMessage('chat_read')
  chatRead(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'chat_read', ChatReadInput, body, async (input) => {
      await this.chat.markRead(socket.data, input);
      return {};
    });
  }

  @SubscribeMessage('url_access_request')
  urlAccessRequest(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'url_access_request', UrlAccessRequestInput, body, async (input) => {
      await this.allowlist.requestAccess(socket.data, input.url);
      return {};
    });
  }

  /** Swaps in a fresh access token without dropping the socket. */
  @SubscribeMessage('reauth')
  reauth(@ConnectedSocket() socket: RtSocket, @MessageBody() body: unknown) {
    return this.handle(socket, 'reauth', ReauthInput, body, async (input) => {
      const next = await this.authenticate(input.token);
      const current = socket.data;
      if (!next || next.sub !== current.sub || next.fam !== current.fam || next.scope !== current.scope) {
        throw ApiError.unauthenticated('Token does not match this connection');
      }
      socket.data = next;
      this.scheduleExpiry(socket);
      return {};
    });
  }

  // ---------------------------------------------------------------- plumbing

  /** Validates, rate-limits and runs a handler, turning every failure into an ack error. */
  private async handle<S extends z.ZodType, T extends object>(
    socket: RtSocket,
    event: string,
    schema: S,
    body: unknown,
    run: (input: z.infer<S>) => Promise<T>,
  ): Promise<AckResult<T>> {
    try {
      const limit = LIMITS[event as keyof typeof LIMITS];
      if (limit && !(await this.rateLimit.hit(`ws:${event}:${socket.data.sub}`, limit[0], limit[1]))) {
        return fail(ErrorCode.RATE_LIMITED, 'Too many events, slow down', true);
      }
      const parsed = schema.safeParse(body);
      if (!parsed.success) return fail(ErrorCode.VALIDATION, parsed.error.message, false);
      const result = await run(parsed.data);
      return { ok: true, server_ts: new Date().toISOString(), ...result };
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.code, err.detail, err.code === ErrorCode.RATE_LIMITED);
      }
      this.logger.error(`${event} failed: ${(err as Error).stack ?? String(err)}`);
      return fail(ErrorCode.INTERNAL, 'Internal error', true);
    }
  }

  private async authenticate(token: unknown): Promise<SocketState | null> {
    if (typeof token !== 'string' || !token) return null;
    if (token.startsWith('dev:')) return this.env.ALLOW_DEV_TOKENS ? parseDevToken(token) : null;
    const principal = await this.keys.verify(token);
    if (!principal || (await this.tokens.isRevoked(principal))) return null;
    return principal;
  }

  /** Warns 60 s before the access token expires, and disconnects at expiry unless reauthed. */
  private scheduleExpiry(socket: RtSocket) {
    this.clearExpiry(socket.id);
    const exp = socket.data.exp;
    if (!exp) return;
    const msLeft = exp * 1000 - Date.now();
    const warnIn = Math.max(0, msLeft - EXPIRY_WARNING_SECONDS * 1000);
    const warn = setTimeout(() => {
      socket.emit('auth_expiring', {
        v: 1,
        seq: 0,
        ts: new Date().toISOString(),
        data: { expires_at: new Date(exp * 1000).toISOString() },
      });
    }, warnIn);
    const cut = setTimeout(() => socket.disconnect(true), Math.max(0, msLeft));
    warn.unref();
    cut.unref();
    this.expiryTimers.set(socket.id, [warn, cut]);
  }

  private clearExpiry(socketId: string) {
    for (const t of this.expiryTimers.get(socketId) ?? []) clearTimeout(t);
    this.expiryTimers.delete(socketId);
  }

  /** Emits presence online/offline when a parent's or child's first/last socket comes or goes. */
  private async trackPresence(p: Principal, delta: 1 | -1) {
    if (p.scope === 'device' || !this.redis.client.isOpen) return; // closed during shutdown
    const memberType = p.scope === 'parent' ? 'user' : 'child';
    const key = `online:${p.fam}:${memberType}:${p.sub}`;
    const count = delta > 0 ? await this.redis.client.incr(key) : await this.redis.client.decr(key);
    await this.redis.client.expire(key, PRESENCE_TTL_SECONDS);
    if ((delta > 0 && count === 1) || (delta < 0 && count <= 0)) {
      if (count < 0) await this.redis.client.set(key, '0', { EX: PRESENCE_TTL_SECONDS });
      await this.realtime.toFamily(p.fam, 'presence', {
        member: { type: memberType, id: p.sub },
        online: delta > 0,
      });
    }
  }
}

/** `dev:<familyId>:<scope>:<subjectId>`, accepted only when ALLOW_DEV_TOKENS=true. */
function parseDevToken(token: string): SocketState | null {
  const [, fam, scope, sub] = token.split(':');
  const parsedScope = TokenScope.safeParse(scope);
  if (!fam || !sub || !parsedScope.success) return null;
  return { fam, sub, scope: parsedScope.data };
}

function fail(code: ErrorCode, message: string, retryable: boolean): AckResult<never> {
  return { ok: false, error: { code, message, retryable } };
}
