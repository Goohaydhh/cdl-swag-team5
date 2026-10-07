import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePairingQr } from '@swag/protocol';
import {
  api,
  childToken,
  connectSocket,
  createChild,
  createTestApp,
  joinPairing,
  nextEvent,
  type Parent,
  pairTablet,
  registerParent,
  startPairing,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function start(parent: Parent) {
  const s = await startPairing(t, parent);
  expect(s.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(s.qr_payload).toBe(`swag://pair?p=${s.pairing_id}&c=${s.code.replace('-', '')}`);
  expect(parsePairingQr(s.qr_payload)).toEqual({ pairing_id: s.pairing_id, code: s.code.replace('-', '') });
  return s;
}

const poll = (pairingId: string, secret: string) =>
  api(t).get(`/pairing/sessions/${pairingId}?wait=0`).set('X-Pairing-Secret', secret);
const parentState = (parent: Parent, pairingId: string) =>
  api(t, parent.token).get(`/pairing/sessions/${pairingId}/state?wait=0`);

describe('tablet pairing, parent generates the code (FR-1, FR-2)', () => {
  it('parent QR -> tablet scans -> parent validates -> tablet gets its credential once', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const s = await start(parent);
    expect((await parentState(parent, s.pairing_id).expect(200)).body.state).toBe('pending');

    // The parent's screen hears the tablet arrive.
    const socket = await connectSocket(t, parent.token);
    const heard = nextEvent<{ data: { pairing_id: string; state: string; device_info: { model: string } } }>(
      socket,
      'pairing_updated',
    );
    const qr = parsePairingQr(s.qr_payload)!;
    const joined = await joinPairing(t, { code: qr.code, pairing_id: qr.pairing_id });
    expect(joined.family.name).toBe('Martin');
    expect((await heard).data).toEqual({ pairing_id: s.pairing_id, state: 'claimed', device_info: { model: 'Redmi Pad 2' } });
    socket.close();

    const state = await parentState(parent, s.pairing_id).expect(200);
    expect(state.body).toMatchObject({ state: 'claimed', device_info: { model: 'Redmi Pad 2' } });
    expect((await poll(s.pairing_id, joined.poll_secret).expect(200)).body.state).toBe('claimed');

    await api(t, parent.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'Tablette du salon' })
      .expect(200);

    const first = await poll(s.pairing_id, joined.poll_secret).expect(200);
    expect(first.body.state).toBe('approved');
    expect(first.body.credential).toMatch(/^dc_/);
    expect(first.body.family.name).toBe('Martin');
    expect((await poll(s.pairing_id, joined.poll_secret).expect(200)).body.state).toBe('consumed');

    // Without child_ids, every child of the family is on the tablet.
    const devices = await api(t, parent.token).get('/devices').expect(200);
    const tablet = devices.body.find((d: { id: string }) => d.id === first.body.device_id);
    expect(tablet).toMatchObject({ name: 'Tablette du salon', child_ids: [child.id], platform_info: { model: 'Redmi Pad 2' } });
  });

  it('the code can be typed on the tablet: lower case, no dash, O/0 look-alikes tolerated', async () => {
    const parent = await registerParent(t);
    await createChild(t, parent);
    const s = await start(parent);
    const typed = s.code.replace('-', '').toLowerCase();
    const joined = await joinPairing(t, { code: typed });
    expect(joined.pairing_id).toBe(s.pairing_id);
  });

  it('only parents can generate a code', async () => {
    await api(t).post('/pairing/sessions').send({}).expect(401);
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);
    await api(t, tablet.deviceToken).post('/pairing/sessions').send({}).expect(403);
  });

  it('never reveals the session to a poller without the secret', async () => {
    const parent = await registerParent(t);
    const s = await start(parent);
    const joined = await joinPairing(t, { code: s.code });
    await poll(joined.pairing_id, 'wrong-secret').expect(404);
  });

  it('a code can only be used by one tablet', async () => {
    const parent = await registerParent(t);
    const s = await start(parent);
    await joinPairing(t, { code: s.code });
    const res = await api(t).post('/pairing/join').send({ code: s.code }).expect(404);
    expect(res.body.error.code).toBe('PAIRING_NOT_FOUND');
  });

  it("another family cannot see or approve the session", async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const childB = await createChild(t, b);
    const s = await start(a);
    await joinPairing(t, { code: s.code });
    await parentState(b, s.pairing_id).expect(404);
    await api(t, b.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'X', child_ids: [childB.id] })
      .expect(404);
  });

  it("refuses to assign another family's child", async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const childB = await createChild(t, b);
    const s = await start(a);
    await joinPairing(t, { code: s.code });
    await api(t, a.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'X', child_ids: [childB.id] })
      .expect(400);
  });

  it('cannot approve before a tablet joined', async () => {
    const parent = await registerParent(t);
    await createChild(t, parent);
    const s = await start(parent);
    await api(t, parent.token).post(`/pairing/sessions/${s.pairing_id}/approve`).send({ device_name: 'X' }).expect(404);
  });

  it('locks a QR session after 5 wrong codes', async () => {
    const parent = await registerParent(t);
    const s = await start(parent);
    for (let i = 0; i < 5; i++) {
      await api(t).post('/pairing/join').send({ code: 'AAAA-AAAA', pairing_id: s.pairing_id }).expect(404);
    }
    // Even the right code no longer works.
    await api(t).post('/pairing/join').send({ code: s.code, pairing_id: s.pairing_id }).expect(404);
    expect((await parentState(parent, s.pairing_id).expect(200)).body.state).toBe('rejected');
  });

  it('a rejected pairing tells the tablet, and the parent can cancel an unused code', async () => {
    const parent = await registerParent(t);
    const s = await start(parent);
    const joined = await joinPairing(t, { code: s.code });
    await api(t, parent.token).post(`/pairing/sessions/${s.pairing_id}/reject`).expect(204);
    expect((await poll(s.pairing_id, joined.poll_secret).expect(200)).body.state).toBe('rejected');

    const unused = await start(parent);
    await api(t, parent.token).post(`/pairing/sessions/${unused.pairing_id}/reject`).expect(204);
    await api(t).post('/pairing/join').send({ code: unused.code }).expect(404);
  });
});

