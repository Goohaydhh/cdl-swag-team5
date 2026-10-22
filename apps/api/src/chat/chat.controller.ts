import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ChatMessageInput, MessagesQuery } from '@swag/protocol';
import { CurrentPrincipal, Scopes } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { UuidParam, ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';
import { stickerCatalog } from './stickers';

/** One conversation per family (the family chat). The tablet posts with its device token. */
@Scopes('parent', 'child', 'device')
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  list(@CurrentPrincipal() p: Principal) {
    return this.chat.list(p);
  }

  /** Shortcut for the apps: the family chat with its unread count. */
  @Get('conversations/family')
  async family(@CurrentPrincipal() p: Principal) {
    return (await this.chat.list(p))[0];
  }

  @Get('conversations/:id/messages')
  history(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) id: string,
    @Query(new ZodPipe(MessagesQuery)) q: MessagesQuery,
  ) {
    return this.chat.history(p, id, q.before, q.limit);
  }

  /** REST fallback of the `chat_message` socket event; `conversation_id` in the path wins. */
  @Post('conversations/:id/messages')
  send(
    @CurrentPrincipal() p: Principal,
    @Param('id', UuidParam) id: string,
    @Body() body: Record<string, unknown>,
  ) {
    const input = new ZodPipe(ChatMessageInput).transform({ ...body, conversation_id: id });
    return this.chat.send(p, input);
  }

  @Get('stickers/packs')
  stickers() {
    return stickerCatalog();
  }
}
