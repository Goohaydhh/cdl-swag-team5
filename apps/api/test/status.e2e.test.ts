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
  type Parent,
  registerParent,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function family() {
  const parent = await registerParent(t);
  const child = await createChild(t, parent);
  const tablet = await pairTablet(t, parent, [child.id]);
  const token = await childToken(t, tablet, child.id);
  return { parent, child, tablet, token };
}

const statusBody = (childId: string, extra: Record<string, unknown> = {}) => ({
  client_event_id: randomUUID(),
  child_id: childId,
  status: 'at_home',
  occurred_at: new Date().toISOString(),
  ...extra,
});

const overview = async (parent: Parent) => (await api(t, parent.token).get('/family/overview').expect(200)).body;

describe('child status (FR-5, FR-6, FR-8)', () => {
  it('persists a status and shows it in the overview', async () => {
    const { parent, child, token } = await family();
    const socket = await connectSocket(t, token);
    const ack = await socket.emitWithAck('status_update', statusBody(child.id));
    expect(ack).toMatchObject({ ok: true, duplicate: false });

    const o = await overview(parent);
    expect(o.children[0].status).toMatchObject({ status: 'at_home', event_id: ack.event_id });
    socket.close();
  });

  it('replaying the same client_event_id is harmless: same event, no second broadcast', async () => {
    const { parent, child, token } = await family();
    const parentSocket = await connectSocket(t, parent.token);
    const childSocket = await connectSocket(t, token);
    let broadcasts = 0;
    parentSocket.on('status_updated', () => broadcasts++);

    const body = statusBody(child.id);
    const first = await childSocket.emitWithAck('status_update', body);
    const replay = await childSocket.emitWithAck('status_update', body);
    // The REST fallback with the same id is a duplicate too.
    const rest = await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: body.client_event_id, status: 'at_home', occurred_at: body.occurred_at })
      .expect(200);

    expect(replay).toMatchObject({ ok: true, duplicate: true, event_id: first.event_id });
    expect(rest.body).toEqual({ event_id: first.event_id, duplicate: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(broadcasts).toBe(1);
    for (const s of [parentSocket, childSocket]) s.close();
  });

  it('a delayed older event never overwrites a newer current status', async () => {
    const { parent, child, token } = await family();
    const now = Date.now();
    await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: new Date(now).toISOString() })
      .expect(200);
    // "Left home" tapped earlier but delivered later (offline outbox).
    await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'left_home', occurred_at: new Date(now - 60_000).toISOString() })
      .expect(200);

    expect((await overview(parent)).children[0].status.status).toBe('at_home');
  });

  it('clamps tablet timestamps that are far in the future', async () => {
    const { parent, child, token } = await family();
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_friend', occurred_at: future })
      .expect(200);
    const at = new Date((await overview(parent)).children[0].status.occurred_at).getTime();
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("a child cannot set a sibling's status", async () => {
    const { parent, tablet, token } = await family();
    const sibling = await createChild(t, parent, { display_name: 'Tom' });
    await api(t, parent.token).patch(`/devices/${tablet.deviceId}`).send({ child_ids: [sibling.id] }).expect(200);
    const res = await api(t, token)
      .post(`/children/${sibling.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: new Date().toISOString() })
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
  });

  it('paginates status history newest first', async () => {
    const { parent, child, token } = await family();
    const base = Date.now() - 10 * 60_000;
    for (let i = 0; i < 5; i++) {
      await api(t, token)
        .post(`/children/${child.id}/status`)
        .send({
          client_event_id: randomUUID(),
          status: i % 2 ? 'left_home' : 'at_home',
          occurred_at: new Date(base + i * 60_000).toISOString(),
        })
        .expect(200);
    }
    const page1 = await api(t, parent.token).get(`/children/${child.id}/status-history?limit=3`).expect(200);
    expect(page1.body.items).toHaveLength(3);
    const page2 = await api(t, parent.token)
      .get(`/children/${child.id}/status-history?limit=3&cursor=${page1.body.next_cursor}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.next_cursor).toBeNull();
    const times = [...page1.body.items, ...page2.body.items].map((e: { occurred_at: string }) => e.occurred_at);
    expect(times).toEqual([...times].sort().reverse());
  });

  it('pushes a data-only notification (IDs only) to parent phones with a push token', async () => {
    const { parent, child, token } = await family();
    await api(t, parent.token).put('/devices/me/push-token').send({ push_token: 'fcm-test-token' }).expect(204);
    const push = t.app.get(PushService);
    const before = push.recorded.length;

    const res = await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: new Date().toISOString() })
      .expect(200);

    await expect.poll(() => push.recorded.length).toBeGreaterThan(before);
    const sent = push.recorded.at(-1)!;
    expect(sent.data).toEqual({ type: 'status_updated', event_id: res.body.event_id, child_id: child.id });
  });
});