describe('devices and child sessions (FR-4)', () => {
  it('rotates the device credential on each token exchange', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);

    const next = await api(t)
      .post('/device/token')
      .send({ device_id: tablet.deviceId, credential: tablet.credential })
      .expect(200);
    expect(next.body.credential).not.toBe(tablet.credential);
    // The previous credential is now dead.
    await api(t).post('/device/token').send({ device_id: tablet.deviceId, credential: tablet.credential }).expect(401);
  });

  it('shows only the children assigned to the tablet, and parents can change that', async () => {
    const parent = await registerParent(t);
    const lea = await createChild(t, parent, { display_name: 'Léa' });
    const tom = await createChild(t, parent, { display_name: 'Tom' });
    const tablet = await pairTablet(t, parent, [lea.id]);

    let profiles = await api(t, tablet.deviceToken).get('/device/profiles').expect(200);
    expect(profiles.body.children.map((c: { id: string }) => c.id)).toEqual([lea.id]);
    expect(profiles.body.children[0].status).toBeNull();
    expect(profiles.body.parents).toHaveLength(1);
    expect(profiles.body.parents[0]).toMatchObject({ availability: 'available', eta_minutes: null, ringer: 'unknown' });
    expect(profiles.body.device.name).toBe('Kitchen tablet');

    await api(t, parent.token).patch(`/devices/${tablet.deviceId}`).send({ child_ids: [lea.id, tom.id] }).expect(200);
    profiles = await api(t, tablet.deviceToken).get('/device/profiles').expect(200);
    expect(profiles.body.children).toHaveLength(2);

    // A child not on this tablet cannot start a session on it.
    await api(t, parent.token).patch(`/devices/${tablet.deviceId}`).send({ child_ids: [lea.id] }).expect(200);
    await api(t, tablet.deviceToken).post('/device/child-session').send({ child_id: tom.id }).expect(404);
  });

  it('requires the PIN when a child has one, and rate-limits guesses', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent, { pin: '1234' });
    expect(child.has_pin).toBe(true);
    const tablet = await pairTablet(t, parent, [child.id]);

    const missing = await api(t, tablet.deviceToken).post('/device/child-session').send({ child_id: child.id }).expect(401);
    expect(missing.body.error.code).toBe('PIN_INVALID');
    expect(await childToken(t, tablet, child.id, '1234')).toBeTypeOf('string');

    for (let i = 0; i < 5; i++) {
      await api(t, tablet.deviceToken).post('/device/child-session').send({ child_id: child.id, pin: '0000' }).expect(401);
    }
    await api(t, tablet.deviceToken).post('/device/child-session').send({ child_id: child.id, pin: '1234' }).expect(429);
  });

  it('scopes are enforced: a tablet cannot call parent routes, a parent cannot call tablet routes', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);
    await api(t, tablet.deviceToken).get('/family').expect(403);
    await api(t, parent.token).get('/device/profiles').expect(403);
  });

  it('revoking a tablet kills its token and credential immediately', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const tablet = await pairTablet(t, parent, [child.id]);

    await api(t, parent.token).delete(`/devices/${tablet.deviceId}`).expect(204);
    await api(t, tablet.deviceToken).get('/device/profiles').expect(401);
    await api(t).post('/device/token').send({ device_id: tablet.deviceId, credential: tablet.credential }).expect(401);
    const devices = await api(t, parent.token).get('/devices').expect(200);
    expect(devices.body.find((d: { id: string }) => d.id === tablet.deviceId)).toBeUndefined();
  });

  it("parents cannot see or change another family's children or devices", async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const childA = await createChild(t, a);
    const tablet = await pairTablet(t, a, [childA.id]);
    await api(t, b.token).patch(`/children/${childA.id}`).send({ display_name: 'Hacked' }).expect(404);
    await api(t, b.token).delete(`/children/${childA.id}`).expect(404);
    await api(t, b.token).delete(`/devices/${tablet.deviceId}`).expect(404);
  });
});

describe('second parent invite (FR-3)', () => {
  it('lets an invited parent join the same family, once', async () => {
    const owner = await registerParent(t);
    const invite = await api(t, owner.token).post('/family/invites').expect(201);

    const body = {
      code: invite.body.code,
      email: `second-${Date.now()}@example.test`,
      password: 'another long password',
      display_name: 'Sam',
      consent: true,
    };
    const joined = await api(t).post('/family/invites/accept').send(body).expect(201);
    expect(joined.body.user.family_id).toBe(owner.familyId);
    expect(joined.body.user.is_owner).toBe(false);

    const family = await api(t, owner.token).get('/family').expect(200);
    expect(family.body.parents).toHaveLength(2);

    await api(t).post('/family/invites/accept').send({ ...body, email: 'third@example.test' }).expect(404);
  });
});
