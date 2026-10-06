import { describe, expect, it } from 'vitest';
import { ChatMessageInput, StatusUpdateInput } from './schemas';

const uuid = '0192f3a0-7b1c-7a3e-9c2d-4e5f6a7b8c9d';

describe('StatusUpdateInput', () => {
  it('accepts a valid status tap', () => {
    const r = StatusUpdateInput.safeParse({
      client_event_id: uuid,
      child_id: uuid,
      status: 'at_home',
      occurred_at: '2026-10-06T16:32:00+02:00',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an unknown status', () => {
    const r = StatusUpdateInput.safeParse({
      client_event_id: uuid,
      child_id: uuid,
      status: 'on_the_moon',
      occurred_at: '2026-10-06T16:32:00+02:00',
    });
    expect(r.success).toBe(false);
  });
});

describe('ChatMessageInput', () => {
  it('requires media_id for a drawing', () => {
    const r = ChatMessageInput.safeParse({
      client_msg_id: uuid,
      conversation_id: uuid,
      kind: 'drawing',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a text message', () => {
    const r = ChatMessageInput.safeParse({
      client_msg_id: uuid,
      conversation_id: uuid,
      kind: 'text',
      body: 'Je suis rentré !',
    });
    expect(r.success).toBe(true);
  });
});
