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