describe('parent availability and ringer (FR-7, FR-13)', () => {
  it('broadcasts "on my way" with an ETA to the tablet and shows it in the overview', async () => {
    const { parent, tablet } = await family();
    const tabletSocket = await connectSocket(t, tablet.deviceToken);
    const heard = nextEvent<{ data: { status: string; eta_minutes?: number } }>(tabletSocket, 'availability_updated');

    await api(t, parent.token).put('/me/availability').send({ status: 'on_my_way', eta_minutes: 15 }).expect(200);
    expect((await heard).data).toMatchObject({ status: 'on_my_way', eta_minutes: 15 });
    expect((await overview(parent)).parents[0]).toMatchObject({ availability: 'on_my_way', eta_minutes: 15 });
    tabletSocket.close();
  });

  it('ignores a ringer report older than the stored one', async () => {
    const { parent } = await family();
    const socket = await connectSocket(t, parent.token);
    const now = Date.now();
    await socket.emitWithAck('ringer_status', { mode: 'silent', changed_at: new Date(now).toISOString() });
    await socket.emitWithAck('ringer_status', { mode: 'normal', changed_at: new Date(now - 30_000).toISOString() });
    expect((await overview(parent)).parents[0].ringer).toBe('silent');
    socket.close();
  });

  it('"unavailable" no longer exists: it was merged into "busy" (Occupée)', async () => {
    const { parent } = await family();
    await api(t, parent.token).put('/me/availability').send({ status: 'unavailable' }).expect(400);
    await api(t, parent.token).put('/me/availability').send({ status: 'busy' }).expect(200);
    expect((await overview(parent)).parents[0].availability).toBe('busy');
  });

  it('a tablet cannot set parent availability', async () => {
    const { tablet } = await family();
    const socket = await connectSocket(t, tablet.deviceToken);
    const ack = await socket.emitWithAck('parent_availability', { status: 'busy' });
    expect(ack).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SCOPE' } });
    socket.close();
  });
});

describe('socket session features (section 6.2)', () => {
  it('replays missed events after a reconnect with sync_request', async () => {
    const { parent, child, token } = await family();
    const first = await connectSocket(t, parent.token);
    const seen = nextEvent<{ seq: number }>(first, 'status_updated');
    await api(t, token)
      .post(`/children/${child.id}/status`)
      .send({ client_event_id: randomUUID(), status: 'at_home', occurred_at: new Date().toISOString() })
      .expect(200);
    const lastSeq = (await seen).seq;
    first.close();

    // While the parent is offline, two more statuses arrive.
    for (const status of ['left_home', 'at_friend']) {
      await api(t, token)
        .post(`/children/${child.id}/status`)
        .send({ client_event_id: randomUUID(), status, occurred_at: new Date().toISOString() })
        .expect(200);
    }

    const again = await connectSocket(t, parent.token);
    const replayed: string[] = [];
    again.on('status_updated', (e: { data: { status: string } }) => replayed.push(e.data.status));
    const ack = await again.emitWithAck('sync_request', { since_seq: lastSeq });
    expect(ack.ok).toBe(true);
    expect(replayed).toEqual(['left_home', 'at_friend']);
    again.close();
  });

  it('reauth accepts a fresh token for the same identity and rejects a different one', async () => {
    const { parent } = await family();
    const other = await registerParent(t);
    const socket = await connectSocket(t, parent.token);
    const fresh = await api(t).post('/auth/refresh').send({ refresh_token: parent.refresh }).expect(200);

    expect((await socket.emitWithAck('reauth', { token: fresh.body.tokens.access_token })).ok).toBe(true);
    const wrong = await socket.emitWithAck('reauth', { token: other.token });
    expect(wrong).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
    socket.close();
  });

  it('announces when a child comes online', async () => {
    const { parent, child, token } = await family();
    const parentSocket = await connectSocket(t, parent.token);
    const online = nextEvent<{ data: { member: { type: string; id: string }; online: boolean } }>(
      parentSocket,
      'presence',
    );
    const childSocket = await connectSocket(t, token);
    expect((await online).data).toEqual({ member: { type: 'child', id: child.id }, online: true });
    for (const s of [parentSocket, childSocket]) s.close();
  });

  it('rate-limits status spam on one socket', async () => {
    const { child, token } = await family();
    const socket = await connectSocket(t, token);
    const acks = [];
    for (let i = 0; i < 11; i++) acks.push(await socket.emitWithAck('status_update', statusBody(child.id)));
    expect(acks.at(-1)).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED', retryable: true } });
    socket.close();
  });
});
