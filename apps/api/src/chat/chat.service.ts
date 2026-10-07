import { Injectable } from '@nestjs/common';
import {
  type ChatMessageInput,
  type ChatReadInput,
  type MemberRef,
  type Message as MessageDto,
  rooms,
} from '@swag/protocol';
import type { Principal } from '../auth/principal';
import { ApiError } from '../common/api-error';
import { newId } from '../common/crypto';
import type { Conversation, Message } from '../generated/prisma/client';
import { MediaService } from '../media/media.service';
import { GifsService } from '../media/gifs.service';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { RealtimeService } from '../realtime/realtime.service';
import { isStickerCode } from './stickers';

/** Who acts in the chat: the member that "owns" the action, and the children speaking (tablet chips). */
export interface ChatActor {
  me: MemberRef;
  speakerIds: string[];
}

const memberRoom = (m: MemberRef) => (m.type === 'user' ? rooms.user(m.id) : rooms.child(m.id));

export function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender: { type: m.senderType === 'child' ? 'child' : 'user', id: m.senderId! },
    kind: m.kind as MessageDto['kind'],
    ...(m.body !== null ? { body: m.body } : {}),
    ...(m.mediaId !== null ? { media_id: m.mediaId } : {}),
    ...(m.stickerCode !== null ? { sticker_code: m.stickerCode } : {}),
    ...(m.gifRef !== null ? { gif_ref: m.gifRef } : {}),
    speaker_ids: m.speakerIds,
    client_msg_id: m.clientMsgId,
    created_at: m.createdAt.toISOString(),
  };
}

