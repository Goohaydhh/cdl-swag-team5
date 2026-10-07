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

describe('one family chat only (product decision)', () => {
  it('there is no way to open a private thread', async () => {
    const { parent, lea } = await family();
    await api(t, parent.token).post('/conversations').send({ member: { type: 'child', id: lea.id } }).expect(404);
    const list = await api(t, lea.token).get('/conversations').expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].is_group).toBe(true);
    const fam = await api(t, parent.token).get('/conversations/family').expect(200);
    expect(fam.body.id).toBe(list.body[0].id);
  });
});

describe('the tablet writes with "who is speaking" chips', () => {
  async function tabletFamily() {
    const parent = await registerParent(t);
    const lea = await createChild(t, parent, { display_name: 'Léa' });
    const tom = await createChild(t, parent, { display_name: 'Tom' });
    const ines = await createChild(t, parent, { display_name: 'Inès' });
    const tablet = await pairTablet(t, parent, [lea.id, tom.id]);
    return { parent, lea, tom, ines, tablet };
  }

  it('a shared message from Léa and Tom reaches the parent live', async () => {
    const { parent, lea, tom, tablet } = await tabletFamily();
    const group = await groupId(tablet.deviceToken);
    expect(group).toBe(await groupId(parent.token));

    const parentSocket = await connectSocket(t, parent.token);
    const tabletSocket = await connectSocket(t, tablet.deviceToken);
    const heard = nextEvent<{ data: { message: { sender: { type: string; id: string }; speaker_ids: string[]; body: string } } }>(
      parentSocket,
      'chat_message_created',
    );
    const ack = await tabletSocket.emitWithAck('chat_message', { ...text(group, 'On est rentrés !'), speaker_ids: [lea.id, tom.id] });
    expect(ack).toMatchObject({ ok: true });
    const { message } = (await heard).data;
    expect(message.speaker_ids).toEqual([lea.id, tom.id]);
    expect(message.sender).toEqual({ type: 'child', id: lea.id });
    for (const s of [parentSocket, tabletSocket]) s.close();
  });

  it('a single checked child is a personal message; parents have no speakers', async () => {
    const { parent, tom, tablet } = await tabletFamily();
    const group = await groupId(tablet.deviceToken);
    const sent = await api(t, tablet.deviceToken)
      .post(`/conversations/${group}/messages`)
      .send({ ...text(group, 'Je suis chez Hugo'), speaker_ids: [tom.id] })
      .expect(201);
    expect(sent.body.message.speaker_ids).toEqual([tom.id]);
    const fromParent = await api(t, parent.token).post(`/conversations/${group}/messages`).send(text(group, 'OK')).expect(201);
    expect(fromParent.body.message.speaker_ids).toEqual([]);
  });

  it('refuses a speaker who is not on this tablet', async () => {
    const { ines, tablet } = await tabletFamily();
    const group = await groupId(tablet.deviceToken);
    await api(t, tablet.deviceToken)
      .post(`/conversations/${group}/messages`)
      .send({ ...text(group, 'Coucou'), speaker_ids: [ines.id] })
      .expect(400);
  });

  it('the tablet sets the status of each checked child', async () => {
    const { parent, lea, tom, ines, tablet } = await tabletFamily();
    const at = new Date().toISOString();
    for (const child of [lea, tom]) {
      await api(t, tablet.deviceToken)
        .post(`/children/${child.id}/status`)
        .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: at })
        .expect(200);
    }
    await api(t, tablet.deviceToken)
      .post(`/children/${ines.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: at })
      .expect(403);
    const overview = await api(t, parent.token).get('/family/overview').expect(200);
    const statuses = Object.fromEntries(
      overview.body.children.map((c: { id: string; status: { status: string } | null }) => [c.id, c.status?.status ?? null]),
    );
    expect(statuses).toEqual({ [lea.id]: 'at_home', [tom.id]: 'at_home', [ines.id]: null });
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

  it('a tablet whose children were all removed cannot chat', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);
    await api(t, parent.token).patch(`/devices/${tablet.deviceId}`).send({ child_ids: [] }).expect(200);
    await api(t, tablet.deviceToken).get('/conversations').expect(403);
  });
});
