import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PushService } from '../src/push/push.service';
import {
  api,
  childToken,
  connectSocket,
  createChild,
  createTestApp,
  nextEvent,
  pairTablet,
  registerParent,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

/** A parent and two children (Léa, Tom) on one tablet, each with a child token. */
async function family() {
  const parent = await registerParent(t);
  const lea = await createChild(t, parent, { display_name: 'Léa' });
  const tom = await createChild(t, parent, { display_name: 'Tom' });
  const tablet = await pairTablet(t, parent, [lea.id, tom.id]);
  return {
    parent,
    lea: { ...lea, token: await childToken(t, tablet, lea.id) },
    tom: { ...tom, token: await childToken(t, tablet, tom.id) },
  };
}

const text = (conversationId: string, body: string) => ({
  client_msg_id: randomUUID(),
  conversation_id: conversationId,
  kind: 'text',
  body,
});

async function groupId(token: string) {
  const list = await api(t, token).get('/conversations').expect(200);
  return list.body.find((c: { is_group: boolean }) => c.is_group).id as string;
}

describe('family chat (FR-10, FR-12)', () => {
  it('everyone shares one group conversation with live delivery and history', async () => {
    const { parent, lea } = await family();
    const group = await groupId(parent.token);
    expect(await groupId(lea.token)).toBe(group);

    const leaSocket = await connectSocket(t, lea.token);
    const parentSocket = await connectSocket(t, parent.token);
    const received = nextEvent<{ data: { message: { body: string; sender: { type: string } } } }>(
      leaSocket,
      'chat_message_created',
    );
    const ack = await parentSocket.emitWithAck('chat_message', text(group, 'Goûter dans le placard !'));
    expect(ack).toMatchObject({ ok: true, duplicate: false });
    expect((await received).data.message).toMatchObject({ body: 'Goûter dans le placard !', sender: { type: 'user' } });

    const history = await api(t, lea.token).get(`/conversations/${group}/messages`).expect(200);
    expect(history.body.items[0].id).toBe(ack.message_id);
    for (const s of [leaSocket, parentSocket]) s.close();
  });

  it('a retried client_msg_id does not create a second message', async () => {
    const { lea } = await family();
    const group = await groupId(lea.token);
    const body = text(group, 'Je suis rentrée');
    const first = await api(t, lea.token).post(`/conversations/${group}/messages`).send(body).expect(201);
    const again = await api(t, lea.token).post(`/conversations/${group}/messages`).send(body).expect(201);
    expect(again.body).toMatchObject({ duplicate: true, message: { id: first.body.message.id } });
    const history = await api(t, lea.token).get(`/conversations/${group}/messages`).expect(200);
    expect(history.body.items).toHaveLength(1);
  });

  it('pages history newest first', async () => {
    const { parent } = await family();
    const group = await groupId(parent.token);
    for (let i = 0; i < 5; i++) {
      await api(t, parent.token).post(`/conversations/${group}/messages`).send(text(group, `m${i}`)).expect(201);
    }
    const p1 = await api(t, parent.token).get(`/conversations/${group}/messages?limit=3`).expect(200);
    expect(p1.body.items.map((m: { body: string }) => m.body)).toEqual(['m4', 'm3', 'm2']);
    const p2 = await api(t, parent.token)
      .get(`/conversations/${group}/messages?limit=3&before=${p1.body.next_before}`)
      .expect(200);
    expect(p2.body.items.map((m: { body: string }) => m.body)).toEqual(['m1', 'm0']);
    expect(p2.body.next_before).toBeNull();
  });

  it('counts unread messages and moves the read marker forward only', async () => {
    const { parent, lea } = await family();
    const group = await groupId(parent.token);
    const ids: string[] = [];
    for (const b of ['a', 'b', 'c']) {
      ids.push((await api(t, lea.token).post(`/conversations/${group}/messages`).send(text(group, b)).expect(201)).body.message.id);
    }
    const unread = async () =>
      (await api(t, parent.token).get('/conversations').expect(200)).body.find((c: { is_group: boolean }) => c.is_group)
        .unread_count;
    expect(await unread()).toBe(3);

    const socket = await connectSocket(t, parent.token);
    await socket.emitWithAck('chat_read', { conversation_id: group, up_to_message_id: ids[1] });
    expect(await unread()).toBe(1);
    await socket.emitWithAck('chat_read', { conversation_id: group, up_to_message_id: ids[0] }); // older: ignored
    expect(await unread()).toBe(1);
    socket.close();
  });
});

describe('direct threads', () => {
  it("a parent-child thread stays private from the sibling", async () => {
    const { parent, lea, tom } = await family();
    const thread = await api(t, parent.token)
      .post('/conversations')
      .send({ member: { type: 'child', id: lea.id } })
      .expect(201);
    // Opening it again returns the same thread.
    const again = await api(t, lea.token).post('/conversations').send({ member: { type: 'user', id: parent.userId } }).expect(201);
    expect(again.body.id).toBe(thread.body.id);

    const tomSocket = await connectSocket(t, tom.token);
    const leaSocket = await connectSocket(t, lea.token);
    let tomHeard = false;
    tomSocket.on('chat_message_created', () => (tomHeard = true));
    const leaHears = nextEvent(leaSocket, 'chat_message_created');

    await api(t, parent.token).post(`/conversations/${thread.body.id}/messages`).send(text(thread.body.id, 'Bravo !')).expect(201);
    await leaHears;
    await new Promise((r) => setTimeout(r, 200));
    expect(tomHeard).toBe(false);
    await api(t, tom.token).get(`/conversations/${thread.body.id}/messages`).expect(404);
    for (const s of [tomSocket, leaSocket]) s.close();
  });

  it('children cannot open a thread with each other', async () => {
    const { lea, tom } = await family();
    await api(t, lea.token).post('/conversations').send({ member: { type: 'child', id: tom.id } }).expect(400);
  });

  it("nobody can open a thread with another family's member", async () => {
    const a = await family();
    const b = await family();
    await api(t, a.parent.token).post('/conversations').send({ member: { type: 'child', id: b.lea.id } }).expect(404);
  });
});

describe('stickers and notifications (FR-11)', () => {
  it('accepts catalogue stickers only', async () => {
    const { lea } = await family();
    const group = await groupId(lea.token);
    const packs = await api(t, lea.token).get('/stickers/packs').expect(200);
    const code = packs.body[0].stickers[0].code;
    await api(t, lea.token)
      .post(`/conversations/${group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'sticker', sticker_code: code })
      .expect(201);
    await api(t, lea.token)
      .post(`/conversations/${group}/messages`)
      .send({ client_msg_id: randomUUID(), kind: 'sticker', sticker_code: 'nope/unknown' })
      .expect(400);
  });

  it("pushes parents when a child writes, with IDs only", async () => {
    const { parent, lea } = await family();
    await api(t, parent.token).put('/devices/me/push-token').send({ push_token: 'fcm-chat' }).expect(204);
    const group = await groupId(lea.token);
    const push = t.app.get(PushService);
    const sent = await api(t, lea.token).post(`/conversations/${group}/messages`).send(text(group, 'Coucou')).expect(201);
    await expect
      .poll(() => push.recorded.find((r) => r.data.message_id === sent.body.message.id)?.data)
      .toEqual({ type: 'chat_message', message_id: sent.body.message.id, conversation_id: group });
  });

  it('a tablet without a child profile cannot chat', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);
    await api(t, tablet.deviceToken).get('/conversations').expect(403);
  });
});