/**
 * The family chat (FR-10, FR-11, FR-12). Product decision: ONE conversation per family, the
 * group chat. Parents, a child token, or the tablet itself (device token + `speaker_ids` from
 * the "who is speaking" chips) can post in it.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
    private readonly media: MediaService,
    private readonly gifs: GifsService,
  ) {}

  // ---------------------------------------------------------------- conversations

  /** Every family has exactly one group conversation, created on first use. */
  async ensureGroup(familyId: string): Promise<Conversation> {
    const existing = await this.prisma.conversation.findFirst({ where: { familyId, isGroup: true } });
    if (existing) return existing;
    try {
      return await this.prisma.conversation.create({ data: { id: newId(), familyId, isGroup: true } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return this.prisma.conversation.findFirstOrThrow({ where: { familyId, isGroup: true } });
    }
  }

  /** Rooms a socket joins on connect: its member room (if any) and the family chat. */
  async socketRooms(p: Principal): Promise<string[]> {
    const group = await this.ensureGroup(p.fam);
    if (p.scope === 'device') return [rooms.conversation(group.id)];
    const me = p.scope === 'parent' ? ({ type: 'user', id: p.sub } as const) : ({ type: 'child', id: p.sub } as const);
    return [memberRoom(me), rooms.conversation(group.id)];
  }

  /** Always one item: the family chat. Kept as a list so clients can stay generic. */
  async list(p: Principal) {
    const actor = await this.resolveActor(p);
    const group = await this.ensureGroup(p.fam);
    return [await this.describe(group, actor)];
  }

  // ---------------------------------------------------------------- messages

  async send(p: Principal, input: ChatMessageInput): Promise<{ message: MessageDto; duplicate: boolean }> {
    const { me, speakerIds } = await this.resolveActor(p, input.speaker_ids);
    const conversation = await this.assertMember(p, input.conversation_id);

    const existing = await this.prisma.message.findUnique({
      where: { senderType_senderId_clientMsgId: { senderType: me.type, senderId: me.id, clientMsgId: input.client_msg_id } },
    });
    if (existing) return { message: toMessageDto(existing), duplicate: true };

    const content = await this.validateContent(p.fam, input);
    let message: Message;
    try {
      message = await this.prisma.message.create({
        data: {
          id: newId(),
          conversationId: conversation.id,
          familyId: p.fam,
          senderType: me.type,
          senderId: me.id,
          kind: input.kind,
          clientMsgId: input.client_msg_id,
          speakerIds,
          ...content,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const raced = await this.prisma.message.findUniqueOrThrow({
        where: { senderType_senderId_clientMsgId: { senderType: me.type, senderId: me.id, clientMsgId: input.client_msg_id } },
      });
      return { message: toMessageDto(raced), duplicate: true };
    }

    const dto = toMessageDto(message);
    await this.realtime.toConversation(p.fam, conversation.id, 'chat_message_created', { message: dto });
    if (me.type === 'child' || conversation.isGroup) {
      this.push.notifyParents(
        p.fam,
        { type: 'chat_message', message_id: message.id, conversation_id: conversation.id },
        me.type === 'user' ? p.dev : undefined,
      );
    }
    return { message: dto, duplicate: false };
  }

  /** Newest first; pass the last id back as `before` to page further back (FR-12). */
  async history(p: Principal, conversationId: string, before: string | undefined, limit: number) {
    await this.assertMember(p, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId, deletedAt: null, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = messages.slice(0, limit);
    return {
      items: page.map(toMessageDto),
      next_before: messages.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Moves the caller's read marker forward (never back) and tells the conversation. */
  async markRead(p: Principal, input: ChatReadInput) {
    const actor = await this.resolveActor(p);
    await this.assertMember(p, input.conversation_id);
    const message = await this.prisma.message.findFirst({
      where: { id: input.up_to_message_id, conversationId: input.conversation_id },
    });
    if (!message) throw ApiError.notFound('Message');

    // On the tablet, reading the chat counts for every child of the tablet.
    const readers: MemberRef[] =
      p.scope === 'device' ? actor.speakerIds.map((id) => ({ type: 'child', id })) : [actor.me];
    for (const me of readers) {
      const key = {
        conversationId_memberType_memberId: {
          conversationId: input.conversation_id,
          memberType: me.type,
          memberId: me.id,
        },
      };
      const current = await this.prisma.conversationMember.findUnique({ where: key });
      if (current?.lastReadId && current.lastReadId >= message.id) continue; // UUIDv7 sorts by time
      await this.prisma.conversationMember.upsert({
        where: key,
        create: { conversationId: input.conversation_id, memberType: me.type, memberId: me.id, lastReadId: message.id },
        update: { lastReadId: message.id },
      });
      await this.realtime.toConversation(p.fam, input.conversation_id, 'chat_read', {
        conversation_id: input.conversation_id,
        member: me,
        up_to_message_id: message.id,
      });
    }
  }

  async typing(p: Principal, conversationId: string, typing: boolean, speakerIds?: string[]) {
    const actor = await this.resolveActor(p, speakerIds);
    await this.assertMember(p, conversationId);
    await this.realtime.toConversationVolatile(p.fam, conversationId, 'chat_typing', {
      conversation_id: conversationId,
      member: actor.me,
      ...(actor.speakerIds.length > 1 ? { speaker_ids: actor.speakerIds } : {}),
      typing,
    });
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Resolves who is acting. Parents and child tokens act as themselves. The tablet's device
   * token acts for the children checked in the "who is speaking" chips, which must all be
   * assigned to that tablet; without chips it stands for all its children (reads, history).
   */
  async resolveActor(p: Principal, speakerIds?: string[]): Promise<ChatActor> {
    if (p.scope === 'parent') return { me: { type: 'user', id: p.sub }, speakerIds: [] };
    if (p.scope === 'child') return { me: { type: 'child', id: p.sub }, speakerIds: [p.sub] };

    const links = await this.prisma.deviceChildProfile.findMany({
      where: { deviceId: p.dev ?? p.sub, child: { familyId: p.fam } },
      include: { child: { select: { sortOrder: true, createdAt: true } } },
    });
    const onTablet = links
      .sort((a, b) => a.child.sortOrder - b.child.sortOrder || a.child.createdAt.getTime() - b.child.createdAt.getTime())
      .map((l) => l.childProfileId);
    if (!onTablet.length) throw ApiError.forbidden('No child is assigned to this tablet');
    const chosen = speakerIds?.length ? [...new Set(speakerIds)] : onTablet;
    if (chosen.some((id) => !onTablet.includes(id))) {
      throw ApiError.validation('speaker_ids must be children of this tablet');
    }
    return { me: { type: 'child', id: chosen[0]! }, speakerIds: chosen };
  }

  /** Only the family chat exists; legacy direct threads stay readable by their members. */
  async assertMember(p: Principal, conversationId: string): Promise<Conversation> {
    if (p.scope === 'device') {
      const group = await this.prisma.conversation.findFirst({
        where: { id: conversationId, familyId: p.fam, isGroup: true },
      });
      if (!group) throw ApiError.notFound('Conversation');
      return group;
    }
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, familyId: p.fam },
      include: {
        members: { where: { memberType: p.scope === 'parent' ? 'user' : 'child', memberId: p.sub } },
      },
    });
    if (!conversation || (!conversation.isGroup && conversation.members.length === 0)) {
      throw ApiError.notFound('Conversation');
    }
    return conversation;
  }

  private async validateContent(familyId: string, input: ChatMessageInput) {
    switch (input.kind) {
      case 'text':
        return { body: input.body! };
      case 'sticker':
        if (!isStickerCode(input.sticker_code!)) throw ApiError.validation('Unknown sticker');
        return { stickerCode: input.sticker_code! };
      case 'drawing':
        await this.media.assertUsable(familyId, input.media_id!);
        return { mediaId: input.media_id! };
      case 'gif': {
        // The GIF is copied into our storage so the child's device never loads it from Giphy.
        const mediaId = await this.gifs.importForMessage(familyId, input.gif_ref!);
        return { gifRef: input.gif_ref!, mediaId };
      }
    }
  }

  private async describe(c: Conversation, { me }: ChatActor) {
    const mine = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_memberType_memberId: { conversationId: c.id, memberType: me.type, memberId: me.id },
      },
    });
    const [last, unread] = await Promise.all([
      this.prisma.message.findFirst({
        where: { conversationId: c.id, deletedAt: null },
        orderBy: { id: 'desc' },
      }),
      this.prisma.message.count({
        where: {
          conversationId: c.id,
          deletedAt: null,
          NOT: { senderType: me.type, senderId: me.id },
          ...(mine?.lastReadId ? { id: { gt: mine.lastReadId } } : {}),
        },
      }),
    ]);
    return {
      id: c.id,
      is_group: c.isGroup,
      last_message: last ? toMessageDto(last) : null,
      unread_count: unread,
      last_read_id: mine?.lastReadId ?? null,
    };
  }
}
