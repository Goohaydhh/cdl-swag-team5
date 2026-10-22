import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, registerParent, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('auth', () => {
  it('registers a parent who owns a new family', async () => {
    const parent = await registerParent(t);
    const family = await api(t, parent.token).get('/family').expect(200);
    expect(family.body.name).toBe('Martin');
    expect(family.body.parents).toHaveLength(1);
    expect(family.body.parents[0].is_owner).toBe(true);
  });

  it('requires consent and a strong enough password', async () => {
    const res = await api(t)
      .post('/auth/register')
      .send({ email: 'a@b.test', password: 'short', display_name: 'A', family_name: 'F', consent: false })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('refuses a second account with the same email, case-insensitively', async () => {
    const parent = await registerParent(t);
    const res = await api(t)
      .post('/auth/register')
      .send({
        email: parent.email.toUpperCase(),
        password: 'another long password',
        display_name: 'B',
        family_name: 'Other',
        consent: true,
      })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('logs in with the right password and rejects a wrong one with a generic error', async () => {
    const parent = await registerParent(t);
    await api(t)
      .post('/auth/login')
      .send({ email: parent.email, password: 'correct horse battery' })
      .expect(200);
    const wrong = await api(t).post('/auth/login').send({ email: parent.email, password: 'nope' }).expect(401);
    const unknown = await api(t)
      .post('/auth/login')
      .send({ email: 'nobody@example.test', password: 'nope' })
      .expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects requests without a valid token', async () => {
    await api(t).get('/family').expect(401);
    const res = await api(t, 'not-a-jwt').get('/family').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rotates refresh tokens and revokes the whole chain when an old one is replayed', async () => {
    const parent = await registerParent(t);
    const first = await api(t).post('/auth/refresh').send({ refresh_token: parent.refresh }).expect(200);
    const second = first.body.tokens.refresh_token;
    expect(second).not.toBe(parent.refresh);

    // Replaying the original token looks like theft: it fails and kills the newer token too.
    await api(t).post('/auth/refresh').send({ refresh_token: parent.refresh }).expect(401);
    await api(t).post('/auth/refresh').send({ refresh_token: second }).expect(401);
  });

  it('logout revokes the refresh token and the phone session', async () => {
    const parent = await registerParent(t);
    await api(t, parent.token).post('/auth/logout').send({ refresh_token: parent.refresh }).expect(204);
    await api(t).post('/auth/refresh').send({ refresh_token: parent.refresh }).expect(401);
    await api(t, parent.token).get('/family').expect(401);
  });
});

/**
 * Test feedback (21 October 2026): "it seems that anytime I connect again, a new 'Appareil' is
 * created in the 'Famille'! And I can't remove any of them (as of now I have 11 'Téléphone
 * Android')". A phone is now identified by the stable `install_id` it keeps and sends.
 */
describe('parent phones in the family', () => {
  interface DeviceRow {
    id: string;
    kind: string;
    name: string;
    owner_user_id: string | null;
  }
  const PASSWORD = 'correct horse battery';
  const phonesOf = (body: DeviceRow[]) => body.filter((d) => d.kind === 'parent_phone');

  const signInAgain = (email: string, device: Record<string, unknown>) =>
    api(t).post('/auth/login').send({ email, password: PASSWORD, device }).expect(200);

  it('reuses the same phone when it connects again, instead of adding one', async () => {
    const install = randomUUID();
    const device = { name: 'Téléphone Android', install_id: install };
    const parent = await registerParent(t, { device });

    const first = await api(t, parent.token).get('/devices').expect(200);
    const before = phonesOf(first.body);
    expect(before).toHaveLength(1);
    expect(before[0]!.owner_user_id).toBe(parent.userId);

    // Three reconnections, as a phone losing the Wi-Fi would do.
    let token = parent.token;
    for (let i = 0; i < 3; i++) {
      const again = await signInAgain(parent.email, device);
      token = again.body.tokens.access_token;
    }

    const second = await api(t, token).get('/devices').expect(200);
    const after = phonesOf(second.body);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('keeps one phone per installation, so both parents’ phones still show up', async () => {
    const parent = await registerParent(t, { device: { name: 'Téléphone Android', install_id: randomUUID() } });
    await signInAgain(parent.email, { name: 'iPhone', install_id: randomUUID() });

    const res = await api(t, parent.token).get('/devices').expect(200);
    expect(phonesOf(res.body)).toHaveLength(2);
  });

  it('signing in again after a logout revives the same phone and its tokens work', async () => {
    const device = { name: 'Téléphone Android', install_id: randomUUID() };
    const parent = await registerParent(t, { device });
    const before = phonesOf((await api(t, parent.token).get('/devices').expect(200)).body);

    await api(t, parent.token).post('/auth/logout').send({ refresh_token: parent.refresh }).expect(204);

    const again = await signInAgain(parent.email, device);
    const token = again.body.tokens.access_token as string;
    // The row was revoked by the logout: it must be usable again, not duplicated.
    const after = phonesOf((await api(t, token).get('/devices').expect(200)).body);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before[0]!.id);
  });

  it('a parent can remove a phone, which signs that phone out', async () => {
    const parent = await registerParent(t, { device: { name: 'Téléphone Android', install_id: randomUUID() } });
    const other = await signInAgain(parent.email, { name: 'Vieux téléphone', install_id: randomUUID() });
    const otherToken = other.body.tokens.access_token as string;
    const stale = phonesOf((await api(t, parent.token).get('/devices').expect(200)).body).find(
      (d) => d.name === 'Vieux téléphone',
    )!;

    await api(t, parent.token).delete(`/devices/${stale.id}`).expect(204);

    const left = phonesOf((await api(t, parent.token).get('/devices').expect(200)).body);
    expect(left.some((d) => d.id === stale.id)).toBe(false);
    await api(t, otherToken).get('/family').expect(401);
  });

  it('a phone that sends no install_id still works (older builds)', async () => {
    const parent = await registerParent(t, { device: { name: 'Pixel 8' } });
    const res = await api(t, parent.token).get('/devices').expect(200);
    expect(phonesOf(res.body)).toHaveLength(1);
  });
});
