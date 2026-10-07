import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  api,
  childToken,
  createChild,
  createTestApp,
  pairTablet,
  registerParent,
  type TestApp,
} from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

async function startPairing() {
  const res = await api(t).post('/pairing/sessions').send({ device_info: { model: 'Redmi Pad 2' } }).expect(201);
  expect(res.body.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  expect(res.body.qr_payload).toContain(res.body.pairing_id);
  return res.body as { pairing_id: string; code: string; poll_secret: string };
}

const poll = (pairingId: string, secret: string) =>
  api(t).get(`/pairing/sessions/${pairingId}?wait=0`).set('X-Pairing-Secret', secret);

describe('tablet pairing (FR-1, FR-2)', () => {
  it('pairs a tablet end to end and hands out the credential exactly once', async () => {
    const parent = await registerParent(t);
    const child = await createChild(t, parent);
    const s = await startPairing();

    expect((await poll(s.pairing_id, s.poll_secret).expect(200)).body.state).toBe('pending');

    // Typed code: lower case, no dash, with the O/0 look-alike tolerated.
    const typed = s.code.replace('-', '').toLowerCase();
    const claim = await api(t, parent.token).post('/pairing/claim').send({ code: typed }).expect(200);
    expect(claim.body.device_info.model).toBe('Redmi Pad 2');

    await api(t, parent.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'Kitchen tablet', child_ids: [child.id] })
      .expect(200);

    const first = await poll(s.pairing_id, s.poll_secret).expect(200);
    expect(first.body.state).toBe('approved');
    expect(first.body.credential).toMatch(/^dc_/);
    expect(first.body.family.name).toBe('Martin');
    expect((await poll(s.pairing_id, s.poll_secret).expect(200)).body.state).toBe('consumed');
  });

  it('never reveals the session to a poller without the secret', async () => {
    const s = await startPairing();
    await poll(s.pairing_id, 'wrong-secret').expect(404);
  });

  it('a code can only be claimed once', async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const s = await startPairing();
    await api(t, a.token).post('/pairing/claim').send({ code: s.code }).expect(200);
    const res = await api(t, b.token).post('/pairing/claim').send({ code: s.code }).expect(404);
    expect(res.body.error.code).toBe('PAIRING_NOT_FOUND');
  });

  it('another family cannot approve a session it did not claim', async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const childB = await createChild(t, b);
    const s = await startPairing();
    await api(t, a.token).post('/pairing/claim').send({ code: s.code }).expect(200);
    await api(t, b.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'X', child_ids: [childB.id] })
      .expect(404);
  });

  it("refuses to assign another family's child", async () => {
    const a = await registerParent(t);
    const b = await registerParent(t);
    const childB = await createChild(t, b);
    const s = await startPairing();
    await api(t, a.token).post('/pairing/claim').send({ code: s.code }).expect(200);
    await api(t, a.token)
      .post(`/pairing/sessions/${s.pairing_id}/approve`)
      .send({ device_name: 'X', child_ids: [childB.id] })
      .expect(400);
  });

  it('locks a QR session after 5 wrong codes', async () => {
    const parent = await registerParent(t);
    const s = await startPairing();
    for (let i = 0; i < 5; i++) {
      await api(t, parent.token)
        .post('/pairing/claim')
        .send({ code: 'AAAA-AAAA', pairing_id: s.pairing_id })
        .expect(404);
    }
    // Even the right code no longer works.
    await api(t, parent.token).post('/pairing/claim').send({ code: s.code, pairing_id: s.pairing_id }).expect(404);
    expect((await poll(s.pairing_id, s.poll_secret).expect(200)).body.state).toBe('rejected');
  });

  it('a rejected pairing tells the tablet', async () => {
    const parent = await registerParent(t);
    const s = await startPairing();
    await api(t, parent.token).post('/pairing/claim').send({ code: s.code }).expect(200);
    await api(t, parent.token).post(`/pairing/sessions/${s.pairing_id}/reject`).expect(204);
    expect((await poll(s.pairing_id, s.poll_secret).expect(200)).body.state).toBe('rejected');
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
    expect(profiles.body.parents).toHaveLength(1);

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
