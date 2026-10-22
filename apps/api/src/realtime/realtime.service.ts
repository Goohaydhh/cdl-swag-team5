import { Injectable } from '@nestjs/common';
import { type Envelope, rooms, type ServerToClientEvents } from '@swag/protocol';
import type { Namespace } from 'socket.io';
import { RedisService } from '../common/redis.service';

type EventName = keyof ServerToClientEvents;
type EventData<E extends EventName> =
  Parameters<ServerToClientEvents[E]>[0] extends Envelope<infer D> ? D : never;

export type RtNamespace = Namespace<Record<string, never>, ServerToClientEvents>;

export interface ReplayedEvent {
  event: EventName;
  envelope: Envelope<unknown>;
}

/** How long and how many events a family's replay stream keeps (section 6.2). */
const REPLAY_TTL_SECONDS = 24 * 60 * 60;
const REPLAY_MAX_EVENTS = 2000;
const streamKey = (familyId: string) => `rt-stream:${familyId}`;
const seqKey = (familyId: string) => `seq:${familyId}`;

/** Emits server events to rooms and keeps a 24 h replay stream per family in Redis. */
@Injectable()
export class RealtimeService {
  private nsp: RtNamespace | undefined;

  constructor(private readonly redis: RedisService) {}

  attach(nsp: RtNamespace) {
    this.nsp = nsp;
  }

  async toFamily<E extends EventName>(familyId: string, event: E, data: EventData<E>) {
    await this.emit(rooms.family(familyId), familyId, event, data);
  }

  async toDevice<E extends EventName>(familyId: string, deviceId: string, event: E, data: EventData<E>) {
    await this.emit(rooms.device(deviceId), familyId, event, data);
  }

  async toUser<E extends EventName>(familyId: string, userId: string, event: E, data: EventData<E>) {
    await this.emit(rooms.user(userId), familyId, event, data);
  }

  /** Makes every socket in `fromRoom` (on any API instance) also join `toRoom`. */
  joinRoom(fromRoom: string, toRoom: string) {
    this.nsp?.in(fromRoom).socketsJoin(toRoom);
  }

  async toConversation<E extends EventName>(
    familyId: string,
    conversationId: string,
    event: E,
    data: EventData<E>,
  ) {
    await this.emit(rooms.conversation(conversationId), familyId, event, data);
  }

  /** Ephemeral events (typing) skip the replay stream. */
  async toConversationVolatile<E extends EventName>(
    familyId: string,
    conversationId: string,
    event: E,
    data: EventData<E>,
  ) {
    await this.emit(rooms.conversation(conversationId), familyId, event, data, false);
  }

  async currentSeq(familyId: string): Promise<number> {
    return Number((await this.redis.client.get(seqKey(familyId))) ?? 0);
  }

  /** Drops every socket of a device, e.g. after the parent revokes a tablet. */
  disconnectDevice(deviceId: string) {
    this.nsp?.in(rooms.device(deviceId)).disconnectSockets(true);
  }

  /**
   * Events after `sinceSeq` for the rooms the socket is in, or 'resync' when the stream no
   * longer reaches back that far and the client must re-read state over REST.
   */
  async replay(familyId: string, sinceSeq: number, socketRooms: Set<string>): Promise<ReplayedEvent[] | 'resync'> {
    const current = await this.currentSeq(familyId);
    if (sinceSeq >= current) return [];

    const entries = (await this.redis.client.xRange(streamKey(familyId), '-', '+')) ?? [];
    const firstSeq = entries.length ? Number(entries[0]!.message.seq) : current + 1;
    if (sinceSeq < firstSeq - 1) return 'resync';

    return entries
      .filter((e) => Number(e.message.seq) > sinceSeq && socketRooms.has(e.message.room!))
      .map((e) => ({
        event: e.message.event as EventName,
        envelope: JSON.parse(e.message.envelope!) as Envelope<unknown>,
      }));
  }

  private async emit(room: string, familyId: string, event: EventName, data: unknown, persist = true) {
    const seq = await this.redis.client.incr(seqKey(familyId));
    const envelope = { v: 1 as const, seq, ts: new Date().toISOString(), data };
    if (persist) {
      await this.redis.client
        .multi()
        .xAdd(
          streamKey(familyId),
          '*',
          { seq: String(seq), room, event, envelope: JSON.stringify(envelope) },
          { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: REPLAY_MAX_EVENTS } },
        )
        .expire(streamKey(familyId), REPLAY_TTL_SECONDS)
        .expire(seqKey(familyId), REPLAY_TTL_SECONDS * 30)
        .exec();
    }
    if (!this.nsp) return;
    // The typed emit cannot narrow a generic event name; callers above enforce the payload type.
    const target = this.nsp.to(room) as unknown as { emit(ev: string, payload: unknown): boolean };
    target.emit(event, envelope);
  }
}
