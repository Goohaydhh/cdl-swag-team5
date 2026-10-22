import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe('real-time gateway', () => {
  it('refuses sockets without a valid token, including dev tokens when disabled', async () => {
    await expect(connectSocket(t, 'garbage')).rejects.toThrow();
    await expect(connectSocket(t, `dev:${randomUUID()}:parent:${randomUUID()}`)).rejects.toThrow();
  });

  it("delivers a child's status to the parents of that family only", async () => {
    const parent = await registerParent(t);
    const stranger = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);

    const parentSocket = await connectSocket(t, parent.token);
    const strangerSocket = await connectSocket(t, stranger.token);
    const childSocket = await connectSocket(t, await childToken(t, tablet, child.id));

    let strangerHeard = false;
    strangerSocket.on('status_updated', () => (strangerHeard = true));

    const received = nextEvent<{ seq: number; data: { child_id: string; status: string } }>(
      parentSocket,
      'status_updated',
    );
    const ack = await childSocket.emitWithAck('status_update', {
      client_event_id: randomUUID(),
      child_id: child.id,
      status: 'at_home',
      occurred_at: new Date().toISOString(),
    });
    expect(ack.ok).toBe(true);
    const event = await received;
    expect(event.data).toMatchObject({ child_id: child.id, status: 'at_home' });
    expect(event.seq).toBeGreaterThan(0);

    await new Promise((r) => setTimeout(r, 200));
    expect(strangerHeard).toBe(false);
    for (const s of [parentSocket, strangerSocket, childSocket]) s.close();
  });

  it('a parent token cannot send a child status', async () => {
    const parent = await registerParent(t);
    const socket = await connectSocket(t, parent.token);
    const ack = await socket.emitWithAck('status_update', {
      client_event_id: randomUUID(),
      child_id: randomUUID(),
      status: 'at_home',
      occurred_at: new Date().toISOString(),
    });
    expect(ack).toMatchObject({ ok: false, error: { code: 'FORBIDDEN_SCOPE' } });
    socket.close();
  });

  it('revoking a tablet tells it and closes its socket', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);
    const socket = await connectSocket(t, tablet.deviceToken);

    const revoked = nextEvent<{ data: { reason: string } }>(socket, 'device_revoked');
    const closed = nextEvent(socket, 'disconnect');
    await api(t, parent.token).delete(`/devices/${tablet.deviceId}`).expect(204);
    expect((await revoked).data.reason).toBe('parent_revoked');
    await closed;

    await expect(connectSocket(t, tablet.deviceToken)).rejects.toThrow();
  });
});
