import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  type AckResult,
  type ClientToServerEvents,
  ErrorCode,
  RT_NAMESPACE,
  type ServerToClientEvents,
  StatusUpdateInput,
  TokenScope,
  rooms,
} from '@swag/protocol';
import { randomUUID } from 'node:crypto';
import type { Namespace, Socket } from 'socket.io';

interface SocketIdentity {
  familyId: string;
  scope: TokenScope;
  subjectId: string;
}

type RtSocket = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketIdentity>;

/**
 * Sprint 0 gateway. Auth is a development stub: the handshake token is
 * `dev:<familyId>:<scope>:<subjectId>` and is refused in production.
 * Sprint 1 replaces parseToken with ES256 JWT verification (section 5.1).
 */
@WebSocketGateway({ namespace: RT_NAMESPACE, cors: { origin: true } })
export class RtGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RtGateway.name);
  private seq = 0; // Sprint 2: per-family counter stored in Redis

  @WebSocketServer()
  server: Namespace<ClientToServerEvents, ServerToClientEvents, object, SocketIdentity>;

  handleConnection(socket: RtSocket) {
    const identity = parseToken(socket.handshake.auth?.token);
    if (!identity) {
      socket.disconnect(true);
      return;
    }
    socket.data = identity;
    void socket.join(rooms.family(identity.familyId));
    if (identity.scope === 'child') void socket.join(rooms.child(identity.subjectId));
    this.logger.debug(`connected ${identity.scope} in family ${identity.familyId}`);
  }

  @SubscribeMessage('status_update')
  handleStatusUpdate(
    @ConnectedSocket() socket: RtSocket,
    @MessageBody() body: unknown,
  ): AckResult<{ event_id: string }> {
    if (socket.data.scope !== 'child') {
      return fail(ErrorCode.FORBIDDEN_SCOPE, 'only a child session can send a status');
    }
    const parsed = StatusUpdateInput.safeParse(body);
    if (!parsed.success) return fail(ErrorCode.VALIDATION, parsed.error.message);

    // Sprint 2: persist to status_events (idempotent on client_event_id) and check the child
    // belongs to socket.data.familyId before broadcasting.
    const eventId = randomUUID();
    const now = new Date().toISOString();
    this.server.to(rooms.family(socket.data.familyId)).emit('status_updated', {
      v: 1,
      seq: ++this.seq,
      ts: now,
      data: {
        event_id: eventId,
        child_id: parsed.data.child_id,
        status: parsed.data.status,
        note: parsed.data.note,
        occurred_at: parsed.data.occurred_at,
        received_at: now,
      },
    });
    return { ok: true, server_ts: now, event_id: eventId };
  }
}

function parseToken(token: unknown): SocketIdentity | null {
  if (process.env.NODE_ENV === 'production' || typeof token !== 'string') return null;
  const [prefix, familyId, scope, subjectId] = token.split(':');
  const parsedScope = TokenScope.safeParse(scope);
  if (prefix !== 'dev' || !familyId || !subjectId || !parsedScope.success) return null;
  return { familyId, scope: parsedScope.data, subjectId };
}

function fail(code: ErrorCode, message: string): AckResult<never> {
  return { ok: false, error: { code, message, retryable: false } };
}
