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

export function memberOf(p: Principal): MemberRef {
  if (p.scope === 'parent') return { type: 'user', id: p.sub };
  if (p.scope === 'child') return { type: 'child', id: p.sub };
  throw ApiError.forbidden('Pick a child profile to chat');
}

const memberRoom = (m: MemberRef) => (m.type === 'user' ? rooms.user(m.id) : rooms.child(m.id));
const directKey = (a: MemberRef, b: MemberRef) =>
  [`${a.type}:${a.id}`, `${b.type}:${b.id}`].sort().join('|');

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
    created_at: m.createdAt.toISOString(),
  };
}

/** Family group chat and parent-child threads (FR-10, FR-11, FR-12). */
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

  /** Rooms a socket joins on connect: its member room and every conversation it belongs to. */
  async socketRooms(p: Principal): Promise<string[]> {
    if (p.scope === 'device') return [];
    const me = memberOf(p);
    const group = await this.ensureGroup(p.fam);
    const direct = await this.prisma.conversationMember.findMany({
      where: { memberType: me.type, memberId: me.id, conversation: { familyId: p.fam, isGroup: false } },
      select: { conversationId: true },
    });
    return [memberRoom(me), rooms.conversation(group.id), ...direct.map((d) => rooms.conversation(d.conversationId))];
  }

  async list(p: Principal) {
    const me = memberOf(p);
    const group = await this.ensureGroup(p.fam);
    const direct = await this.prisma.conversation.findMany({
      where: { familyId: p.fam, isGroup: false, members: { some: { memberType: me.type, memberId: me.id } } },
      include: { members: true },
      orderBy: { createdAt: 'asc' },
    });
    const all = [{ ...group, members: [] as { memberType: string; memberId: string }[] }, ...direct];
    return Promise.all(all.map((c) => this.describe(c, me)));
  }

  /** Opens (or returns) the direct thread between the caller and another family member. */
  async openDirect(p: Principal, other: MemberRef) {
    const me = memberOf(p);
    if (me.type === other.type && me.id === other.id) throw ApiError.validation('Cannot chat with yourself');
    if (me.type === 'child' && other.type === 'child') {
      throw ApiError.validation('Children chat with parents, not with each other');
    }
    await this.assertFamilyMember(p.fam, other);

    const key = directKey(me, other);
    let conversation = await this.prisma.conversation.findUnique({ where: { directKey: key }, include: { members: true } });
    if (!conversation) {
      try {
        conversation = await this.prisma.conversation.create({
          data: {
            id: newId(),
            familyId: p.fam,
            directKey: key,
            members: {
              create: [me, other].map((m) => ({ memberType: m.type, memberId: m.id })),
            },
          },
          include: { members: true },
        });
        // Live sockets of both members start receiving this thread right away.
        for (const m of [me, other]) this.realtime.joinRoom(memberRoom(m), rooms.conversation(conversation.id));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        conversation = await this.prisma.conversation.findUniqueOrThrow({
          where: { directKey: key },
          include: { members: true },
        });
      }
    }
    return this.describe(conversation, me);
  }

  // ---------------------------------------------------------------- messages

  async send(p: Principal, input: ChatMessageInput): Promise<{ message: MessageDto; duplicate: boolean }> {
    const me = memberOf(p);
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
    if (await this.parentsShouldBePushed(conversation, me)) {
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
    const me = memberOf(p);
    await this.assertMember(p, input.conversation_id);
    const message = await this.prisma.message.findFirst({
      where: { id: input.up_to_message_id, conversationId: input.conversation_id },
    });
    if (!message) throw ApiError.notFound('Message');

    const key = {
      conversationId_memberType_memberId: {
        conversationId: input.conversation_id,
        memberType: me.type,
        memberId: me.id,
      },
    };
    const current = await this.prisma.conversationMember.findUnique({ where: key });
    if (current?.lastReadId && current.lastReadId >= message.id) return; // UUIDv7 sorts by time
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

  async typing(p: Principal, conversationId: string, typing: boolean) {
    const me = memberOf(p);
    await this.assertMember(p, conversationId);
    await this.realtime.toConversationVolatile(p.fam, conversationId, 'chat_typing', {
      conversation_id: conversationId,
      member: me,
      typing,
    });
  }

  // ---------------------------------------------------------------- helpers

  async assertMember(p: Principal, conversationId: string): Promise<Conversation> {
    const me = memberOf(p);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, familyId: p.fam },
      include: { members: { where: { memberType: me.type, memberId: me.id } } },
    });
    if (!conversation || (!conversation.isGroup && conversation.members.length === 0)) {
      throw ApiError.notFound('Conversation');
    }
    return conversation;
  }

  private async assertFamilyMember(familyId: string, m: MemberRef) {
    const found =
      m.type === 'user'
        ? await this.prisma.user.count({ where: { id: m.id, familyId } })
        : await this.prisma.childProfile.count({ where: { id: m.id, familyId } });
    if (!found) throw ApiError.notFound('Family member');
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

  /** Parents get a push for messages from children, and for group messages from another parent. */
  private async parentsShouldBePushed(conversation: Conversation, sender: MemberRef) {
    if (sender.type === 'child') return true;
    if (conversation.isGroup) return true;
    const others = await this.prisma.conversationMember.count({
      where: { conversationId: conversation.id, memberType: 'user', NOT: { memberId: sender.id } },
    });
    return others > 0;
  }

  private async describe(
    c: Conversation & { members: { memberType: string; memberId: string }[] },
    me: MemberRef,
  ) {
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
      members: c.isGroup ? null : c.members.map((m) => ({ type: m.memberType, id: m.memberId })),
      last_message: last ? toMessageDto(last) : null,
      unread_count: unread,
      last_read_id: mine?.lastReadId ?? null,
    };
  }
}
